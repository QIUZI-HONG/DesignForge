#!/usr/bin/env node
/**
 * verify-resilience —— 审计 03（#53）韧性故障注入接缝。
 *
 * 目的：把「本地真值在越界/并发/崩溃/磁盘/权限故障下不静默丢数据、不泄漏凭据」变成
 * 可重复执行的真实链路用例。与 `verify-daemon` 互补：后者只做正常态契约冒烟。
 *
 * 纪律（与仓库门禁同一口径）：
 * - 三态退出码：`0 = 通过`、`1 = 真违规`、`2 = 阻塞`（阻塞不是通过）；
 *   同时存在违规与阻塞时按 1 收口，但阻塞项仍逐条点名；
 * - 一切 daemon 用**临时数据根 + 空闲端口**，不触碰 `~/.dforge` 与常驻 3000/4318；
 *   临时根禁止落在 `/tmp`（本机 tmpfs 仅 3.9G）；
 * - 只按**精确 PID** 回收自己起的子进程（禁止按模式杀进程）；
 * - 证据落仓库外 `~/df-evidence/audit-50/aud-03/`（可用 `DF_EVIDENCE_DIR` 覆盖）。
 *
 * 故障注入实现：
 * - SIGKILL / 重启 / chmod 用真实信号与权限；
 * - ENOSPC / EIO / fsync / rename 失败用 `scripts/fixtures/fs-fault-shim.c` 经 LD_PRELOAD
 *   注入到 daemon 子进程（需 `cc`；缺编译器时对应用例记为阻塞，不假装覆盖）。
 * - **真实磁盘写满 / 物理掉电 / 跨平台（Windows/macOS）不在本环境可复现范围**，报告如实登记。
 *
 * 用法：`node scripts/verify-resilience.mjs`（或 `pnpm verify:resilience`）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePort } from './lib/gates.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(THIS_FILE), '..');
const DAEMON_ENTRY = join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts');
const SHIM_SOURCE = join(REPO_ROOT, 'scripts', 'fixtures', 'fs-fault-shim.c');
const EVIDENCE_DIR =
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', 'audit-50', 'aud-03');
const TMP_BASE = process.env.DF_RESILIENCE_TMP ?? join(EVIDENCE_DIR, 'tmp');
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const OUTSIDE_MARKER = 'TOP-SECRET-OUTSIDE-BODY';
/** 运行时拼接，避免仓库文本里出现完整密钥字面量。 */
const SENTINEL_KEY = ['sk-', 'AUDIT53', '-RESILIENCE-', '0123456789'].join('');
const SENTINEL_FRAGMENT = 'AUDIT53-RESILIENCE';

export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  BLOCKED: 'blocked',
  OBSERVE: 'observe',
});

/**
 * 三态退出码：违规（1）优先于阻塞（2）；观察项不影响退出码。
 * @param {{status: string}[]} steps
 */
export function decideExitCode(steps) {
  if (steps.some((step) => step.status === STATUS.FAIL)) return 1;
  if (steps.some((step) => step.status === STATUS.BLOCKED)) return 2;
  return 0;
}

/** 步骤计数（证据 JSON 与终端摘要共用）。 */
export function summarizeSteps(steps) {
  return {
    total: steps.length,
    pass: steps.filter((step) => step.status === STATUS.PASS).length,
    fail: steps.filter((step) => step.status === STATUS.FAIL).length,
    blocked: steps.filter((step) => step.status === STATUS.BLOCKED).length,
    observe: steps.filter((step) => step.status === STATUS.OBSERVE).length,
  };
}

/** 临时根安全断言：本机 `/tmp` 是 3.9G tmpfs，撑爆会连累整机。 */
export function assertSafeTempBase(base) {
  const normalized = resolve(base);
  if (normalized === '/tmp' || normalized.startsWith('/tmp/')) {
    throw new Error('禁用 /tmp 作为临时根（tmpfs 3.9G 会被 node_modules/大数据撑爆）');
  }
}

/**
 * 故障注入结果分类（纯函数，便于自测）：
 * - 故障未生效（写成功）→ fail；
 * - 任一 JSON 损坏 → fail；
 * - 失败响应但正文已更新而 manifest 未提交 → fail（半提交）；
 * - 旧正文保留 → pass；残留临时文件/错误消息泄漏绝对路径记为观察项。
 */
export function classifyFaultOutcome(input) {
  const observations = [];
  if (Array.isArray(input.tempFiles) && input.tempFiles.length > 0) {
    observations.push('temp-leftover');
  }
  if (input.reasonLeaksPath === true) observations.push('error-path-leak');
  if (input.pageJson !== 'valid' || input.manifestJson !== 'valid') {
    return { status: STATUS.FAIL, reason: 'json-corrupt', observations };
  }
  if (typeof input.httpStatus !== 'number' || input.httpStatus < 400) {
    return { status: STATUS.FAIL, reason: 'fault-not-observed', observations };
  }
  if (input.pageState === 'new' && input.manifestState === 'old') {
    return { status: STATUS.FAIL, reason: 'partial-apply', observations };
  }
  return { status: STATUS.PASS, reason: 'old-body-intact', observations };
}

// ---------------------------------------------------------------------------
// 进程与 HTTP 工具
// ---------------------------------------------------------------------------

/** 本地浅断言：失败只记录，不抛异常（保持用例可继续取证）。 */
function check(condition, id, detail, evidence) {
  const status = condition ? STATUS.PASS : STATUS.FAIL;
  return { id, status, detail, ...(evidence === undefined ? {} : { evidence }) };
}

async function sleep(ms) {
  await new Promise((settle) => setTimeout(settle, ms));
}

async function pathExists(target) {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function manifestText(id, pageIds = ['page-1'], schema = 'df.dfg.manifest/v1') {
  return `${JSON.stringify(
    {
      schema,
      id,
      name: id,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pages: pageIds.map((pageId) => ({
        id: pageId,
        name: pageId,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
    null,
    2,
  )}\n`;
}

/** 造一份形状合法的文档目录（模拟用户/仓库已有的 `.dfg`）。 */
async function makeDoc(workspaceDir, id, pageIds = ['page-1'], pageBody = '{"fixture":true}\n') {
  const dir = join(workspaceDir, `${id}.dfg`);
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), manifestText(id, pageIds));
  for (const pageId of pageIds) {
    await writeFile(join(dir, 'pages', `${pageId}.json`), pageBody);
  }
  return dir;
}

/** 在数据根之外造一份形状合法的 `.dfg`（越界目标）。 */
async function makeOutsideDoc(root, id = 'victim') {
  const dir = join(root, 'outside', `${id}.dfg`);
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), manifestText(id));
  await writeFile(
    join(dir, 'pages', 'page-1.json'),
    `${JSON.stringify({ secret: OUTSIDE_MARKER })}\n`,
  );
  return dir;
}

/** 极简 HTTP 客户端（证据里保留 status/JSON/文本前缀）。 */
async function call(baseUrl, method, path, body, extraHeaders) {
  const headers = {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(extraHeaders ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function errorReason(result) {
  const details = result.json?.error?.details;
  return typeof details === 'object' && details !== null && typeof details.reason === 'string'
    ? details.reason
    : '';
}

/** 起一个真 daemon 子进程（临时数据根 + 空闲端口；只记精确 PID）。 */
async function startDaemon(options) {
  const { dataRoot, workspaceDir, label, env } = options;
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      DAEMON_ENTRY,
      '--data-root',
      dataRoot,
      '--workspace',
      workspaceDir,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DF_DEEPSEEK_API_KEY: '', ...(env ?? {}) },
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const url = await new Promise((settle, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`daemon(${label}) 启动超时；输出：${stdout.slice(-800)}${stderr.slice(-800)}`),
      );
    }, 20_000);
    const inspect = () => {
      const match = stdout.match(/\[daemon\] listening on (http:\/\/[^\s]+)/);
      if (match !== null) {
        clearTimeout(timer);
        settle(match[1]);
      }
    };
    child.stdout.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `daemon(${label}) 提前退出 code=${code}；输出：${stdout.slice(-800)}${stderr.slice(-800)}`,
        ),
      );
    });
  });

  let logPath = null;
  let killed = false;
  const handle = {
    url,
    port,
    child,
    get output() {
      return stdout;
    },
    get errorOutput() {
      return stderr;
    },
    get logPath() {
      return logPath;
    },
    async kill(signal = 'SIGTERM') {
      if (killed) return;
      killed = true;
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((settle) => child.once('exit', settle));
        child.kill(signal);
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 3000);
        await exited;
        clearTimeout(timer);
      }
      await mkdir(LOG_DIR, { recursive: true });
      logPath = join(LOG_DIR, `resilience-${label}-${Date.now()}.log`);
      await writeFile(logPath, `${stdout}\n--- stderr ---\n${stderr}\n`);
    },
  };
  daemons.add(handle);
  return handle;
}

/** 所有在册 daemon（收尾兜底回收，仍按精确 PID）。 */
const daemons = new Set();
async function killAllDaemons() {
  for (const daemon of daemons) {
    await daemon.kill().catch(() => undefined);
  }
  daemons.clear();
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

const steps = [];
const tempRoots = [];

function record(step) {
  steps.push(step);
  const mark =
    step.status === STATUS.PASS
      ? 'ok'
      : step.status === STATUS.FAIL
        ? 'FAIL'
        : step.status === STATUS.BLOCKED
          ? 'BLOCK'
          : 'observe';
  console.log(`  [${mark}] ${step.id} —— ${step.detail}`);
}

async function caseRoot(label) {
  const root = await mkdtemp(join(TMP_BASE, `${label}-`));
  tempRoots.push(root);
  return root;
}

async function listTempFiles(dir) {
  const names = await readdir(dir).catch(() => []);
  return names.filter((name) => name.endsWith('.tmp'));
}

// ---- 1) 路径穿越 / 软链 / 编码变体 -----------------------------------------

async function runPathCase() {
  const root = await caseRoot('path');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const outside = await makeOutsideDoc(root);
  const outsidePage = join(outside, 'pages', 'page-1.json');

  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'path' });
  try {
    const variants = [
      '/documents/..%2Foutside%2Fvictim/pages/page-1',
      '/documents/%2E%2E%2Foutside%2Fvictim/pages/page-1',
      '/documents/..%5Coutside%5Cvictim/pages/page-1',
      '/documents/..%252Foutside%252Fvictim/pages/page-1',
      '/documents/%2Fetc%2Fpasswd/pages/page-1',
      '/documents/%00etc/pages/page-1',
    ];
    const failed = [];
    for (const url of variants) {
      const read = await call(daemon.url, 'GET', url);
      const write = await call(daemon.url, 'PUT', url, { body: { pwned: true } });
      const del = await call(daemon.url, 'DELETE', url);
      const leaked = read.text.includes(OUTSIDE_MARKER);
      const intact = (await readFile(outsidePage, 'utf8')).includes(OUTSIDE_MARKER);
      if (read.status < 400 || write.status < 400 || del.status < 400 || leaked || !intact) {
        failed.push(
          `${url} → ${read.status}/${write.status}/${del.status} leaked=${leaked} intact=${intact}`,
        );
      }
    }
    record(
      check(
        failed.length === 0,
        'path.traversal-variants',
        failed.length === 0
          ? `${variants.length} 种越界变体（..%2F / %2E%2E / 反斜杠 / 双重编码 / 绝对路径 / NUL）读/写/删均 4xx，树外正文未被读取或改写`
          : `越界变体未全部被拒：${failed.join('；')}`,
      ),
    );

    // 软链：pages 目录 / 页文件指向树外
    await makeDoc(workspace, 'sympages');
    await rm(join(workspace, 'sympages.dfg', 'pages'), { recursive: true, force: true });
    await symlink(join(outside, 'pages'), join(workspace, 'sympages.dfg', 'pages'));
    const symPagesRead = await call(daemon.url, 'GET', '/documents/sympages/pages/page-1');
    const symPagesWrite = await call(daemon.url, 'PUT', '/documents/sympages/pages/page-1', {
      body: { pwned: true },
    });
    record(
      check(
        symPagesRead.status >= 400 &&
          symPagesWrite.status >= 400 &&
          (await readFile(outsidePage, 'utf8')).includes(OUTSIDE_MARKER),
        'path.symlink-pages-dir',
        `pages 目录软链出根：读=${symPagesRead.status} 写=${symPagesWrite.status}，树外正文未变`,
      ),
    );

    await makeDoc(workspace, 'sympage');
    await rm(join(workspace, 'sympage.dfg', 'pages', 'page-1.json'), { force: true });
    await symlink(outsidePage, join(workspace, 'sympage.dfg', 'pages', 'page-1.json'));
    const symFileRead = await call(daemon.url, 'GET', '/documents/sympage/pages/page-1');
    const symFileWrite = await call(daemon.url, 'PUT', '/documents/sympage/pages/page-1', {
      body: { pwned: true },
    });
    record(
      check(
        symFileRead.status >= 400 &&
          symFileWrite.status >= 400 &&
          (await readFile(outsidePage, 'utf8')).includes(OUTSIDE_MARKER),
        'path.symlink-page-file',
        `页文件软链出根：读=${symFileRead.status} 写=${symFileWrite.status}，树外正文未变`,
      ),
    );

    // 删除守卫：数据根本身/祖先不可递归删；文档内指向树外的软链只删链接
    await makeDoc(workspace, 'guard');
    const guardFailures = [];
    for (const url of ['/documents/%2E', '/documents/%2E%2E%2F%2E%2E', '/documents/..%2F..']) {
      const del = await call(daemon.url, 'DELETE', url);
      if (del.status < 400) guardFailures.push(`${url}=${del.status}`);
    }
    record(
      check(
        guardFailures.length === 0 &&
          (await pathExists(join(workspace, 'guard.dfg', 'manifest.json'))) &&
          (await pathExists(dataRoot)),
        'path.delete-guard',
        guardFailures.length === 0
          ? '数据根本身/祖先的递归删一律 4xx，既有文档与数据根完好'
          : `删除守卫失效：${guardFailures.join(',')}`,
      ),
    );

    await makeDoc(workspace, 'symdel');
    const outsideKeep = join(root, 'outside', 'keep.txt');
    await writeFile(outsideKeep, 'KEEP-OUTSIDE');
    await symlink(outsideKeep, join(workspace, 'symdel.dfg', 'keep-link'));
    const symDel = await call(daemon.url, 'DELETE', '/documents/symdel');
    record(
      check(
        symDel.status === 200 && (await readFile(outsideKeep, 'utf8')) === 'KEEP-OUTSIDE',
        'path.delete-symlink-inside',
        `删除含树外软链的文档 → ${symDel.status}；软链目标保留（递归删不跟随软链）`,
      ),
    );

    // 编码/标识符边界（NUL、NFD、超长、绝对路径、bidi）不触盘
    const badIds = [
      'a%00b',
      'a%2Fb',
      'a%5Cb',
      'a'.repeat(65),
      encodeURIComponent('e\u0301x'),
      '%2Fetc%2Fpasswd',
    ];
    const badFailures = [];
    for (const id of badIds) {
      const res = await call(daemon.url, 'GET', `/documents/${id}`);
      if (res.status < 400) badFailures.push(`${id}=${res.status}`);
      if (res.text.includes(root)) badFailures.push(`${id} 泄漏绝对路径`);
    }
    record(
      check(
        badFailures.length === 0,
        'path.identifier-boundaries',
        badFailures.length === 0
          ? 'NUL/反斜杠/NFD/超长/绝对路径 id 一律 4xx，响应不回显服务端绝对路径'
          : badFailures.join('；'),
      ),
    );

    // EACCES：目录只读时保存失败，旧正文保留；错误 details 不泄漏绝对路径
    await call(daemon.url, 'POST', '/documents', { name: 'eacces' });
    await call(daemon.url, 'PUT', '/documents/eacces/pages/page-1', { body: { keep: true } });
    const pagesDir = join(workspace, 'eacces.dfg', 'pages');
    await chmod(pagesDir, 0o555);
    const denied = await call(daemon.url, 'PUT', '/documents/eacces/pages/page-1', {
      body: { overwritten: true },
    });
    await chmod(pagesDir, 0o755);
    const afterDenied = await call(daemon.url, 'GET', '/documents/eacces/pages/page-1');
    record(
      check(
        denied.status >= 400 && afterDenied.json?.result?.body?.keep === true,
        'fs.eacces-save',
        `pages 只读 → PUT=${denied.status}/${denied.json?.error?.code ?? ''}；旧正文保留=${afterDenied.json?.result?.body?.keep === true}`,
      ),
    );
    const reason = errorReason(denied);
    record(
      reason.includes(root)
        ? {
            id: 'errors.absolute-path-leak',
            status: STATUS.OBSERVE,
            detail: `500 错误的 details.reason 含绝对路径（${reason.slice(0, 160)}）`,
          }
        : {
            id: 'errors.absolute-path-leak',
            status: STATUS.PASS,
            detail: '500 错误未回显绝对路径',
          },
    );
  } finally {
    await daemon.kill();
  }
}

// ---- 2) 损坏 / 恶意 .dfg（导入边界） ---------------------------------------

async function runCorruptDfgCase() {
  const root = await caseRoot('corrupt');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });

  const corrupt = async (id, manifestRaw, pageRaw) => {
    const dir = join(workspace, `${id}.dfg`);
    await mkdir(join(dir, 'pages'), { recursive: true });
    if (manifestRaw !== null) await writeFile(join(dir, 'manifest.json'), manifestRaw);
    if (pageRaw !== null) await writeFile(join(dir, 'pages', 'page-1.json'), pageRaw);
  };

  await corrupt(
    'trunc-manifest',
    '{"schema":"df.dfg.manifest/v1","id":"trunc-manifest",',
    '{"a":1}\n',
  );
  await corrupt(
    'future-schema',
    manifestText('future-schema', ['page-1'], 'df.dfg.manifest/v2'),
    '{}\n',
  );
  await corrupt('trunc-page', manifestText('trunc-page'), '{"a":');
  const deepFrame =
    '{"kind":"frame","x":0,"y":0,"width":1,"height":1,"children":['.repeat(20_000) +
    '{"kind":"rect","x":0,"y":0,"width":1,"height":1}' +
    ']}'.repeat(20_000);
  await corrupt('deep-page', manifestText('deep-page'), `${deepFrame}\n`);
  await corrupt('huge-page', manifestText('huge-page'), `{"pad":"${'x'.repeat(2_000_000)}"}\n`);
  await corrupt('missing-manifest', null, '{}\n');
  await writeFile(join(workspace, 'file-not-dir.dfg'), 'i am a file');
  await makeDoc(workspace, 'future-fields');
  const futureManifest = JSON.parse(manifestText('future-fields'));
  futureManifest.futureField = { nested: true };
  futureManifest.pages = [{ ...futureManifest.pages[0], future: 1 }];
  await writeFile(
    join(workspace, 'future-fields.dfg', 'manifest.json'),
    `${JSON.stringify(futureManifest)}\n`,
  );

  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'corrupt' });
  try {
    const list = await call(daemon.url, 'GET', '/documents');
    const warningIds = (list.json?.result?.warnings ?? []).map((warning) => warning.id).sort();
    record(
      check(
        list.status === 200 &&
          warningIds.includes('trunc-manifest') &&
          warningIds.includes('future-schema') &&
          warningIds.includes('missing-manifest'),
        'corrupt.list-warnings',
        `GET /documents → ${list.status}；损坏目录进入 warnings 且不阻塞列表（${warningIds.join(',')}）`,
      ),
    );

    const cases = [
      { id: 'trunc-manifest', get: 422, page: 422 },
      { id: 'future-schema', get: 422, page: 422 },
      { id: 'trunc-page', get: 200, page: 400 },
      { id: 'huge-page', get: 200, page: 200 },
      { id: 'file-not-dir', get: 422, page: 422 },
    ];
    const failures = [];
    for (const expected of cases) {
      const get = await call(daemon.url, 'GET', `/documents/${expected.id}`);
      const page = await call(daemon.url, 'GET', `/documents/${expected.id}/pages/page-1`);
      if (get.status !== expected.get || page.status !== expected.page) {
        failures.push(
          `${expected.id}: get=${get.status}(期望 ${expected.get}) page=${page.status}(期望 ${expected.page})`,
        );
      }
    }
    record(
      check(
        failures.length === 0,
        'corrupt.matrix',
        failures.length === 0
          ? '截断 manifest/未来 schema/截断页 JSON/2MB 页/同名普通文件：均以 4xx 或正常读收场，无 5xx'
          : failures.join('；'),
      ),
    );

    const deepGet = await call(daemon.url, 'GET', '/documents/deep-page/pages/page-1');
    record(
      check(
        deepGet.status < 500,
        'corrupt.deep-page-read',
        `20k 层嵌套页（克隆来的 .dfg）GET → ${deepGet.status}/${deepGet.json?.error?.code ?? ''}${deepGet.status >= 500 ? `（${errorReason(deepGet).slice(0, 80)}）` : ''}`,
        { reason: errorReason(deepGet) },
      ),
    );
    const deepExport = await call(daemon.url, 'POST', '/export', {
      documentId: 'deep-page',
      pageId: 'page-1',
      format: 'svg',
    });
    record(
      check(
        deepExport.status === 200,
        'corrupt.deep-page-export',
        `深嵌套页导出 → ${deepExport.status}（节点预算截断，不递归到底）`,
      ),
    );

    const huge = await call(daemon.url, 'POST', '/export', {
      documentId: 'huge-page',
      pageId: 'page-1',
      format: 'svg',
    });
    record(
      check(
        huge.status === 200,
        'corrupt.huge-page-export',
        `2MB 页正文读取与导出 → ${huge.status}`,
      ),
    );

    const orphan = await call(daemon.url, 'DELETE', '/documents/missing-manifest');
    const orphanDirExists = await pathExists(join(workspace, 'missing-manifest.dfg'));
    record(
      orphan.status === 404 && orphanDirExists
        ? {
            id: 'corrupt.orphan-doc-deletable',
            status: STATUS.OBSERVE,
            detail: `缺 manifest 的 .dfg（崩溃/中断导入残留）DELETE → ${orphan.status}，目录仍在=${orphanDirExists}（API 无法清理）`,
          }
        : {
            id: 'corrupt.orphan-doc-deletable',
            status: STATUS.PASS,
            detail: `缺 manifest 的 .dfg DELETE → ${orphan.status}，目录仍在=${orphanDirExists}`,
          },
    );

    const future = await call(daemon.url, 'GET', '/documents/future-fields');
    record(
      check(
        future.status === 200,
        'corrupt.future-fields',
        `manifest 未知字段 → ${future.status}（前向兼容：忽略未知字段）`,
      ),
    );
  } finally {
    await daemon.kill();
  }
}

// ---- 3) 根内软链：跨文档别名（导入不可信 .dfg 的完整性风险） ----------------

async function runInRootSymlinkCase() {
  const root = await caseRoot('symlink');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'symlink' });
  try {
    await makeDoc(workspace, 'innocent');
    await writeFile(join(workspace, 'innocent.dfg', 'pages', 'page-1.json'), '{"innocent":true}\n');
    await makeDoc(workspace, 'evil');
    await rm(join(workspace, 'evil.dfg', 'pages'), { recursive: true, force: true });
    await symlink('../innocent.dfg/pages', join(workspace, 'evil.dfg', 'pages'));
    const save = await call(daemon.url, 'PUT', '/documents/evil/pages/page-1', {
      body: { pwned: true, from: 'evil' },
    });
    const after = await call(daemon.url, 'GET', '/documents/innocent/pages/page-1');
    record(
      check(
        after.json?.result?.body?.pwned !== true,
        'symlink.in-root-cross-doc-pages',
        `evil.dfg/pages 软链到 innocent.dfg/pages：PUT evil=${save.status}；innocent 正文=${JSON.stringify(after.json?.result?.body)}${after.json?.result?.body?.pwned === true ? '（跨文档覆盖成功）' : ''}`,
      ),
    );

    await makeDoc(workspace, 'innocent2');
    await writeFile(
      join(workspace, 'innocent2.dfg', 'pages', 'page-1.json'),
      '{"innocent2":true}\n',
    );
    await symlink('innocent2.dfg', join(workspace, 'alias.dfg'));
    const aliasSave = await call(daemon.url, 'PUT', '/documents/alias/pages/page-1', {
      body: { pwned: true, from: 'alias' },
    });
    const innocent2 = await call(daemon.url, 'GET', '/documents/innocent2/pages/page-1');
    record(
      check(
        innocent2.json?.result?.body?.pwned !== true,
        'symlink.in-root-doc-alias',
        `alias.dfg 软链到 innocent2.dfg：PUT alias=${aliasSave.status}；innocent2 正文=${JSON.stringify(innocent2.json?.result?.body)}${innocent2.json?.result?.body?.pwned === true ? '（文档别名写入成功）' : ''}`,
      ),
    );
  } finally {
    await daemon.kill();
  }
}

// ---- 4) 跨进程并发（两 daemon 共享数据根） ---------------------------------

async function runCrossProcessCase() {
  const root = await caseRoot('xproc');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const a = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'xproc-a' });
  const b = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'xproc-b' });
  try {
    await call(a.url, 'POST', '/documents', { name: 'xproc' });
    const createResults = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        call(index % 2 === 0 ? a.url : b.url, 'POST', '/documents/xproc/pages', {
          name: `P${index}`,
        }),
      ),
    );
    const manifest = await readJsonFile(join(workspace, 'xproc.dfg', 'manifest.json'));
    const acknowledged = createResults.filter((result) => result.status === 201).length;
    const lost = acknowledged - (manifest.pages.length - 1);
    record(
      check(
        lost === 0,
        'concurrency.cross-process-create-page',
        `${acknowledged} 个 201 / ${createResults.filter((r) => r.status === 409).length} 个 409；manifest 仅 ${manifest.pages.length} 页（含 page-1），已回 201 却丢失 ${lost} 页`,
        {
          statuses: createResults.map((r) => `${r.status}:${r.json?.error?.code ?? 'ok'}`),
          manifestPages: manifest.pages.map((page) => page.id),
        },
      ),
    );

    const pageIds = manifest.pages.map((page) => page.id);
    for (const pageId of pageIds) {
      await call(a.url, 'PUT', `/documents/xproc/pages/${pageId}`, { body: { pageId, round: 0 } });
    }
    const before = await readJsonFile(join(workspace, 'xproc.dfg', 'manifest.json'));
    const saveResults = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        call(
          index % 2 === 0 ? a.url : b.url,
          'PUT',
          `/documents/xproc/pages/${pageIds[index % pageIds.length]}`,
          {
            body: { round: index + 1, pad: 'x'.repeat(1000) },
          },
        ),
      ),
    );
    const after = await readJsonFile(join(workspace, 'xproc.dfg', 'manifest.json'));
    let parseFailures = 0;
    for (const id of pageIds) {
      try {
        await readJsonFile(join(workspace, 'xproc.dfg', 'pages', `${id}.json`));
      } catch {
        parseFailures += 1;
      }
    }
    record(
      check(
        parseFailures === 0 &&
          saveResults.every((result) => result.status === 200 || result.status === 409),
        'concurrency.cross-process-save-page',
        `200=${saveResults.filter((r) => r.status === 200).length} 409=${saveResults.filter((r) => r.status === 409).length}（有界冲突重试语义）；manifest version ${before.version} → ${after.version}；半截 JSON=${parseFailures}`,
      ),
    );

    const same = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        call(index % 2 === 0 ? a.url : b.url, 'POST', '/documents', { name: 'same-name' }),
      ),
    );
    record(
      check(
        same.filter((result) => result.status === 201).length === 1 &&
          same.filter((result) => result.status === 409).length === 9,
        'concurrency.cross-process-same-name',
        `跨进程同名建文档：201=${same.filter((r) => r.status === 201).length} 409=${same.filter((r) => r.status === 409).length}（恰一个成功）`,
      ),
    );

    await call(a.url, 'POST', '/documents', { name: 'race' });
    await call(a.url, 'PUT', '/documents/race/pages/page-1', { body: { initial: true } });
    const saves = Array.from({ length: 10 }, (_unused, index) =>
      call(index % 2 === 0 ? a.url : b.url, 'PUT', '/documents/race/pages/page-1', {
        body: { round: index, pad: 'y'.repeat(200_000) },
      }),
    );
    await sleep(5);
    const del = await call(b.url, 'DELETE', '/documents/race');
    const settled = await Promise.allSettled(saves);
    const saveStatuses = settled.map((item) =>
      item.status === 'fulfilled' ? item.value.status : 0,
    );
    const resurrected = await pathExists(join(workspace, 'race.dfg'));
    record(
      check(
        !resurrected,
        'concurrency.cross-process-delete-vs-save',
        `DELETE 与 10 个保存竞态：DELETE=${del.status}；保存状态=${JSON.stringify(saveStatuses)}；目录复活=${resurrected}`,
      ),
    );
    if (saveStatuses.some((status) => status === 500)) {
      record({
        id: 'concurrency.delete-race-500',
        status: STATUS.OBSERVE,
        detail: '与删除竞态的保存返回 500（应映射为 404/409 一类结构化错误）',
      });
    }
  } finally {
    await a.kill();
    await b.kill();
  }
}

// ---- 5) 崩溃与重启恢复 ------------------------------------------------------

async function runCrashCase() {
  const root = await caseRoot('crash');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const docDir = await makeDoc(workspace, 'crash');
  const oldBody = { gen: 0, pad: 'o'.repeat(200_000) };
  await writeFile(join(docDir, 'pages', 'page-1.json'), `${JSON.stringify(oldBody)}\n`);

  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'crash' });
  const bodies = Array.from({ length: 40 }, (_unused, index) => ({
    gen: index + 1,
    pad: 'n'.repeat(900_000),
  }));
  const inFlight = bodies.map((body) =>
    call(daemon.url, 'PUT', '/documents/crash/pages/page-1', { body }).catch(() => ({ status: 0 })),
  );
  await sleep(120);
  await daemon.kill('SIGKILL');
  await Promise.allSettled(inFlight);

  const tempFiles = [
    ...(await listTempFiles(join(docDir, 'pages'))).map((name) => `pages/${name}`),
    ...(await listTempFiles(docDir)),
  ];
  let pageParse = 'valid';
  let pageGen = null;
  try {
    const page = await readJsonFile(join(docDir, 'pages', 'page-1.json'));
    pageGen = page.gen;
  } catch {
    pageParse = 'invalid';
  }
  let manifestParse = 'valid';
  try {
    await readJsonFile(join(docDir, 'manifest.json'));
  } catch {
    manifestParse = 'invalid';
  }

  const restart = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'crash-restart' });
  let readBack;
  let list;
  try {
    readBack = await call(restart.url, 'GET', '/documents/crash/pages/page-1');
    list = await call(restart.url, 'GET', '/documents');
  } finally {
    await restart.kill();
  }
  const knownGenerations = new Set([0, ...bodies.map((body) => body.gen)]);
  const expectedPad = readBack.json?.result?.body?.gen === 0 ? 200_000 : 900_000;
  record(
    check(
      pageParse === 'valid' &&
        manifestParse === 'valid' &&
        readBack.status === 200 &&
        knownGenerations.has(readBack.json?.result?.body?.gen) &&
        readBack.json?.result?.body?.pad?.length === expectedPad,
      'crash.sigkill-during-save',
      `40 个 900KB 保存在飞时 SIGKILL；page=${pageParse}(gen=${pageGen}) manifest=${manifestParse}；重启读=${readBack.status}（正文来自已提交版本，无半截 JSON）；list=${list.status}`,
    ),
  );
  record(
    tempFiles.length === 0
      ? { id: 'crash.temp-leftovers', status: STATUS.PASS, detail: '崩溃未留下原子写临时文件' }
      : {
          id: 'crash.temp-leftovers',
          status: STATUS.OBSERVE,
          detail: `崩溃留下 ${tempFiles.length} 个临时文件且重启不清理：${tempFiles.join(',')}`,
        },
  );

  // 建页中 SIGKILL：已回 201 的页必须在 manifest 中
  const createRoot = await caseRoot('crash-create');
  const createDataRoot = join(createRoot, 'data');
  const createWorkspace = join(createRoot, 'workspace');
  await mkdir(createWorkspace, { recursive: true });
  await makeDoc(createWorkspace, 'crash2');
  const createDaemon = await startDaemon({
    dataRoot: createDataRoot,
    workspaceDir: createWorkspace,
    label: 'crash-create',
  });
  const creates = Array.from({ length: 40 }, (_unused, index) =>
    call(createDaemon.url, 'POST', '/documents/crash2/pages', { name: `C${index}` }).catch(() => ({
      status: 0,
    })),
  );
  await sleep(60);
  await createDaemon.kill('SIGKILL');
  const createSettled = await Promise.allSettled(creates);
  const acknowledged = createSettled
    .map((item) => (item.status === 'fulfilled' ? item.value : null))
    .filter((result) => result?.status === 201)
    .map((result) => result.json.result.page.id);
  const manifest = await readJsonFile(join(createWorkspace, 'crash2.dfg', 'manifest.json'));
  const missing = acknowledged.filter((id) => !manifest.pages.some((page) => page.id === id));
  record(
    check(
      missing.length === 0,
      'crash.sigkill-during-create-page',
      `建页中 SIGKILL：已回 201=${acknowledged.length}，manifest=${manifest.pages.length} 页，201 后丢失=${missing.length}`,
      { missing },
    ),
  );

  // 损坏配置/凭据后的重启
  const recoveryRoot = await caseRoot('recovery');
  const recoveryDataRoot = join(recoveryRoot, 'data');
  const recoveryWorkspace = join(recoveryRoot, 'workspace');
  await mkdir(recoveryDataRoot, { recursive: true });
  await mkdir(recoveryWorkspace, { recursive: true });
  await writeFile(join(recoveryDataRoot, 'config.json'), '{"workspaceDir":');
  await writeFile(join(recoveryDataRoot, 'credentials.json'), 'not-json');
  await writeFile(join(recoveryDataRoot, 'credentials.key'), 'AAAA');
  const recoveryDaemon = await startDaemon({
    dataRoot: recoveryDataRoot,
    workspaceDir: recoveryWorkspace,
    label: 'recovery',
  });
  try {
    const health = await call(recoveryDaemon.url, 'GET', '/health');
    const config = await call(recoveryDaemon.url, 'GET', '/config');
    const setKey = await call(recoveryDaemon.url, 'PUT', '/config/credentials', {
      apiKey: SENTINEL_KEY,
    });
    record(
      check(
        health.status === 200 &&
          config.status === 200 &&
          config.json?.result?.config?.workspaceDir === recoveryWorkspace,
        'recovery.corrupt-config',
        `config.json 截断 → 启动成功并回退默认工作目录=${config.json?.result?.config?.workspaceDir === recoveryWorkspace}`,
      ),
    );
    record(
      setKey.status === 400
        ? {
            id: 'recovery.corrupt-credentials-key',
            status: STATUS.OBSERVE,
            detail: `credentials.key 损坏后写 key → ${setKey.status}/${setKey.json?.error?.code ?? ''}（无 API 复位路径，只能手工删 key 文件）`,
          }
        : {
            id: 'recovery.corrupt-credentials-key',
            status: STATUS.PASS,
            detail: `credentials.key 损坏后写 key → ${setKey.status}（可恢复）`,
          },
    );
  } finally {
    await recoveryDaemon.kill();
  }

  // MCP pending token 重启后失效（桩的已知边界）
  const mcpRoot = await caseRoot('mcp');
  const mcpDataRoot = join(mcpRoot, 'data');
  const mcpWorkspace = join(mcpRoot, 'workspace');
  await mkdir(mcpWorkspace, { recursive: true });
  const mcpA = await startDaemon({
    dataRoot: mcpDataRoot,
    workspaceDir: mcpWorkspace,
    label: 'mcp-a',
  });
  let ackToken = null;
  try {
    const proposal = await call(mcpA.url, 'POST', '/mcp/proposals', {
      tool: 'df_apply_patch',
      caller: 'mcp:zcode',
      args: { ops: [] },
    });
    ackToken = proposal.json?.result?.ackToken;
  } finally {
    await mcpA.kill();
  }
  const mcpB = await startDaemon({
    dataRoot: mcpDataRoot,
    workspaceDir: mcpWorkspace,
    label: 'mcp-b',
  });
  try {
    const ack = await call(mcpB.url, 'POST', '/mcp/ack', { ackToken, approve: true });
    record(
      ack.status === 403
        ? {
            id: 'recovery.mcp-pending-after-restart',
            status: STATUS.OBSERVE,
            detail: `重启后 ack 旧 token → ${ack.status}（提案登记在内存，桩不做崩溃恢复；审计留下 pending 记录）`,
          }
        : {
            id: 'recovery.mcp-pending-after-restart',
            status: STATUS.PASS,
            detail: `重启后 ack 旧 token → ${ack.status}`,
          },
    );
  } finally {
    await mcpB.kill();
  }

  // 遥测损坏行可跳过
  const telemetryRoot = await caseRoot('telemetry-line');
  const telemetryDataRoot = join(telemetryRoot, 'data');
  const telemetryWorkspace = join(telemetryRoot, 'workspace');
  await mkdir(join(telemetryDataRoot, 'telemetry'), { recursive: true });
  await mkdir(telemetryWorkspace, { recursive: true });
  await writeFile(
    join(telemetryDataRoot, 'telemetry', 'events.jsonl'),
    '{"id":"x","name":"doc.opened","payload":{}}\n{broken\n',
  );
  const telemetryDaemon = await startDaemon({
    dataRoot: telemetryDataRoot,
    workspaceDir: telemetryWorkspace,
    label: 'telemetry-line',
  });
  try {
    const query = await call(telemetryDaemon.url, 'GET', '/telemetry/events');
    record(
      check(
        query.status === 200,
        'recovery.telemetry-broken-line',
        `含损坏行的 JSONL → GET ${query.status}，返回 ${query.json?.result?.events?.length ?? 0} 条（单行损坏跳过）`,
      ),
    );
  } finally {
    await telemetryDaemon.kill();
  }
}

// ---- 6) 文件系统故障注入（LD_PRELOAD） --------------------------------------

const FAULT_CASES = [
  { id: 'fault.enospc-page-open', op: 'open', path: '/pages/', errno: 28, target: 'page' },
  { id: 'fault.enospc-page-write', op: 'write', path: '/pages/', errno: 28, target: 'page' },
  {
    id: 'fault.enospc-page-write-partial',
    op: 'write',
    path: '/pages/',
    errno: 28,
    after: 4096,
    target: 'page',
  },
  {
    id: 'fault.enospc-manifest-write',
    op: 'write',
    path: 'fault.dfg/.',
    errno: 28,
    target: 'manifest',
  },
  { id: 'fault.eio-page-fsync', op: 'fsync', path: '/pages/', errno: 5, target: 'page' },
  {
    id: 'fault.eio-manifest-fsync',
    op: 'fsync',
    path: 'fault.dfg/.',
    errno: 5,
    target: 'manifest',
  },
  { id: 'fault.eio-page-rename', op: 'rename', path: 'page-1.json', errno: 5, target: 'page' },
  {
    id: 'fault.eio-manifest-rename',
    op: 'rename',
    path: 'manifest.json',
    errno: 5,
    target: 'manifest',
  },
  {
    id: 'fault.eacces-manifest-open',
    op: 'open',
    path: 'fault.dfg/.',
    errno: 13,
    target: 'manifest',
  },
];

async function compileShim() {
  const shimPath = join(TMP_BASE, 'fs-fault-shim.so');
  const compile = spawnSync(
    process.env.CC ?? 'cc',
    ['-shared', '-fPIC', '-O2', '-o', shimPath, SHIM_SOURCE, '-ldl', '-lpthread'],
    { encoding: 'utf8' },
  );
  if (compile.error !== undefined || compile.status !== 0) {
    throw new Error(
      `故障注入 shim 编译失败（需要 C 编译器）：${compile.error?.message ?? compile.stderr?.slice(-500)}`,
    );
  }
  const bytes = await readFile(shimPath);
  return { shimPath, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function runFaultCase(shim) {
  for (const fault of FAULT_CASES) {
    const root = await caseRoot(fault.id.replaceAll('.', '-'));
    const dataRoot = join(root, 'data');
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const docDir = await makeDoc(workspace, 'fault');
    await writeFile(
      join(docDir, 'pages', 'page-1.json'),
      `${JSON.stringify({ old: true, pad: 'o'.repeat(100_000) })}\n`,
    );

    const env = {
      LD_PRELOAD: shim.shimPath,
      DF_FAULT_OP: fault.op,
      DF_FAULT_PATH: fault.path,
      DF_FAULT_ERRNO: String(fault.errno),
      ...(fault.after === undefined ? {} : { DF_FAULT_AFTER_BYTES: String(fault.after) }),
    };
    const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: fault.id, env });
    let save;
    try {
      save = await call(daemon.url, 'PUT', '/documents/fault/pages/page-1', {
        body: { new: true, pad: 'n'.repeat(200_000) },
      });
    } finally {
      await daemon.kill();
    }

    let pageState = 'unknown';
    let pageJson = 'valid';
    try {
      const page = await readJsonFile(join(docDir, 'pages', 'page-1.json'));
      pageState = page.old === true ? 'old' : page.new === true ? 'new' : 'unknown';
    } catch {
      pageJson = 'invalid';
    }
    let manifestState = 'unknown';
    let manifestJson = 'valid';
    try {
      const manifest = await readJsonFile(join(docDir, 'manifest.json'));
      manifestState = manifest.version === 1 ? 'old' : 'new';
    } catch {
      manifestJson = 'invalid';
    }
    const tempFiles = [
      ...(await listTempFiles(join(docDir, 'pages'))).map((name) => `pages/${name}`),
      ...(await listTempFiles(docDir)),
    ];

    const clean = await startDaemon({
      dataRoot,
      workspaceDir: workspace,
      label: `${fault.id}-clean`,
    });
    let readBack;
    try {
      readBack = await call(clean.url, 'GET', '/documents/fault/pages/page-1');
    } finally {
      await clean.kill();
    }

    const classified = classifyFaultOutcome({
      httpStatus: save.status,
      pageJson,
      manifestJson,
      pageState,
      manifestState,
      tempFiles,
      reasonLeaksPath: errorReason(save).includes(root),
    });
    record({
      id: fault.id,
      status: classified.status,
      detail:
        `PUT=${save.status}/${save.json?.error?.code ?? ''} ${errorReason(save).slice(0, 120)}；` +
        `page=${pageState} manifest=${manifestState}；tmp=[${tempFiles.join(',')}]；重启读=${readBack.status}；` +
        `判定=${classified.reason}${classified.observations.length === 0 ? '' : `；观察=${classified.observations.join(',')}`}`,
      evidence: { target: fault.target, observations: classified.observations },
    });
  }
}

// ---- 7) 凭据 / 遥测 --------------------------------------------------------

async function runSecretsCase() {
  const root = await caseRoot('secrets');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'secrets' });
  try {
    const set = await call(daemon.url, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
    const config = await call(daemon.url, 'GET', '/config');
    const credentialsFile = await readFile(join(dataRoot, 'credentials.json'), 'utf8').catch(
      () => '',
    );
    const keyFile = await readFile(join(dataRoot, 'credentials.key'), 'utf8').catch(() => '');
    const credentialsMode = (await stat(join(dataRoot, 'credentials.json')).catch(() => null))
      ?.mode;
    const keyMode = (await stat(join(dataRoot, 'credentials.key')).catch(() => null))?.mode;
    const logs = `${daemon.output}\n${daemon.errorOutput}`;
    record(
      check(
        set.status === 200 &&
          !set.text.includes(SENTINEL_KEY) &&
          !set.text.includes(SENTINEL_FRAGMENT) &&
          !config.text.includes(SENTINEL_KEY) &&
          !config.text.includes(SENTINEL_FRAGMENT) &&
          !credentialsFile.includes(SENTINEL_KEY) &&
          !keyFile.includes(SENTINEL_KEY) &&
          !logs.includes(SENTINEL_KEY) &&
          !logs.includes(SENTINEL_FRAGMENT) &&
          credentialsMode !== undefined &&
          (credentialsMode & 0o777) === 0o600 &&
          keyMode !== undefined &&
          (keyMode & 0o777) === 0o600,
        'secrets.mask-modes-no-leak',
        `PUT=${set.status}；凭据/主密钥权限=${(credentialsMode & 0o777).toString(8)}/${(keyMode & 0o777).toString(8)}；响应/GET/磁盘/日志无明文或片段=${!set.text.includes(SENTINEL_FRAGMENT) && !config.text.includes(SENTINEL_FRAGMENT) && !credentialsFile.includes(SENTINEL_KEY) && !logs.includes(SENTINEL_FRAGMENT)}`,
      ),
    );

    const telemetry = await call(daemon.url, 'POST', '/telemetry/events', {
      name: 'export.completed',
      payload: {
        apiKey: SENTINEL_KEY,
        nested: { token: SENTINEL_KEY },
        list: [{ password: SENTINEL_KEY }],
        prompt: SENTINEL_KEY,
        note: 'hello',
      },
    });
    const eventsRaw = await readFile(join(dataRoot, 'telemetry', 'events.jsonl'), 'utf8').catch(
      () => '',
    );
    record(
      check(
        telemetry.status === 200 &&
          eventsRaw.includes('[redacted]') &&
          !eventsRaw.includes('"apiKey":"sk-') &&
          !eventsRaw.includes('"token":"sk-') &&
          !eventsRaw.includes('"password":"sk-'),
        'telemetry.sensitive-keys-redacted',
        `apiKey/token/password 值替换为 [redacted]（payload 其余字段保留）`,
      ),
    );
    record(
      eventsRaw.includes(SENTINEL_KEY)
        ? {
            id: 'telemetry.free-text-secret',
            status: STATUS.OBSERVE,
            detail:
              '非敏感键（prompt）下的哨兵值原样落盘——「key/token 永不落盘」依赖调用方使用敏感键名，缺值模式兜底',
          }
        : {
            id: 'telemetry.free-text-secret',
            status: STATUS.PASS,
            detail: '自由文本中的哨兵值未被落盘',
          },
    );

    const off = await call(daemon.url, 'PUT', '/config', { telemetry: { enabled: false } });
    await rm(join(dataRoot, 'telemetry', 'events.jsonl'), { force: true });
    const appendedOff = await call(daemon.url, 'POST', '/telemetry/events', {
      name: 'export.completed',
      payload: { a: 1 },
    });
    record(
      check(
        off.status === 200 &&
          appendedOff.json?.result?.stored === false &&
          !(await pathExists(join(dataRoot, 'telemetry', 'events.jsonl'))),
        'telemetry.disabled',
        `关闭后 POST → stored=${appendedOff.json?.result?.stored}，未落盘`,
      ),
    );

    const deepPayload = `{"name":"export.completed","payload":${'{"a":'.repeat(20_000)}1${'}'.repeat(20_000)}}`;
    const deep = await fetch(`${daemon.url}/telemetry/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: deepPayload,
    })
      .then(async (response) => ({ status: response.status }))
      .catch(() => ({ status: 0 }));
    record(
      check(deep.status < 500, 'telemetry.deep-payload', `20k 层嵌套 payload → ${deep.status}`),
    );

    const deepArgs = `{"tool":"df_apply_patch","caller":"mcp:zcode","args":${'{"a":'.repeat(20_000)}1${'}'.repeat(20_000)}}`;
    const deepMcp = await fetch(`${daemon.url}/mcp/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: deepArgs,
    })
      .then(async (response) => ({ status: response.status }))
      .catch(() => ({ status: 0 }));
    record(
      deepMcp.status >= 500
        ? {
            id: 'mcp.deep-args',
            status: STATUS.OBSERVE,
            detail: `20k 层嵌套 args → ${deepMcp.status}（JSON.stringify 栈溢出未映射为 4xx）`,
          }
        : {
            id: 'mcp.deep-args',
            status: STATUS.PASS,
            detail: `20k 层嵌套 args → ${deepMcp.status}`,
          },
    );
  } finally {
    await daemon.kill();
  }
}

// ---- 8) CORS（Origin: null） ----------------------------------------------

async function runCorsCase() {
  const root = await caseRoot('cors');
  const dataRoot = join(root, 'data');
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const daemon = await startDaemon({ dataRoot, workspaceDir: workspace, label: 'cors' });
  try {
    const nullGet = await call(daemon.url, 'GET', '/documents', undefined, { origin: 'null' });
    const nullPreflight = await call(daemon.url, 'OPTIONS', '/documents', undefined, {
      origin: 'null',
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'content-type',
    });
    record(
      check(
        nullGet.headers.get('access-control-allow-origin') !== 'null' ||
          !(nullPreflight.headers.get('access-control-allow-methods') ?? '').includes('DELETE'),
        'cors.origin-null',
        `Origin: null → GET allow-origin=${nullGet.headers.get('access-control-allow-origin')}；预检 ${nullPreflight.status} methods=${nullPreflight.headers.get('access-control-allow-methods')}（沙箱 iframe/本地 file:// 页面可读可写；浏览器实证见证据 probe5）`,
      ),
    );
    const evil = await call(daemon.url, 'GET', '/documents', undefined, {
      origin: 'http://evil.example.com',
    });
    record(
      check(
        evil.headers.get('access-control-allow-origin') === null,
        'cors.non-whitelisted',
        '非白名单 Origin 不回放行头（API 语义照常）',
      ),
    );
    const allowed = await call(daemon.url, 'GET', '/documents', undefined, {
      origin: 'http://localhost:3000',
    });
    record(
      check(
        allowed.headers.get('access-control-allow-origin') === 'http://localhost:3000',
        'cors.whitelisted',
        '白名单 Origin 精确回显',
      ),
    );
  } finally {
    await daemon.kill();
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(TMP_BASE, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  assertSafeTempBase(TMP_BASE);
  const startedAt = new Date().toISOString();

  console.log('[verify-resilience] 审计 03 韧性接缝：临时数据根 + 空闲端口 + 精确 PID 回收');
  console.log(`[verify-resilience] 证据根：${EVIDENCE_DIR}`);

  const sections = [
    ['path', runPathCase],
    ['corrupt-dfg', runCorruptDfgCase],
    ['symlink-in-root', runInRootSymlinkCase],
    ['cross-process', runCrossProcessCase],
    ['crash', runCrashCase],
    ['secrets', runSecretsCase],
    ['cors', runCorsCase],
  ];

  for (const [name, run] of sections) {
    console.log(`\n[verify-resilience] §${name}`);
    try {
      await run();
    } catch (error) {
      record({
        id: `section.${name}.error`,
        status: STATUS.BLOCKED,
        detail: `用例段未完成（环境/工装问题）：${String(error).slice(0, 500)}`,
      });
    }
  }

  console.log('\n[verify-resilience] §fault-injection');
  try {
    const shim = await compileShim();
    console.log(`  shim 已编译：sha256=${shim.sha256.slice(0, 16)}…`);
    await runFaultCase(shim);
  } catch (error) {
    for (const fault of FAULT_CASES) {
      record({
        id: fault.id,
        status: STATUS.BLOCKED,
        detail: `故障注入不可用（需要 C 编译器）：${String(error).slice(0, 300)}`,
      });
    }
  }

  await killAllDaemons();
  const exitCode = decideExitCode(steps);
  const summary = summarizeSteps(steps);
  const finishedAt = new Date().toISOString();

  const evidence = {
    page: 'verify-resilience',
    level: 'A',
    diff: { bbox: null, diffPixels: 0, ratio: 0 },
    artifacts: {
      ref: null,
      actual: null,
      diff: null,
      logs: LOG_DIR,
      fixtures: SHIM_SOURCE,
    },
    humanReview: { verdict: null, reviewer: null, reason: null },
    exitCode,
    meta: {
      startedAt,
      finishedAt,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      evidenceDir: EVIDENCE_DIR,
      tempBase: TMP_BASE,
      tempRoots: exitCode === 0 ? [] : tempRoots,
      stepsTotal: summary.total,
      stepsFailed: summary.fail,
      stepsBlocked: summary.blocked,
      stepsObserved: summary.observe,
      semantics: '0=通过 / 1=真违规 / 2=阻塞（阻塞不是通过）',
    },
    summary,
    steps,
  };
  const evidencePath = join(EVIDENCE_DIR, 'verify-resilience.evidence.json');
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(
    join(EVIDENCE_DIR, 'verify-resilience.stdout.txt'),
    `${JSON.stringify({ summary, exitCode }, null, 2)}\n`,
  );

  console.log(
    `\n[verify-resilience] 步骤 ${summary.total}：pass=${summary.pass} fail=${summary.fail} blocked=${summary.blocked} observe=${summary.observe}；退出码 ${exitCode}`,
  );
  console.log(`[verify-resilience] 证据：${evidencePath}`);
  if (exitCode === 0) {
    for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  } else {
    console.log(`[verify-resilience] 保留现场：${tempRoots.join('\n  ')}`);
  }
  process.exit(exitCode);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(THIS_FILE)) {
  main().catch(async (error) => {
    console.error('[verify-resilience] 未捕获异常：', error);
    await killAllDaemons();
    process.exit(2);
  });
}
