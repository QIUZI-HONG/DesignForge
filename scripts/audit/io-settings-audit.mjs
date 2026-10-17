#!/usr/bin/env node
/**
 * 审计 07 · 导入导出、设置与诊断深挖（#57）——**一次性审计脚本，不是门禁**。
 *
 * 为什么不接 CI / 不写成必红测试：本脚本的产出是「当前事实 + 缺陷证据」，允许产品处于
 * partial/broken 状态；结论落 `docs/quality/audit-v1/07-io-settings.md`。是否固化为回归
 * 由后续票决定（未实现能力只登记缺口，不写必红测试）。
 *
 * 覆盖：
 *   A. 导出：PNG/SVG/PDF 真实产物（尺寸/文本/位图/圆角/透明/空文档/负值/极端值/非法名）、
 *      外部查看器可用性（file/pdfinfo/pdftoppm/XML 解析）、导出尺寸上限（ulimit -v 子进程）；
 *   B. 导入与兼容：`.dfg` 外部导入缺失、页信封往返、跨版本 `$version`、损坏/深嵌套/超大 4xx、
 *      manifest schema 版本；
 *   C. 设置/诊断：工作目录切换（非法/不可写/被占用/空格/软链）、DeepSeek 哨兵 key、
 *      ComfyUI 地址校验与连通性（本地 fixture，不触达云端）、凭据库损坏复位、遥测开关/脱敏/删除。
 *
 * 纪律：
 * - 临时数据根 + 空闲端口；daemon 以证据目录为 cwd；不碰 4318/3000 与 `~/.dforge`；
 * - 不使用 `pkill -f`，只按子进程句柄/PID 回收；TMPDIR 落证据目录，不用 `/tmp`；
 * - 不写产品代码；证据落 `~/df-evidence/audit-50/aud-07/`；
 * - 退出码：0 = 审计完成（findings 已如实记录）；2 = 阻塞（daemon/fixture 起不来）；
 *   1 = 脚本自身异常。
 *
 * 用法（仓库根）：
 *   TMPDIR=~/df-evidence/audit-50/aud-07/tmp node scripts/audit/io-settings-audit.mjs
 *   … --skip-engine-probe（跳过跨界 $version 探查）
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAEMON_MAIN = join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts');
const EVIDENCE_ROOT = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', 'audit-50', 'aud-07'),
);
const RUN_ID = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const RUN_DIR = join(EVIDENCE_ROOT, 'runtime', RUN_ID);
const ARTIFACT_DIR = join(EVIDENCE_ROOT, 'artifacts');
const LOG_DIR = join(EVIDENCE_ROOT, 'logs');
const PROBE_DIR = join(EVIDENCE_ROOT, 'probes');
const TMP_DIR = join(EVIDENCE_ROOT, 'tmp');
const DAEMON_CWD = join(RUN_DIR, 'cwd');
const MAIN_DATA = join(RUN_DIR, 'data');
const MAIN_WS = join(RUN_DIR, 'workspace');
const ALT_WS = join(RUN_DIR, 'workspace-2');
const CORRUPT_DATA = join(RUN_DIR, 'corrupt-data');
const ENV_DATA = join(RUN_DIR, 'env-data');
const LIMIT_DATA = join(RUN_DIR, 'limit-data');

const args = process.argv.slice(2);
const skipEngineProbe = args.includes('--skip-engine-probe');

/** 哨兵 key（运行时拼接，避免被静态凭据扫描拦下；必须是合法形态）。 */
const SENTINEL_KEY = ['sk', 'audit', 'SENTINEL', '0123456789', 'abcdef'].join('-');
const SENTINEL_FRAGMENT = 'SENTINEL-0123456789';
const ENV_KEY = ['sk', 'env', 'SENTINEL', '9876543210', 'zyxwvu'].join('-');
/** ulimit -v：Node 24 + TS wasm 的 VmSize 基线约 9.9GB；10GiB 允许启动但阻止 3.6GB 分配。 */
const ULIMIT_KB = 10_485_760;

for (const dir of [RUN_DIR, ARTIFACT_DIR, LOG_DIR, PROBE_DIR, TMP_DIR, DAEMON_CWD]) {
  mkdirSync(dir, { recursive: true });
}

const evidence = {
  ticket: '#57',
  audit: 'audit-v1 · 07 导入导出、设置与诊断深挖',
  kind: 'one-off-audit（measure-only，不是门禁）',
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repo: REPO_ROOT,
    evidenceRoot: EVIDENCE_ROOT,
    tools: {},
  },
  staticFacts: {},
  sections: {
    export: [],
    importCompat: [],
    settings: [],
    diagnostics: [],
    telemetry: [],
  },
  artifacts: [],
  daemons: [],
  notes: [],
  exitCode: 2,
};

const children = new Set();
const fixtureRequests = [];
let fixtureServer = null;

function log(message) {
  console.log(`[audit-07] ${message}`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function record(section, id, status, detail, data = null) {
  evidence.sections[section].push({ id, status, detail, data, at: new Date().toISOString() });
  const mark = status === 'pass' ? 'ok' : status.toUpperCase();
  log(`  [${mark}] ${section}.${id} —— ${detail}`);
}

function check(section, id, ok, detail, data = null) {
  record(section, id, ok ? 'pass' : 'fail', detail, data);
  return Boolean(ok);
}

function observe(section, id, detail, data = null) {
  record(section, id, 'observe', detail, data);
}

function blocked(section, id, detail, data = null) {
  record(section, id, 'blocked', detail, data);
}

function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error === undefined ? null : String(result.error),
  };
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function freePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function call(baseUrl, method, path, body, timeoutMs = 120_000) {
  const init = {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, ok: response.ok };
  } catch (error) {
    return { status: 0, json: null, text: String(error), ok: false, networkError: String(error) };
  }
}

function errorCode(response) {
  return response.json?.error?.code ?? null;
}

function resultOf(response) {
  return response.json?.result ?? null;
}

async function startDaemon(options) {
  const port = options.port ?? (await freePort());
  const dataRoot = options.dataRoot;
  const workspaceDir = options.workspaceDir;
  const logPath = options.logPath;
  const env = {
    ...process.env,
    TMPDIR: TMP_DIR,
    DF_DEEPSEEK_API_KEY: options.envKey ?? '',
    ...(options.extraEnv ?? {}),
  };
  const nodeArgs = [
    DAEMON_MAIN,
    '--data-root',
    dataRoot,
    '--workspace',
    workspaceDir,
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
  ];
  let child;
  if (options.ulimitKb !== undefined) {
    const quoted = [process.execPath, ...nodeArgs].map((part) => `"${part}"`).join(' ');
    child = spawn('bash', ['-c', `ulimit -v ${String(options.ulimitKb)}; exec ${quoted}`], {
      cwd: DAEMON_CWD,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    child = spawn(process.execPath, nodeArgs, {
      cwd: DAEMON_CWD,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  children.add(child);
  child.on('exit', () => children.delete(child));
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => chunks.push(chunk.toString()));

  const baseUrl = await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`daemon 启动超时（10s）：${chunks.join('').slice(-800)}`));
    }, 10_000);
    const inspect = () => {
      const match = chunks.join('').match(/\[daemon\] listening on (http:\/\/[^\s]+)/);
      if (match !== null) {
        clearTimeout(timer);
        done(match[1]);
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon 提前退出（code=${String(code)}）：${chunks.join('').slice(-800)}`));
    });
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await sleep(250);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await sleep(100);
    writeFileSync(logPath, chunks.join(''));
  };
  evidence.daemons.push({
    port,
    dataRoot,
    workspaceDir,
    logPath,
    ulimitKb: options.ulimitKb ?? null,
  });
  return { baseUrl, child, logPath, chunks, stop, pid: child.pid };
}

function logOf(daemon) {
  return daemon.chunks.join('');
}

/** PNG 解码（daemon 编码固定 filter=0；不满足时抛错以暴露契约漂移）。 */
function decodeDaemonPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('PNG 魔数不匹配');
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (ihdr === undefined) throw new Error('缺 IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height) throw new Error('解压长度与尺寸不一致');
  for (let y = 0; y < height; y += 1) {
    if (raw[y * (stride + 1)] !== 0) throw new Error(`第 ${String(y)} 行 filter 非 0`);
  }
  const pixel = (x, y) => {
    const start = y * (stride + 1) + 1 + x * 4;
    return [raw[start] ?? -1, raw[start + 1] ?? -1, raw[start + 2] ?? -1, raw[start + 3] ?? -1];
  };
  return { width, height, bitDepth, colorType, pixel, raw, chunks };
}

/** P6 PPM 解码（pdftoppm 外部渲染结果）。 */
function decodePpm(buffer) {
  let index = 0;
  const token = () => {
    while (index < buffer.length) {
      const byte = buffer[index];
      if (byte === 0x23) {
        while (index < buffer.length && buffer[index] !== 0x0a) index += 1;
        continue;
      }
      if (byte === 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0d) {
        index += 1;
        continue;
      }
      break;
    }
    const start = index;
    while (
      index < buffer.length &&
      buffer[index] !== 0x20 &&
      buffer[index] !== 0x0a &&
      buffer[index] !== 0x09 &&
      buffer[index] !== 0x0d
    ) {
      index += 1;
    }
    return buffer.subarray(start, index).toString('ascii');
  };
  const magic = token();
  if (magic !== 'P6') throw new Error(`PPM 魔数不是 P6：${magic}`);
  const width = Number.parseInt(token(), 10);
  const height = Number.parseInt(token(), 10);
  const max = Number.parseInt(token(), 10);
  if (max !== 255) throw new Error(`PPM maxval 非 255：${max}`);
  index += 1; // 单空白分隔
  const dataStart = index;
  const pixel = (x, y) => {
    const start = dataStart + (y * width + x) * 3;
    return [buffer[start] ?? -1, buffer[start + 1] ?? -1, buffer[start + 2] ?? -1];
  };
  return { width, height, pixel };
}

function xmlWellFormed(filePath) {
  const result = runCommand('python3', [
    '-c',
    [
      'import json,sys,xml.etree.ElementTree as ET',
      'tree=ET.parse(sys.argv[1])',
      'root=tree.getroot()',
      'ns="{http://www.w3.org/2000/svg}"',
      'print(json.dumps({"root":root.tag,"children":len(list(root)),"texts":[ "".join(t.itertext()) for t in root.iter(ns+"text") ]}))',
    ].join('\n'),
    filePath,
  ]);
  if (result.status !== 0) return { ok: false, error: result.stderr.slice(0, 500) };
  try {
    return { ok: true, ...JSON.parse(result.stdout.trim()) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function artifactFromResponse(response, label, extension) {
  const artifact = resultOf(response)?.artifact;
  if (artifact === undefined || artifact === null) return null;
  const buffer = Buffer.from(artifact.base64, 'base64');
  const filePath = join(ARTIFACT_DIR, `${label}.${extension}`);
  writeFileSync(filePath, buffer);
  const entry = {
    label,
    filePath,
    serverFilePath: artifact.filePath,
    length: buffer.length,
    sha256: sha256(buffer),
    reportedLength: artifact.length,
    reportedSha256: artifact.sha256,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    skippedNodes: resultOf(response)?.skippedNodes ?? null,
  };
  evidence.artifacts.push(entry);
  return { artifact, buffer, filePath, entry };
}

async function exportFormat(daemon, documentId, pageId, format, extra = {}) {
  const response = await call(daemon.baseUrl, 'POST', '/export', {
    documentId,
    pageId,
    format,
    ...extra,
  });
  const extension = format;
  const scaleSuffix = extra.scale === undefined ? '' : `-scale${String(extra.scale)}`;
  const extracted =
    response.status === 200
      ? artifactFromResponse(response, `${documentId}-${pageId}-${format}${scaleSuffix}`, extension)
      : null;
  return { response, extracted };
}

/** 生成 20k 层嵌套页 JSON 字符串（外部导入件模拟）。 */
function deepJson(depth) {
  let body = '1';
  for (let i = 0; i < depth; i += 1) body = `{"children":[${body}]}`;
  return `{"frame":${body}}`;
}

function makeFileInputGrep() {
  const result = runCommand('bash', [
    '-c',
    `cd "${REPO_ROOT}" && grep -rn "type=\\"file\\"\\|type='file'\\|FileReader\\|showOpenFilePicker" apps/web/src apps/desktop/src --include=*.ts --include=*.tsx | wc -l`,
  ]);
  return Number.parseInt(result.stdout.trim() || '0', 10);
}

async function startFixture() {
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const url = request.url ?? '/';
      const recordEntry = {
        method: request.method,
        url,
        authorization: request.headers.authorization ?? null,
      };
      fixtureRequests.push(recordEntry);
      if (url.startsWith('/system_stats')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ devices: [{ name: 'audit-fixture', vram_total: 1024 }] }));
        return;
      }
      if (url.startsWith('/object_info')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: { required: { ckpt_name: [['fixture.safetensors']] } },
            },
          }),
        );
        return;
      }
      if (url.startsWith('/chat/completions')) {
        let raw = '';
        request.on('data', (chunk) => {
          raw += chunk.toString();
        });
        request.on('end', () => {
          recordEntry.body = raw.slice(0, 500);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              choices: [{ message: { content: 'fixture-ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          );
        });
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not-found' }));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      fixtureServer = { server, port, baseUrl: `http://127.0.0.1:${String(port)}` };
      done(fixtureServer);
    });
  });
}

function targetPageBody() {
  return {
    $format: 'dforge.canvas.page',
    $version: 1,
    page: {
      id: 'page-1',
      name: '页面 1',
      nodes: {
        'rect-1': {
          id: 'rect-1',
          type: 'rect',
          name: '红色矩形',
          x: 40,
          y: 40,
          width: 120,
          height: 80,
          rotation: 0,
          opacity: 1,
          fills: [{ type: 'solid', color: '#FF0000' }],
          strokes: [],
          cornerRadius: 0,
          children: [],
          visible: true,
          locked: false,
        },
      },
      rootIds: ['rect-1'],
      backgroundColor: '#112233',
      grid: { enabled: false, size: 8, color: '#FFFFFF' },
    },
    tokens: {},
  };
}

/** 简化渲染器能理解的「树状」页面（非编辑器真实格式：用于测渲染能力上限）。 */
function legacyPageBody() {
  return {
    width: 200,
    height: 120,
    background: '#FFFFFF',
    children: [
      { kind: 'rect', x: 10, y: 10, width: 60, height: 40, fill: '#FF0000', cornerRadius: 8 },
      { kind: 'ellipse', x: 100, y: 10, width: 60, height: 40, fill: '#0000FF', opacity: 0.5 },
      {
        kind: 'text',
        x: 10,
        y: 70,
        width: 120,
        height: 20,
        text: '审计<07> & "文本"',
        fontSize: 16,
        fill: '#333333',
      },
      { kind: 'image', x: 150, y: 70, width: 40, height: 40, src: 'data:image/png;base64,AAAA' },
      { kind: 'unknown-widget', x: 0, y: 0, width: 1, height: 1 },
      { kind: 'rect', x: -20, y: -20, width: 10, height: 10, fill: '#00FF00' },
    ],
  };
}

function transparentPageBody() {
  return {
    width: 64,
    height: 64,
    background: '#00000000',
    children: [{ kind: 'rect', x: 0, y: 0, width: 32, height: 64, fill: '#FF000080' }],
  };
}

async function seedDocument(daemon, id, name, body) {
  const created = await call(daemon.baseUrl, 'POST', '/documents', { name: name ?? id });
  const createStatus = created.status;
  let documentId = id;
  if (createStatus !== 200 && createStatus !== 201 && createStatus !== 409) {
    return { createStatus, documentId: null };
  }
  if (createStatus === 200 || createStatus === 201) {
    documentId = resultOf(created)?.document?.id ?? id;
  }
  if (body !== undefined) {
    const saved = await call(
      daemon.baseUrl,
      'PUT',
      `/documents/${encodeURIComponent(documentId)}/pages/page-1`,
      {
        body,
      },
    );
    return { createStatus, documentId, saveStatus: saved.status, saveCode: errorCode(saved) };
  }
  return { createStatus, documentId };
}

async function probeExportSurface(daemon) {
  log('A · 导出产物与保真');
  const legacy = await seedDocument(daemon, 'audit-legacy', '审计07-旧树', legacyPageBody());
  check(
    'export',
    'seed.legacy',
    legacy.saveStatus === 200,
    `旧树夹具落盘 ${String(legacy.saveStatus)}`,
    legacy,
  );
  const engine = await seedDocument(daemon, 'audit-engine', '审计07-真实信封', targetPageBody());
  check(
    'export',
    'seed.engine',
    engine.saveStatus === 200,
    `真实编辑器信封落盘 ${String(engine.saveStatus)}`,
    engine,
  );
  const empty = await seedDocument(daemon, 'audit-empty', '审计07-空文档', {});
  check(
    'export',
    'seed.empty',
    empty.createStatus === 201,
    `空文档创建 ${String(empty.createStatus)}`,
    empty,
  );
  const negative = await seedDocument(daemon, 'audit-negative', '审计07-负值', {
    width: -10,
    height: 0,
    background: '#FFFFFF',
    children: [],
  });
  check(
    'export',
    'seed.negative',
    negative.saveStatus === 200,
    `负值夹具 ${String(negative.saveStatus)}`,
    negative,
  );
  const transparent = await seedDocument(
    daemon,
    'audit-transparent',
    '审计07-透明',
    transparentPageBody(),
  );
  check(
    'export',
    'seed.transparent',
    transparent.saveStatus === 200,
    `透明夹具 ${String(transparent.saveStatus)}`,
    transparent,
  );

  // 旧树格式：三格式基础产物
  const png = await exportFormat(daemon, legacy.documentId, 'page-1', 'png');
  const pngOk = png.response.status === 200 && png.extracted !== null;
  check(
    'export',
    'legacy.png.status',
    pngOk,
    `PNG ${String(png.response.status)}`,
    png.extracted?.entry ?? png.response.json,
  );
  if (pngOk) {
    const decoded = decodeDaemonPng(png.extracted.buffer);
    check(
      'export',
      'legacy.png.dims',
      decoded.width === 200 && decoded.height === 120,
      `尺寸 ${String(decoded.width)}x${String(decoded.height)}`,
      { bitDepth: decoded.bitDepth, colorType: decoded.colorType },
    );
    check(
      'export',
      'legacy.png.bg',
      JSON.stringify(decoded.pixel(199, 119)) === JSON.stringify([255, 255, 255, 255]),
      `角落像素 ${JSON.stringify(decoded.pixel(199, 119))}`,
    );
    check(
      'export',
      'legacy.png.rect',
      JSON.stringify(decoded.pixel(30, 30)) === JSON.stringify([255, 0, 0, 255]),
      `矩形中心 ${JSON.stringify(decoded.pixel(30, 30))}`,
    );
    check(
      'export',
      'legacy.png.rounded-corner',
      JSON.stringify(decoded.pixel(11, 11)) === JSON.stringify([255, 255, 255, 255]),
      `圆角外像素仍是背景 ${JSON.stringify(decoded.pixel(11, 11))}`,
    );
    const ellipse = decoded.pixel(130, 30);
    check(
      'export',
      'legacy.png.ellipse-opacity',
      ellipse[2] > 100 && ellipse[0] > 100,
      `椭圆半透明混合 ${JSON.stringify(ellipse)}`,
    );
    check(
      'export',
      'legacy.png.text-skipped',
      JSON.stringify(decoded.pixel(20, 80)) === JSON.stringify([255, 255, 255, 255]),
      `文本位置为空（简化实现跳过文本） ${JSON.stringify(decoded.pixel(20, 80))}`,
    );
    check(
      'export',
      'legacy.png.sha-self-consistent',
      png.extracted.entry.length === png.extracted.entry.reportedLength &&
        png.extracted.entry.sha256 === png.extracted.entry.reportedSha256,
      'length/sha256 与产物一致',
    );
  }
  const pngScale2 = await exportFormat(daemon, legacy.documentId, 'page-1', 'png', { scale: 2 });
  if (pngScale2.response.status === 200) {
    const decoded = decodeDaemonPng(pngScale2.extracted.buffer);
    check(
      'export',
      'legacy.png.scale2',
      decoded.width === 400 && decoded.height === 240,
      `scale=2 → ${String(decoded.width)}x${String(decoded.height)}`,
    );
  } else {
    check(
      'export',
      'legacy.png.scale2',
      false,
      `scale=2 失败 ${String(pngScale2.response.status)}`,
    );
  }
  const pngScale5 = await exportFormat(daemon, legacy.documentId, 'page-1', 'png', { scale: 5 });
  if (pngScale5.response.status === 200) {
    const decoded = decodeDaemonPng(pngScale5.extracted.buffer);
    check(
      'export',
      'legacy.png.scale-clamp',
      decoded.width === 800 && decoded.height === 480,
      `scale=5 被夹到 4 → ${String(decoded.width)}x${String(decoded.height)}`,
      { maxScale: resultOf(pngScale5.response)?.maxScale },
    );
  } else {
    check(
      'export',
      'legacy.png.scale-clamp',
      false,
      `scale=5 失败 ${String(pngScale5.response.status)}`,
    );
  }
  const pngScaleHuge = await exportFormat(daemon, legacy.documentId, 'page-1', 'png', {
    scale: 1e9,
  });
  if (pngScaleHuge.response.status === 200) {
    const decoded = decodeDaemonPng(pngScaleHuge.extracted.buffer);
    check(
      'export',
      'legacy.png.scale-1e9-clamp',
      decoded.width === 800,
      `scale=1e9 被夹到 4 → ${String(decoded.width)}`,
    );
  } else {
    check(
      'export',
      'legacy.png.scale-1e9-clamp',
      false,
      `scale=1e9 失败 ${String(pngScaleHuge.response.status)}`,
    );
  }
  for (const [label, value] of [
    ['zero', 0],
    ['negative', -1],
    ['string', '2'],
    ['null', null],
  ]) {
    const bad = await exportFormat(daemon, legacy.documentId, 'page-1', 'png', { scale: value });
    check(
      'export',
      `legacy.png.scale-${label}`,
      bad.response.status === 400 && errorCode(bad.response) === 'bad_request',
      `scale=${JSON.stringify(value)} → ${String(bad.response.status)} ${String(errorCode(bad.response))}`,
    );
  }

  const svg = await exportFormat(daemon, legacy.documentId, 'page-1', 'svg');
  const svgOk = svg.response.status === 200 && svg.extracted !== null;
  check(
    'export',
    'legacy.svg.status',
    svgOk,
    `SVG ${String(svg.response.status)}`,
    svg.extracted?.entry ?? svg.response.json,
  );
  if (svgOk) {
    const text = svg.extracted.buffer.toString('utf8');
    check(
      'export',
      'legacy.svg.structure',
      /<svg[^>]+width="200" height="120"/.test(text) &&
        text.includes('<ellipse') &&
        text.includes('rx="8"'),
      'SVG 含尺寸/椭圆/圆角矩形',
    );
    check(
      'export',
      'legacy.svg.text',
      text.includes('<text') && text.includes('审计&lt;07&gt; &amp; &quot;文本&quot;'),
      'SVG 文本存在且 XML 转义',
    );
    check(
      'export',
      'legacy.svg.image-placeholder',
      text.includes('stroke="#B3B3B3"') && text.includes('fill="none"'),
      '图片节点为占位框（无位图嵌入）',
    );
    check(
      'export',
      'legacy.svg.opacity',
      text.includes('opacity="0.5"'),
      '透明度输出为 SVG opacity',
    );
    const xml = xmlWellFormed(svg.extracted.filePath);
    check(
      'export',
      'legacy.svg.xml',
      xml.ok === true && xml.root === '{http://www.w3.org/2000/svg}svg',
      `XML 解析 ${xml.ok ? '通过' : String(xml.error)}`,
      xml,
    );
  }

  const pdf = await exportFormat(daemon, legacy.documentId, 'page-1', 'pdf');
  const pdfOk = pdf.response.status === 200 && pdf.extracted !== null;
  check(
    'export',
    'legacy.pdf.status',
    pdfOk,
    `PDF ${String(pdf.response.status)}`,
    pdf.extracted?.entry ?? pdf.response.json,
  );
  if (pdfOk) {
    const text = pdf.extracted.buffer.toString('utf8');
    check(
      'export',
      'legacy.pdf.magic',
      text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'),
      '魔数与 EOF',
    );
    check('export', 'legacy.pdf.page-count', text.includes('/Count 1'), '单页');
    check(
      'export',
      'legacy.pdf.mediabox',
      text.includes('/MediaBox [0 0 200 120]'),
      'MediaBox 尺寸',
    );
    const startxref = Number.parseInt(text.match(/startxref\n(\d+)/)?.[1] ?? '-1', 10);
    const pointsToXref = startxref > 0 && text.slice(startxref, startxref + 4) === 'xref';
    check(
      'export',
      'legacy.pdf.startxref',
      pointsToXref,
      `startxref=${String(startxref)} 指向 ${JSON.stringify(text.slice(startxref, startxref + 8))}`,
    );
    check(
      'export',
      'legacy.pdf.no-text',
      !text.includes('审计'),
      'PDF 未含文本（简化实现跳过文本）',
    );
    const info = runCommand('pdfinfo', [pdf.extracted.filePath]);
    const pages = Number.parseInt(info.stdout.match(/Pages:\s+(\d+)/)?.[1] ?? '-1', 10);
    const sizeMatch = info.stdout.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
    check(
      'export',
      'legacy.pdf.external-pdfinfo',
      info.status === 0 &&
        pages === 1 &&
        sizeMatch !== null &&
        Math.round(Number(sizeMatch[1])) === 200 &&
        Math.round(Number(sizeMatch[2])) === 120,
      `pdfinfo status=${String(info.status)} pages=${String(pages)} size=${sizeMatch === null ? 'n/a' : `${sizeMatch[1]}x${sizeMatch[2]}`}`,
      { stderr: info.stderr.slice(0, 300) },
    );
    const ppmPrefix = join(ARTIFACT_DIR, 'legacy-pdf-render');
    const asciiPdf = join(ARTIFACT_DIR, 'legacy-pdf-ascii.pdf');
    copyFileSync(pdf.extracted.filePath, asciiPdf);
    const render = runCommand('pdftoppm', ['-r', '72', '-singlefile', asciiPdf, ppmPrefix]);
    if (render.status === 0) {
      const ppm = decodePpm(readFileSync(`${ppmPrefix}.ppm`));
      const red = ppm.pixel(30, 30);
      const blue = ppm.pixel(130, 30);
      check(
        'export',
        'legacy.pdf.external-render',
        ppm.width === 200 && ppm.height === 120 && red[0] > 200 && red[1] < 60 && blue[2] > 100,
        `外部渲染 ${String(ppm.width)}x${String(ppm.height)} red=${JSON.stringify(red)} blue=${JSON.stringify(blue)}`,
      );
    } else {
      blocked(
        'export',
        'legacy.pdf.external-render',
        `pdftoppm 失败：${render.stderr.slice(0, 200)}`,
      );
    }
  }

  // 真实编辑器信封：期望能渲染出红色矩形；实际为空白 → 保真缺陷
  const enginePng = await exportFormat(daemon, engine.documentId, 'page-1', 'png');
  if (enginePng.response.status === 200) {
    const decoded = decodeDaemonPng(enginePng.extracted.buffer);
    const center = decoded.pixel(100, 80);
    check(
      'export',
      'engine.png.fidelity',
      decoded.width !== 1440 || JSON.stringify(center) !== JSON.stringify([255, 255, 255, 255]),
      `真实信封导出 ${String(decoded.width)}x${String(decoded.height)}，矩形中心=${JSON.stringify(center)}（期望红色/背景 #112233）`,
      { skippedNodes: resultOf(enginePng.response)?.skippedNodes ?? null },
    );
    check(
      'export',
      'engine.png.background',
      JSON.stringify(decoded.pixel(5, 5)) !== JSON.stringify([255, 255, 255, 255]),
      `页面 backgroundColor #112233 未生效（角落=${JSON.stringify(decoded.pixel(5, 5))}）`,
    );
  } else {
    check(
      'export',
      'engine.png.fidelity',
      false,
      `真实信封导出失败 ${String(enginePng.response.status)}`,
    );
  }
  const engineSvg = await exportFormat(daemon, engine.documentId, 'page-1', 'svg');
  if (engineSvg.response.status === 200) {
    const text = engineSvg.extracted.buffer.toString('utf8');
    check(
      'export',
      'engine.svg.fidelity',
      text.includes('fill="#FF0000"'),
      `真实信封 SVG 含红色矩形=${String(text.includes('fill="#FF0000"'))}，rect 数=${String((text.match(/<rect/g) ?? []).length)}（${String(text.length)} 字节）`,
    );
  }
  const enginePdf = await exportFormat(daemon, engine.documentId, 'page-1', 'pdf');
  if (enginePdf.response.status === 200) {
    const text = enginePdf.extracted.buffer.toString('utf8');
    check(
      'export',
      'engine.pdf.fidelity',
      text.includes('/MediaBox [0 0 1440 900]') && text.includes('1 0 0 rg'),
      `真实信封 PDF MediaBox=${String(text.match(/MediaBox \[[^\]]+\]/)?.[0] ?? 'n/a')}，含红色填充=${String(text.includes('1 0 0 rg'))}（${String(enginePdf.extracted.buffer.length)} 字节）`,
    );
  }

  // 空文档
  const emptyPng = await exportFormat(daemon, empty.documentId, 'page-1', 'png');
  if (emptyPng.response.status === 200) {
    const decoded = decodeDaemonPng(emptyPng.extracted.buffer);
    check(
      'export',
      'empty.png',
      decoded.width === 1440 &&
        decoded.height === 900 &&
        JSON.stringify(decoded.pixel(0, 0)) === JSON.stringify([255, 255, 255, 255]),
      `空文档 → ${String(decoded.width)}x${String(decoded.height)} 白底`,
    );
  } else {
    check('export', 'empty.png', false, `空文档导出失败 ${String(emptyPng.response.status)}`);
  }
  const emptySvg = await exportFormat(daemon, empty.documentId, 'page-1', 'svg');
  check(
    'export',
    'empty.svg',
    emptySvg.response.status === 200 &&
      emptySvg.extracted.buffer.toString('utf8').includes('width="1440" height="900"'),
    `空文档 SVG ${String(emptySvg.response.status)}`,
  );
  const emptyPdf = await exportFormat(daemon, empty.documentId, 'page-1', 'pdf');
  check(
    'export',
    'empty.pdf',
    emptyPdf.response.status === 200 &&
      emptyPdf.extracted.buffer.toString('utf8').includes('/MediaBox [0 0 1440 900]'),
    `空文档 PDF ${String(emptyPdf.response.status)}`,
  );

  // 负值 / 取整
  const negativePng = await exportFormat(daemon, negative.documentId, 'page-1', 'png');
  if (negativePng.response.status === 200) {
    const decoded = decodeDaemonPng(negativePng.extracted.buffer);
    check(
      'export',
      'negative.dims',
      decoded.width === 1 && decoded.height === 1,
      `负宽/零高 → ${String(decoded.width)}x${String(decoded.height)}（夹到 1）`,
    );
  } else {
    check('export', 'negative.dims', false, `负值导出失败 ${String(negativePng.response.status)}`);
  }

  // 透明背景
  const transparentPng = await exportFormat(daemon, transparent.documentId, 'page-1', 'png');
  if (transparentPng.response.status === 200) {
    const decoded = decodeDaemonPng(transparentPng.extracted.buffer);
    check(
      'export',
      'transparent.alpha',
      JSON.stringify(decoded.pixel(60, 60)) === JSON.stringify([0, 0, 0, 0]),
      `透明背景角落 ${JSON.stringify(decoded.pixel(60, 60))}`,
    );
    const half = decoded.pixel(10, 10);
    check(
      'export',
      'transparent.semi',
      half[3] > 100 && half[3] < 200,
      `半透明矩形 alpha=${String(half[3])}`,
    );
  } else {
    check(
      'export',
      'transparent.alpha',
      false,
      `透明文档导出失败 ${String(transparentPng.response.status)}`,
    );
  }

  // 非法名 / 不存在 / 超大尺寸（不分配 GB 级内存）
  const badFormat = await exportFormat(daemon, legacy.documentId, 'page-1', 'jpg');
  check(
    'export',
    'invalid.format',
    badFormat.response.status === 400 &&
      errorCode(badFormat.response) === 'export_unsupported_format',
    `format=jpg → ${String(badFormat.response.status)} ${String(errorCode(badFormat.response))}`,
  );
  const missingPage = await exportFormat(daemon, legacy.documentId, 'page-99', 'png');
  check(
    'export',
    'invalid.page',
    missingPage.response.status === 404 &&
      errorCode(missingPage.response) === 'export_page_not_found',
    `缺页 → ${String(missingPage.response.status)} ${String(errorCode(missingPage.response))}`,
  );
  const missingDoc = await exportFormat(daemon, 'no-such-doc', 'page-1', 'png');
  check(
    'export',
    'invalid.doc',
    missingDoc.response.status === 404 && errorCode(missingDoc.response) === 'doc_not_found',
    `缺文档 → ${String(missingDoc.response.status)} ${String(errorCode(missingDoc.response))}`,
  );
  const traversal = await call(daemon.baseUrl, 'POST', '/export', {
    documentId: '../evil',
    pageId: 'page-1',
    format: 'png',
  });
  check(
    'export',
    'invalid.traversal',
    traversal.status === 400 || traversal.status === 404,
    `documentId=../evil → ${String(traversal.status)} ${String(errorCode(traversal))}`,
  );
  const badPageId = await call(daemon.baseUrl, 'POST', '/export', {
    documentId: legacy.documentId,
    pageId: '../page-1',
    format: 'png',
  });
  check(
    'export',
    'invalid.page-id',
    badPageId.status === 400 && errorCode(badPageId) === 'doc_invalid_id',
    `pageId=../page-1 → ${String(badPageId.status)} ${String(errorCode(badPageId))}`,
  );
  const longPageId = await call(daemon.baseUrl, 'POST', '/export', {
    documentId: legacy.documentId,
    pageId: 'p'.repeat(300),
    format: 'png',
  });
  check(
    'export',
    'invalid.page-id-long',
    longPageId.status === 400,
    `300 字符 pageId → ${String(longPageId.status)} ${String(errorCode(longPageId))}`,
  );

  const absurd = await seedDocument(daemon, 'audit-absurd', '审计07-极端尺寸', {
    width: 1e308,
    height: 1e308,
    background: '#FFFFFF',
    children: [],
  });
  const absurdExport = await exportFormat(daemon, absurd.documentId, 'page-1', 'png');
  check(
    'export',
    'extreme.absurd',
    absurdExport.response.status === 500 &&
      errorCode(absurdExport.response) === 'export_render_failed',
    `1e308 尺寸 → ${String(absurdExport.response.status)} ${String(errorCode(absurdExport.response))}（RangeError 被捕获）`,
  );
  const aliveAfter = await call(daemon.baseUrl, 'GET', '/health');
  check(
    'export',
    'extreme.absurd.alive',
    aliveAfter.status === 200,
    `极端请求后 daemon 仍存活 ${String(aliveAfter.status)}`,
  );

  // 非有限数在 JSON 里不可表达；数值极端但可表示（100000²）→ TypedArray 上限
  const beyond = await seedDocument(daemon, 'audit-beyond', '审计07-TypedArray上限', {
    width: 100000,
    height: 100000,
    background: '#FFFFFF',
    children: [],
  });
  const beyondExport = await exportFormat(daemon, beyond.documentId, 'page-1', 'png');
  check(
    'export',
    'extreme.typed-array-limit',
    beyondExport.response.status === 500 &&
      errorCode(beyondExport.response) === 'export_render_failed',
    `100000x100000 → ${String(beyondExport.response.status)} ${String(errorCode(beyondExport.response))}`,
  );

  // 产物落盘路径安全与 base64 一致
  if (pngOk) {
    const serverPath = png.extracted.entry.serverFilePath;
    const inside = resolve(serverPath).startsWith(resolve(MAIN_DATA, 'exports'));
    check(
      'export',
      'artifact.path',
      inside && existsSync(serverPath),
      `产物落 ${serverPath}（在数据根 exports 内=${String(inside)}）`,
    );
    check(
      'export',
      'artifact.file-name',
      png.extracted.entry.fileName === `${legacy.documentId}-page-1.png`,
      `文件名 ${String(png.extracted.entry.fileName)}`,
    );
  }

  return { legacy, engine };
}

async function probeImportAndCompatibility(daemon, seeded) {
  log('B · 导入与跨版本兼容');
  const importRoute = await call(daemon.baseUrl, 'POST', '/import', {});
  const documentsImportRoute = await call(daemon.baseUrl, 'POST', '/documents/import', {
    name: 'x',
  });
  check(
    'importCompat',
    'import.route-absent',
    importRoute.status === 404 && documentsImportRoute.status === 404,
    `不存在导入路由：POST /import → ${String(importRoute.status)}，POST /documents/import → ${String(documentsImportRoute.status)}`,
  );
  const fileInputs = makeFileInputGrep();
  const debugSource = readFileSync(
    join(REPO_ROOT, 'apps/web/src/features/canvas/debug/canvas-debug.ts'),
    'utf8',
  );
  const importFallback = debugSource.includes(
    "importIr: options.extras?.importIr ?? (() => ({ ok: false, error: '未接入导入' }))",
  );
  check(
    'importCompat',
    'import.ui-absent',
    fileInputs === 0 && importFallback,
    `web/desktop 无 <input type=file>/FileReader/文件选择器（${String(fileInputs)} 处）；调试句柄 importIr 缺省返回「未接入导入」`,
    { fileInputs, importFallback },
  );
  const studioSource = readFileSync(
    join(REPO_ROOT, 'apps/web/src/features/canvas/studio/canvas-studio.tsx'),
    'utf8',
  );
  observe(
    'importCompat',
    'import.canvas-clipboard-only',
    studioSource.includes('navigator.clipboard') && studioSource.includes('importIr(text)')
      ? '/_canvas 取样页有「剪贴板读入 IR」按钮（非文件导入、非 .dfg 导入）'
      : '/_canvas 无可见导入入口',
  );

  // 真实页信封往返（含未知字段与未来 version）
  const futureBody = targetPageBody();
  futureBody.$version = 99;
  futureBody.futureField = { nested: [1, 2, 3] };
  futureBody.page.futureNodeField = 'keep-me';
  const writeFuture = await call(
    daemon.baseUrl,
    'PUT',
    `/documents/${seeded.engine.documentId}/pages/page-1`,
    { body: futureBody },
  );
  const readFuture = await call(
    daemon.baseUrl,
    'GET',
    `/documents/${seeded.engine.documentId}/pages/page-1`,
  );
  const roundTrip =
    readFuture.status === 200 &&
    JSON.stringify(resultOf(readFuture)?.body) === JSON.stringify(futureBody);
  check(
    'importCompat',
    'page-envelope.roundtrip',
    writeFuture.status === 200 && roundTrip,
    `未知字段/未来 $version 往返${roundTrip ? '逐字节一致' : '不一致'}`,
  );
  observe(
    'importCompat',
    'page-envelope.future-version',
    `页信封 $version=99 被 daemon 原样接受、web decodePageBody 也不拒绝（仅记录版本号）；未来页格式无拒绝/迁移闸门`,
  );

  // 引擎信封 $version 行为（跨包探查，临时测试文件不提交）
  if (!skipEngineProbe) {
    const probeFile = join(REPO_ROOT, 'packages/engine/src/__audit07-version-probe.test.ts');
    const outFile = join(PROBE_DIR, 'engine-version-probe.json');
    const probeSource = `import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createDocument } from './model';
import { parseDocument, serializeDocument } from './serialize/serialize';

it('audit07 version probe', () => {
  const base = createDocument({ id: 'audit-doc' });
  const cases: unknown[] = [1, 2, 99, 0, -1, 1.5, '1', null, undefined, 1e9];
  const out: Record<string, unknown> = { designIrVersion: 1, cases: [], bare: null, unknownFormat: null, pageEnvelope: null, roundTrip: null };
  const rows: unknown[] = [];
  for (const version of cases) {
    const envelope: Record<string, unknown> = { $format: 'dforge.designir', document: base };
    if (version !== undefined) envelope.$version = version;
    try {
      const parsed = parseDocument(envelope);
      rows.push({ input: version === undefined ? 'missing' : version, accepted: true, returnedVersion: parsed.version });
    } catch (error) {
      rows.push({ input: version === undefined ? 'missing' : version, accepted: false, error: String(error) });
    }
  }
  out.cases = rows;
  try {
    const parsed = parseDocument(JSON.parse(JSON.stringify(base)));
    out.bare = { accepted: true, version: parsed.version, enveloped: parsed.enveloped };
  } catch (error) {
    out.bare = { accepted: false, error: String(error) };
  }
  try {
    parseDocument({ $format: 'dforge.canvas.page', $version: 1, page: base.pages[0] });
    out.unknownFormat = { accepted: true };
  } catch (error) {
    out.unknownFormat = { accepted: false, error: String(error) };
  }
  try {
    parseDocument(serializeDocument(base));
    out.roundTrip = { accepted: true };
  } catch (error) {
    out.roundTrip = { accepted: false, error: String(error) };
  }
  writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(out, null, 2));
});
`;
    try {
      writeFileSync(probeFile, probeSource);
      const run = runCommand(
        'pnpm',
        [
          '--filter',
          '@dforge/engine',
          'exec',
          'vitest',
          'run',
          'src/__audit07-version-probe.test.ts',
          '--reporter=dot',
        ],
        {
          cwd: REPO_ROOT,
          timeout: 120_000,
          env: { ...process.env, TMPDIR: TMP_DIR },
        },
      );
      const probe = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null;
      const acceptedFuture = Array.isArray(probe?.cases)
        ? probe.cases
            .filter((row) => typeof row.input === 'number' && row.input > 1 && row.accepted)
            .map((row) => row.input)
        : [];
      check(
        'importCompat',
        'engine.version-probe',
        run.status === 0 && probe !== null,
        `引擎解析探查 exit=${String(run.status)}；未来版本被接受：${JSON.stringify(acceptedFuture)}`,
        probe,
      );
      observe(
        'importCompat',
        'engine.future-version-accepted',
        acceptedFuture.length > 0
          ? `$version=${JSON.stringify(acceptedFuture)} 全部被 parseDocument 接受（无拒绝/迁移）`
          : '未来 $version 被拒绝',
        { acceptedFuture },
      );
    } catch (error) {
      blocked('importCompat', 'engine.version-probe', `探查未完成：${String(error)}`);
    } finally {
      rmSync(probeFile, { force: true });
    }
  } else {
    blocked('importCompat', 'engine.version-probe', '按参数跳过（--skip-engine-probe）');
  }

  // manifest schema 版本矩阵
  const manifestPath = join(MAIN_WS, `${seeded.legacy.documentId}.dfg`, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check(
    'importCompat',
    'manifest.schema-v1',
    manifest.schema === 'df.dfg.manifest/v1' && Number.isInteger(manifest.version),
    `新建 manifest schema=${String(manifest.schema)} version=${String(manifest.version)}`,
    { schema: manifest.schema, version: manifest.version },
  );
  const futureManifestDir = join(MAIN_WS, 'audit-future-manifest.dfg');
  rmSync(futureManifestDir, { recursive: true, force: true });
  mkdirSync(join(futureManifestDir, 'pages'), { recursive: true });
  writeFileSync(
    join(futureManifestDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, id: 'audit-future-manifest', name: '未来 schema', schema: 'df.dfg.manifest/v2' }, null, 2)}\n`,
  );
  writeFileSync(join(futureManifestDir, 'pages/page-1.json'), '{}\n');
  const futureManifestGet = await call(daemon.baseUrl, 'GET', '/documents/audit-future-manifest');
  check(
    'importCompat',
    'manifest.future-schema',
    futureManifestGet.status === 422 && errorCode(futureManifestGet) === 'doc_invalid_manifest',
    `未来 schema → ${String(futureManifestGet.status)} ${String(errorCode(futureManifestGet))}`,
  );
  const futureList = await call(daemon.baseUrl, 'GET', '/documents');
  const warning = (resultOf(futureList)?.warnings ?? []).find(
    (item) => item.id === 'audit-future-manifest',
  );
  check(
    'importCompat',
    'manifest.future-schema-list-warning',
    warning?.code === 'manifest_invalid',
    `列表告警 ${JSON.stringify(warning ?? null)}`,
  );

  // 未来修订号（manifest.version）不是格式版本：整数 999 应被接受
  const versionManifestDir = join(MAIN_WS, 'audit-version-999.dfg');
  rmSync(versionManifestDir, { recursive: true, force: true });
  mkdirSync(join(versionManifestDir, 'pages'), { recursive: true });
  writeFileSync(
    join(versionManifestDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, id: 'audit-version-999', name: '修订号 999', version: 999 }, null, 2)}\n`,
  );
  writeFileSync(join(versionManifestDir, 'pages/page-1.json'), '{}\n');
  const version999 = await call(daemon.baseUrl, 'GET', '/documents/audit-version-999');
  observe(
    'importCompat',
    'manifest.version-999',
    `manifest.version=999（修订号）→ ${String(version999.status)}（修订号只校验整数，不当格式版本）`,
  );
  const fractionDir = join(MAIN_WS, 'audit-version-fraction.dfg');
  rmSync(fractionDir, { recursive: true, force: true });
  mkdirSync(join(fractionDir, 'pages'), { recursive: true });
  writeFileSync(
    join(fractionDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, id: 'audit-version-fraction', name: '修订号 1.5', version: 1.5 }, null, 2)}\n`,
  );
  writeFileSync(join(fractionDir, 'pages/page-1.json'), '{}\n');
  const fraction = await call(daemon.baseUrl, 'GET', '/documents/audit-version-fraction');
  check(
    'importCompat',
    'manifest.version-fraction',
    fraction.status === 422,
    `manifest.version=1.5 → ${String(fraction.status)} ${String(errorCode(fraction))}`,
  );

  // manifest.id 与目录名不一致：被接受还是拒绝？
  const mismatchDir = join(MAIN_WS, 'audit-manifest-mismatch.dfg');
  rmSync(mismatchDir, { recursive: true, force: true });
  mkdirSync(join(mismatchDir, 'pages'), { recursive: true });
  writeFileSync(
    join(mismatchDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, id: 'someone-else', name: 'id 不一致' }, null, 2)}\n`,
  );
  writeFileSync(join(mismatchDir, 'pages/page-1.json'), '{}\n');
  const mismatch = await call(daemon.baseUrl, 'GET', '/documents/audit-manifest-mismatch');
  observe(
    'importCompat',
    'manifest.id-mismatch',
    mismatch.status === 200
      ? '目录名/ manifest.id 不一致被接受（manifest 的 id 字段未与目录名交叉校验）'
      : `目录名/ manifest.id 不一致 → ${String(mismatch.status)} ${String(errorCode(mismatch))}`,
    { status: mismatch.status, id: resultOf(mismatch)?.document?.id ?? null },
  );

  // 损坏页 / 深嵌套页 / 孤儿目录
  const corrupt = await seedDocument(daemon, 'audit-corrupt-page', '审计07-损坏页', { ok: true });
  writeFileSync(join(MAIN_WS, `${corrupt.documentId}.dfg/pages/page-1.json`), '{not-json');
  const corruptRead = await call(
    daemon.baseUrl,
    'GET',
    `/documents/${encodeURIComponent(corrupt.documentId)}/pages/page-1`,
  );
  check(
    'importCompat',
    'corrupt.page-json',
    corruptRead.status === 400 && errorCode(corruptRead) === 'doc_invalid_body',
    `损坏页 → ${String(corruptRead.status)} ${String(errorCode(corruptRead))}`,
  );

  const deep = await seedDocument(daemon, 'audit-deep-page', '审计07-深嵌套', { ok: true });
  writeFileSync(join(MAIN_WS, `${deep.documentId}.dfg/pages/page-1.json`), deepJson(20_000));
  const deepRead = await call(
    daemon.baseUrl,
    'GET',
    `/documents/${encodeURIComponent(deep.documentId)}/pages/page-1`,
  );
  check(
    'importCompat',
    'deep.page-read-4xx',
    deepRead.status >= 400 && deepRead.status < 500,
    `20k 层嵌套页（外部放入）→ ${String(deepRead.status)} ${String(errorCode(deepRead))}（期望 4xx）`,
    {
      status: deepRead.status,
      code: errorCode(deepRead),
      reason: deepRead.json?.error?.details?.reason ?? null,
    },
  );
  const deepExport = await exportFormat(daemon, deep.documentId, 'page-1', 'png');
  observe(
    'importCompat',
    'deep.page-export',
    `深嵌套页导出 → ${String(deepExport.response.status)}（导出侧 2000 节点预算截断，不遍历深层）`,
    { status: deepExport.response.status },
  );

  const orphanDir = join(MAIN_WS, 'audit-orphan.dfg');
  rmSync(orphanDir, { recursive: true, force: true });
  mkdirSync(orphanDir, { recursive: true });
  const orphanList = await call(daemon.baseUrl, 'GET', '/documents');
  const orphanWarning = (resultOf(orphanList)?.warnings ?? []).find(
    (item) => item.id === 'audit-orphan',
  );
  const orphanDelete = await call(daemon.baseUrl, 'DELETE', '/documents/audit-orphan');
  observe(
    'importCompat',
    'orphan.delete',
    `缺 manifest 的 .dfg：列表告警=${JSON.stringify(orphanWarning?.code ?? null)}，DELETE → ${String(orphanDelete.status)} ${String(errorCode(orphanDelete))}（交叉引用 F-03-07）`,
  );

  // 保存边界：超大 / 深嵌套 / null
  const oversizedBody = { body: { padding: 'x'.repeat(1_200_000) } };
  const oversized = await call(
    daemon.baseUrl,
    'PUT',
    `/documents/${seeded.legacy.documentId}/pages/page-1`,
    oversizedBody,
  );
  check(
    'importCompat',
    'save.oversize',
    oversized.status === 400 || oversized.status === 413,
    `>1.2MiB 正文 → ${String(oversized.status)} ${String(errorCode(oversized))}`,
  );
  const deepBody = { body: JSON.parse(deepJson(2000)) };
  const deepSave = await call(
    daemon.baseUrl,
    'PUT',
    `/documents/${seeded.legacy.documentId}/pages/page-1`,
    deepBody,
  );
  check(
    'importCompat',
    'save.deep',
    deepSave.status === 400 && errorCode(deepSave) === 'doc_invalid_body',
    `2000 层正文保存 → ${String(deepSave.status)} ${String(errorCode(deepSave))}`,
  );
  const nullBody = await call(
    daemon.baseUrl,
    'PUT',
    `/documents/${seeded.legacy.documentId}/pages/page-1`,
    { body: null },
  );
  check(
    'importCompat',
    'save.null',
    nullBody.status === 400 && errorCode(nullBody) === 'doc_invalid_body',
    `body=null → ${String(nullBody.status)} ${String(errorCode(nullBody))}`,
  );
  const unknownBody = { body: { width: 10, height: 10, unknownField: { a: 1 }, children: [] } };
  const unknownSave = await call(
    daemon.baseUrl,
    'PUT',
    `/documents/${seeded.legacy.documentId}/pages/page-1`,
    unknownBody,
  );
  const unknownRead = await call(
    daemon.baseUrl,
    'GET',
    `/documents/${seeded.legacy.documentId}/pages/page-1`,
  );
  check(
    'importCompat',
    'save.unknown-fields',
    unknownSave.status === 200 &&
      JSON.stringify(resultOf(unknownRead)?.body) === JSON.stringify(unknownBody.body),
    '未知字段原样保留（opaque）',
  );
}

async function probeSettings(daemon, fixture, seeded) {
  log('C1 · 设置（工作目录 / 凭据 / ComfyUI / 连通性）');
  const initial = await call(daemon.baseUrl, 'GET', '/config');
  check(
    'settings',
    'config.initial',
    initial.status === 200 && resultOf(initial)?.config?.workspaceDir === MAIN_WS,
    `GET /config → ${String(initial.status)} workspace=${String(resultOf(initial)?.config?.workspaceDir)}`,
  );

  // 第二工作目录（含一个合法 .dfg）
  rmSync(ALT_WS, { recursive: true, force: true });
  mkdirSync(join(ALT_WS, 'other.dfg/pages'), { recursive: true });
  const altManifest = JSON.parse(
    readFileSync(join(MAIN_WS, `${seeded.legacy.documentId}.dfg/manifest.json`), 'utf8'),
  );
  writeFileSync(
    join(ALT_WS, 'other.dfg/manifest.json'),
    `${JSON.stringify({ ...altManifest, id: 'other', name: 'other' }, null, 2)}\n`,
  );
  writeFileSync(join(ALT_WS, 'other.dfg/pages/page-1.json'), '{}\n');
  const switchAlt = await call(daemon.baseUrl, 'PUT', '/config', { workspaceDir: ALT_WS });
  const listAlt = await call(daemon.baseUrl, 'GET', '/documents');
  const altIds = (resultOf(listAlt)?.documents ?? []).map((item) => item.id);
  check(
    'settings',
    'workspace.switch',
    switchAlt.status === 200 && JSON.stringify(altIds) === JSON.stringify(['other']),
    `切到第二工作目录 → ${String(switchAlt.status)}，文档=${JSON.stringify(altIds)}`,
  );
  const oldStillThere = existsSync(join(MAIN_WS, `${seeded.legacy.documentId}.dfg/manifest.json`));
  check(
    'settings',
    'workspace.old-untouched',
    oldStillThere,
    '切换不动旧工作目录文件（只改指针，无迁移/复制）',
  );
  const healthAlt = await call(daemon.baseUrl, 'GET', '/health');
  check(
    'settings',
    'workspace.health-follows',
    resultOf(healthAlt)?.workspaceDir === ALT_WS,
    `health.workspaceDir=${String(resultOf(healthAlt)?.workspaceDir)}`,
  );
  const switchBack = await call(daemon.baseUrl, 'PUT', '/config', { workspaceDir: MAIN_WS });
  const listMain = await call(daemon.baseUrl, 'GET', '/documents');
  const mainIds = (resultOf(listMain)?.documents ?? []).map((item) => item.id);
  check(
    'settings',
    'workspace.switch-back',
    switchBack.status === 200 && mainIds.includes(seeded.legacy.documentId),
    `切回 → ${String(switchBack.status)}，旧文档可见=${String(mainIds.includes(seeded.legacy.documentId))}`,
  );

  // 非法工作目录
  const blockerPath = join(RUN_DIR, 'blocker.txt');
  writeFileSync(blockerPath, 'x');
  const unwritable = join(RUN_DIR, 'unwritable');
  mkdirSync(unwritable, { recursive: true });
  chmodSync(unwritable, 0o500);
  const invalidCases = [
    ['empty', { workspaceDir: '' }],
    ['whitespace', { workspaceDir: '   ' }],
    ['under-file', { workspaceDir: `${blockerPath}/sub` }],
    ['file-itself', { workspaceDir: blockerPath }],
    ['nul', { workspaceDir: `${RUN_DIR}/bad\u0000name` }],
    ['too-long', { workspaceDir: join(RUN_DIR, 'a'.repeat(5000)) }],
    ['dev-null', { workspaceDir: '/dev/null/sub' }],
    ['unwritable', { workspaceDir: unwritable }],
  ];
  for (const [label, payload] of invalidCases) {
    const response = await call(daemon.baseUrl, 'PUT', '/config', payload);
    const readBack = await call(daemon.baseUrl, 'GET', '/config');
    check(
      'settings',
      `workspace.invalid-${label}`,
      response.status === 400 &&
        errorCode(response) === 'config_invalid' &&
        resultOf(readBack)?.config?.workspaceDir === MAIN_WS,
      `${label} → ${String(response.status)} ${String(errorCode(response))}；配置保持原值=${String(resultOf(readBack)?.config?.workspaceDir === MAIN_WS)}`,
      { message: response.json?.error?.message ?? null },
    );
  }
  blocked(
    'settings',
    'workspace.invalid-proc',
    '本环境不可判定：WSL2 下 Node 的 recursive mkdir 对 /proc/1/* 会无限挂起（纯 shell mkdir 立即 ENOENT）；该请求无响应、无超时，按环境阻塞记录',
  );
  chmodSync(unwritable, 0o700);

  // 空白环绕路径：API 不 trim，会按「相对路径」创建带空格的目录
  const paddedRelative = 'padded-ws ';
  const paddedResponse = await call(daemon.baseUrl, 'PUT', '/config', {
    workspaceDir: paddedRelative,
  });
  const paddedRead = await call(daemon.baseUrl, 'GET', '/config');
  const paddedValue = resultOf(paddedRead)?.config?.workspaceDir ?? null;
  observe(
    'settings',
    'workspace.whitespace-not-trimmed',
    paddedResponse.status === 200
      ? `PUT workspaceDir=${JSON.stringify(paddedRelative)} → 200，规范化结果=${JSON.stringify(paddedValue)}（未 trim；web 层会 trim，API 直连不会）`
      : `空白环绕路径 → ${String(paddedResponse.status)} ${String(errorCode(paddedResponse))}`,
    { paddedValue },
  );
  await call(daemon.baseUrl, 'PUT', '/config', { workspaceDir: MAIN_WS });
  rmSync(join(DAEMON_CWD, paddedRelative.trimEnd()), { recursive: true, force: true });

  // 软链工作目录
  const symlinkPath = join(RUN_DIR, 'symlink-ws');
  rmSync(symlinkPath, { force: true });
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(ALT_WS, symlinkPath, 'dir');
    const symlinkSwitch = await call(daemon.baseUrl, 'PUT', '/config', {
      workspaceDir: symlinkPath,
    });
    const symlinkList = await call(daemon.baseUrl, 'GET', '/documents');
    observe(
      'settings',
      'workspace.symlink',
      symlinkSwitch.status === 200
        ? `软链工作目录被接受（${String(symlinkPath)} → ${String(ALT_WS)}），列表含 ${String((resultOf(symlinkList)?.documents ?? []).length)} 项`
        : `软链工作目录被拒绝 → ${String(symlinkSwitch.status)} ${String(errorCode(symlinkSwitch))}`,
    );
    await call(daemon.baseUrl, 'PUT', '/config', { workspaceDir: MAIN_WS });
  } catch (error) {
    blocked('settings', 'workspace.symlink', `软链创建失败：${String(error)}`);
  }

  // 未知字段被静默忽略
  const unknownConfig = await call(daemon.baseUrl, 'PUT', '/config', {
    foo: { bar: 1 },
    workspaceDir: MAIN_WS,
  });
  check(
    'settings',
    'config.unknown-field',
    unknownConfig.status === 200,
    `未知顶层字段 → ${String(unknownConfig.status)}（静默忽略）`,
  );

  // DeepSeek key 哨兵
  const setKey = await call(daemon.baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
  const summary = resultOf(setKey)?.summary ?? null;
  const setKeyText = setKey.text;
  check(
    'settings',
    'credentials.set',
    setKey.status === 200 && summary?.hasKey === true && summary?.source === 'stored',
    `写入哨兵 key → ${String(setKey.status)} source=${String(summary?.source)}`,
    { maskedKey: summary?.maskedKey ?? null },
  );
  check(
    'settings',
    'credentials.masked',
    summary?.maskedKey === 'sk-…cdef',
    `只回掩码 ${String(summary?.maskedKey)}`,
  );
  check(
    'settings',
    'credentials.response-no-plaintext',
    !setKeyText.includes(SENTINEL_KEY) && !setKeyText.includes(SENTINEL_FRAGMENT),
    '写入响应不含明文/显著片段',
  );
  const configAfterKey = await call(daemon.baseUrl, 'GET', '/config');
  check(
    'settings',
    'credentials.config-no-plaintext',
    !configAfterKey.text.includes(SENTINEL_KEY) && !configAfterKey.text.includes(SENTINEL_FRAGMENT),
    'GET /config 不含明文',
  );
  const credentialsPath = join(MAIN_DATA, 'credentials.json');
  const keyPath = join(MAIN_DATA, 'credentials.key');
  const credentialsRaw = readFileSync(credentialsPath, 'utf8');
  check(
    'settings',
    'credentials.encrypted-at-rest',
    !credentialsRaw.includes(SENTINEL_KEY) && !credentialsRaw.includes(SENTINEL_FRAGMENT),
    'credentials.json 无明文',
  );
  const credMode = statSync(credentialsPath).mode & 0o777;
  const keyMode = statSync(keyPath).mode & 0o777;
  check(
    'settings',
    'credentials.file-mode',
    credMode === 0o600 && keyMode === 0o600,
    `credentials.json=${credMode.toString(8)} credentials.key=${keyMode.toString(8)}`,
  );
  const aiStatus = await call(daemon.baseUrl, 'GET', '/ai/status');
  observe(
    'settings',
    'credentials.ai-status',
    `GET /ai/status → ${String(aiStatus.status)} ${JSON.stringify(resultOf(aiStatus) ?? null).slice(0, 220)}`,
  );
  const telemetryDuringKey = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=100');
  check(
    'settings',
    'credentials.telemetry-no-plaintext',
    !telemetryDuringKey.text.includes(SENTINEL_KEY) &&
      !telemetryDuringKey.text.includes(SENTINEL_FRAGMENT),
    '遥测记录不含明文',
  );

  for (const [label, apiKey] of [
    ['no-prefix', '1234567890abcdef'],
    ['short', 'sk-short'],
    ['newline', `${SENTINEL_KEY}\nEVIL`],
    ['space', `${SENTINEL_KEY} `],
    ['unicode', 'sk-密钥密钥密钥密钥密钥'],
  ]) {
    const response = await call(daemon.baseUrl, 'PUT', '/config/credentials', { apiKey });
    check(
      'settings',
      `credentials.invalid-${label}`,
      response.status === 400 && errorCode(response) === 'credential_invalid',
      `${label} → ${String(response.status)} ${String(errorCode(response))}`,
    );
  }

  // 清除
  const clear = await call(daemon.baseUrl, 'DELETE', '/config/credentials');
  check(
    'settings',
    'credentials.clear',
    clear.status === 200 &&
      resultOf(clear)?.summary?.hasKey === false &&
      !existsSync(credentialsPath),
    `清除 → ${String(clear.status)} hasKey=false，credentials.json 已删除=${String(!existsSync(credentialsPath))}`,
  );

  // ComfyUI URL 校验
  const urlCases = [
    ['ftp', 'ftp://127.0.0.1/x'],
    ['javascript', 'javascript:alert(1)'],
    ['no-host', 'http://'],
    ['garbage', 'not-a-url'],
  ];
  for (const [label, url] of urlCases) {
    const response = await call(daemon.baseUrl, 'PUT', '/config', { comfy: { baseUrl: url } });
    check(
      'settings',
      `comfy.url-invalid-${label}`,
      response.status === 400 && errorCode(response) === 'config_invalid',
      `${label} → ${String(response.status)} ${String(errorCode(response))}`,
    );
  }
  const paddedUrl = ` ${fixture.baseUrl} `;
  const paddedUrlResponse = await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: { baseUrl: paddedUrl },
  });
  const paddedUrlConfig = await call(daemon.baseUrl, 'GET', '/config');
  observe(
    'settings',
    'comfy.url-not-trimmed',
    paddedUrlResponse.status === 200
      ? `带首尾空格的 URL 被接受并原样保存：${JSON.stringify(resultOf(paddedUrlConfig)?.config?.comfy?.baseUrl)}（URL 可解析但字符串未 trim）`
      : `带空格 URL 被拒绝 → ${String(paddedUrlResponse.status)}`,
  );

  // 连通性（本地 fixture；不触达云端）
  const fixtureBase = fixture.baseUrl;
  const pathUrl = `${fixtureBase}/prefix?token=1`;
  await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: { baseUrl: pathUrl, installPath: '/nonexistent/ComfyUI' },
  });
  const requestsBefore = fixtureRequests.length;
  const connectivityPath = await call(daemon.baseUrl, 'POST', '/config/connectivity');
  const pathRequests = fixtureRequests.slice(requestsBefore).map((item) => item.url);
  const comfyItem = (resultOf(connectivityPath)?.items ?? []).find((item) => item.id === 'comfyui');
  observe(
    'settings',
    'comfy.url-path-query',
    `baseUrl=${JSON.stringify(pathUrl)} → 探测请求 ${JSON.stringify(pathRequests)}；comfy 状态=${String(comfyItem?.status)}（URL 拼接为字符串，路径/查询保留在 ${'/system_stats'} 之前）`,
    { pathRequests, comfyStatus: comfyItem?.status ?? null },
  );

  await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: { baseUrl: fixtureBase, installPath: null },
  });
  const requestsBeforeOk = fixtureRequests.length;
  const connectivityOk = await call(daemon.baseUrl, 'POST', '/config/connectivity');
  const okItems = resultOf(connectivityOk)?.items ?? [];
  const okComfy = okItems.find((item) => item.id === 'comfyui');
  const okRequests = fixtureRequests.slice(requestsBeforeOk).map((item) => item.url);
  check(
    'settings',
    'comfy.connectivity-ok',
    connectivityOk.status === 200 &&
      okComfy?.status === 'ok' &&
      okRequests.includes('/system_stats') &&
      okRequests.includes('/object_info'),
    `fixture 探测：comfy=${String(okComfy?.status)} 请求=${JSON.stringify(okRequests)}`,
    { detail: okComfy?.detail ?? null },
  );
  const daemonItem = okItems.find((item) => item.id === 'daemon');
  const aiItem = okItems.find((item) => item.id === 'ai');
  check(
    'settings',
    'connectivity.items',
    daemonItem?.status === 'ok' && aiItem?.status === 'not-configured',
    `daemon=${String(daemonItem?.status)} ai=${String(aiItem?.status)} checkedAt=${String(resultOf(connectivityOk)?.checkedAt)}`,
  );
  check(
    'settings',
    'connectivity.no-secret-in-response',
    !connectivityOk.text.includes(SENTINEL_KEY),
    '连通性响应不含 key',
  );

  // AI 项不触达云端：把 ai.baseUrl 指向 fixture 后重跑连通性，fixture 不应收到 /chat/completions
  await call(daemon.baseUrl, 'PUT', '/config', { ai: { baseUrl: fixtureBase } });
  const requestsBeforeAi = fixtureRequests.length;
  await call(daemon.baseUrl, 'POST', '/config/connectivity');
  const aiProbeRequests = fixtureRequests.slice(requestsBeforeAi);
  check(
    'settings',
    'connectivity.ai-no-cloud',
    aiProbeRequests.every((item) => !item.url.includes('/chat/completions')),
    `连通性自检对 AI 无上游请求（fixture 收到 ${String(aiProbeRequests.length)} 次，其中 /chat/completions=${String(aiProbeRequests.filter((item) => item.url.includes('/chat/completions')).length)}）`,
  );

  // 配置的 ai.baseUrl 可以指向任意 http(s) 主机：写入 key 后 chat 会把 Bearer 发过去
  await call(daemon.baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
  const requestsBeforeChat = fixtureRequests.length;
  const chat = await call(daemon.baseUrl, 'POST', '/ai/chat', {
    messages: [{ role: 'user', content: 'hi' }],
  });
  const chatRequests = fixtureRequests
    .slice(requestsBeforeChat)
    .filter((item) => item.url.includes('/chat/completions'));
  const chatAuth = chatRequests[0]?.authorization ?? null;
  observe(
    'settings',
    'ai.baseUrl-redirects-key',
    `PUT /config ai.baseUrl=${fixtureBase} 被接受；POST /ai/chat → ${String(chat.status)}，上游收到 Authorization=${chatAuth === null ? 'n/a' : `${chatAuth.slice(0, 7)}…（Bearer <哨兵>）`}`,
    {
      chatStatus: chat.status,
      upstreamRequests: chatRequests.length,
      authPrefix: chatAuth === null ? null : chatAuth.slice(0, 7),
    },
  );
  check(
    'settings',
    'ai.chat-response-no-key',
    !chat.text.includes(SENTINEL_KEY),
    'AI 响应不含明文 key',
  );
  await call(daemon.baseUrl, 'DELETE', '/config/credentials');

  // Comfy 不可达 / 超时 / installPath
  await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: {
      baseUrl: `http://127.0.0.1:${String(await freePort())}`,
      installPath: '/nonexistent/ComfyUI',
    },
  });
  const unreachable = await call(daemon.baseUrl, 'POST', '/config/connectivity');
  const unreachableComfy = (resultOf(unreachable)?.items ?? []).find(
    (item) => item.id === 'comfyui',
  );
  check(
    'settings',
    'comfy.unreachable',
    unreachable.status === 200 &&
      unreachableComfy?.status === 'unavailable' &&
      unreachableComfy?.code === 'comfy_unreachable',
    `未启动 → comfy=${String(unreachableComfy?.status)} code=${String(unreachableComfy?.code)} actions=${JSON.stringify(unreachableComfy?.actions ?? [])}`,
    { detail: unreachableComfy?.detail ?? null },
  );
  check(
    'settings',
    'comfy.install-path-actions',
    (unreachableComfy?.actions ?? []).includes('launch'),
    `installPath 非空时 actions 含 launch=${String((unreachableComfy?.actions ?? []).includes('launch'))}`,
  );
  await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: { baseUrl: 'http://10.255.255.1:8188', installPath: null },
  });
  const started = Date.now();
  const timeoutProbe = await call(
    daemon.baseUrl,
    'POST',
    '/config/connectivity',
    undefined,
    20_000,
  );
  const elapsed = Date.now() - started;
  const timeoutComfy = (resultOf(timeoutProbe)?.items ?? []).find((item) => item.id === 'comfyui');
  observe(
    'settings',
    'comfy.blackhole',
    `不可路由地址探测耗时 ${String(elapsed)}ms，comfy=${String(timeoutComfy?.status)} code=${String(timeoutComfy?.code)} detail=${JSON.stringify((timeoutComfy?.detail ?? '').slice(0, 120))}`,
    { elapsedMs: elapsed },
  );
  await call(daemon.baseUrl, 'PUT', '/config', {
    comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
    ai: { baseUrl: 'https://api.deepseek.com' },
  });
}

async function probeDiagnosticsAndTelemetry(daemon) {
  log('C2 · 诊断与遥测');
  const health = await call(daemon.baseUrl, 'GET', '/health');
  const healthResult = resultOf(health);
  check(
    'diagnostics',
    'health.fields',
    health.status === 200 &&
      typeof healthResult?.version === 'string' &&
      typeof healthResult?.dataRoot === 'string' &&
      typeof healthResult?.workspaceDir === 'string' &&
      typeof healthResult?.uptimeMs === 'number',
    `health 字段 ${JSON.stringify({ version: healthResult?.version, dataRoot: healthResult?.dataRoot, workspaceDir: healthResult?.workspaceDir, uptimeMs: healthResult?.uptimeMs })}`,
  );
  const connectivity = await call(daemon.baseUrl, 'POST', '/config/connectivity');
  const items = resultOf(connectivity)?.items ?? [];
  check(
    'diagnostics',
    'connectivity.three-items',
    connectivity.status === 200 &&
      ['daemon', 'comfyui', 'ai'].every((id) => items.some((item) => item.id === id)) &&
      typeof resultOf(connectivity)?.checkedAt === 'string',
    `三项自检 ${JSON.stringify(items.map((item) => `${item.id}:${item.status}`))} checkedAt=${String(resultOf(connectivity)?.checkedAt)}`,
  );

  // 遥测：开关 / 脱敏 / 自由文本 / 删除
  await call(daemon.baseUrl, 'PUT', '/config', { telemetry: { enabled: true } });
  const append = await call(daemon.baseUrl, 'POST', '/telemetry/events', {
    name: 'page.saved',
    payload: { documentId: 'audit-legacy', pageId: 'page-1' },
  });
  check(
    'telemetry',
    'append',
    append.status === 200 && resultOf(append)?.stored === true,
    `写入事件 → stored=${String(resultOf(append)?.stored)} id=${String(resultOf(append)?.id)}`,
  );
  await call(daemon.baseUrl, 'POST', '/telemetry/events', {
    name: 'ai.run',
    payload: {
      apiKey: SENTINEL_KEY,
      nested: { authorization: 'Bearer xyz', token: 'abc' },
      list: [{ password: 'p' }],
      prompt: `请检查 ${SENTINEL_KEY}`,
      model: 'deepseek-chat',
    },
  });
  const eventsPath = join(MAIN_DATA, 'telemetry/events.jsonl');
  const telemetryRaw = readFileSync(eventsPath, 'utf8');
  const redactedCount = (telemetryRaw.match(/\[redacted\]/g) ?? []).length;
  check(
    'telemetry',
    'redact.sensitive-keys',
    /"apiKey":"\[redacted\]"/.test(telemetryRaw) &&
      /"token":"\[redacted\]"/.test(telemetryRaw) &&
      /"password":"\[redacted\]"/.test(telemetryRaw),
    `敏感键名（apiKey/authorization/token/password）替换为 [redacted]（共 ${String(redactedCount)} 处）`,
  );
  check(
    'telemetry',
    'free-text-secret',
    !telemetryRaw.includes(SENTINEL_KEY) && !telemetryRaw.includes(SENTINEL_FRAGMENT),
    '自由文本（prompt）中的 key 未原样落盘（期望修复 F-03-09）',
  );
  const fileMode = statSync(eventsPath).mode & 0o777;
  check('telemetry', 'file-mode', fileMode === 0o600, `events.jsonl 权限 ${fileMode.toString(8)}`);
  const query = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=1');
  check(
    'telemetry',
    'query.limit',
    query.status === 200 &&
      (resultOf(query)?.events ?? []).length === 1 &&
      typeof resultOf(query)?.total === 'number',
    `limit=1 返回 ${String((resultOf(query)?.events ?? []).length)} 条，total=${String(resultOf(query)?.total)}`,
  );
  const limitZero = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=0');
  const limitHuge = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=999999');
  observe(
    'telemetry',
    'query.limit-bounds',
    `limit=0 → ${String((resultOf(limitZero)?.events ?? []).length)} 条；limit=999999 → ${String((resultOf(limitHuge)?.events ?? []).length)} 条（上限 1000）`,
  );
  const badName = await call(daemon.baseUrl, 'POST', '/telemetry/events', {
    name: 'evil.tracker',
    payload: {},
  });
  check(
    'telemetry',
    'invalid-name',
    badName.status === 400 && errorCode(badName) === 'telemetry_invalid_event',
    `未知事件名 → ${String(badName.status)} ${String(errorCode(badName))}`,
  );
  await call(daemon.baseUrl, 'PUT', '/config', { telemetry: { enabled: false } });
  const beforeDisabledTotal =
    resultOf(await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=1'))?.total ?? -1;
  const disabled = await call(daemon.baseUrl, 'POST', '/telemetry/events', {
    name: 'doc.opened',
    payload: {},
  });
  const afterDisabled = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=1');
  const afterDisabledTotal = resultOf(afterDisabled)?.total ?? -2;
  check(
    'telemetry',
    'disabled',
    resultOf(disabled)?.stored === false &&
      resultOf(disabled)?.reason === 'disabled' &&
      afterDisabledTotal === beforeDisabledTotal,
    `关闭后只回执不落盘（stored=${String(resultOf(disabled)?.stored)} reason=${String(resultOf(disabled)?.reason)}，total ${String(beforeDisabledTotal)}→${String(afterDisabledTotal)}）`,
  );
  await call(daemon.baseUrl, 'PUT', '/config', { telemetry: { enabled: true } });
  const exportEventBefore = (
    resultOf(await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=1000'))?.events ?? []
  ).filter((event) => event.name === 'export.completed').length;
  await call(daemon.baseUrl, 'POST', '/export', {
    documentId: '审计07-旧树',
    pageId: 'page-1',
    format: 'svg',
  });
  await sleep(400);
  const afterExport = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=1000');
  const exportEvents = (resultOf(afterExport)?.events ?? []).filter(
    (event) => event.name === 'export.completed',
  );
  const exportPayload = exportEvents[0]?.payload ?? null;
  check(
    'telemetry',
    'export-event',
    exportEvents.length === exportEventBefore + 1 &&
      exportPayload !== null &&
      !JSON.stringify(exportPayload).includes('base64'),
    `导出事件数 ${String(exportEventBefore)}→${String(exportEvents.length)}；最新 payload=${JSON.stringify(exportPayload)}`,
  );
  copyFileSync(eventsPath, join(PROBE_DIR, 'telemetry-events-before-clear.jsonl'));
  const clear = await call(daemon.baseUrl, 'DELETE', '/telemetry/events');
  const afterClear = await call(daemon.baseUrl, 'GET', '/telemetry/events');
  check(
    'telemetry',
    'clear',
    clear.status === 200 && (resultOf(afterClear)?.total ?? -1) === 0,
    `清除 ${String(resultOf(clear)?.removed)} 条；之后 total=${String(resultOf(afterClear)?.total)}`,
  );
  const logs = await call(daemon.baseUrl, 'GET', '/telemetry/events?limit=8');
  observe(
    'diagnostics',
    'logs.tail',
    `诊断日志尾部来源为 /telemetry/events，当前 total=${String(resultOf(logs)?.total)}（本地 JSONL，不上云）`,
  );
}

async function probeCorruptCredentials() {
  log('C3 · 凭据库损坏与复位');
  rmSync(CORRUPT_DATA, { recursive: true, force: true });
  mkdirSync(CORRUPT_DATA, { recursive: true });
  writeFileSync(join(CORRUPT_DATA, 'credentials.key'), 'this-is-not-a-32-byte-base64-key\n', {
    mode: 0o600,
  });
  const daemon = await startDaemon({
    dataRoot: CORRUPT_DATA,
    workspaceDir: join(RUN_DIR, 'corrupt-ws'),
    logPath: join(LOG_DIR, 'daemon-corrupt.log'),
  });
  try {
    const put = await call(daemon.baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
    check(
      'settings',
      'credentials.corrupt-key-set-rejected',
      put.status === 400 && errorCode(put) === 'credential_invalid',
      `损坏主密钥后写入 → ${String(put.status)} ${String(errorCode(put))}：${String(put.json?.error?.message ?? '')}`,
    );
    const del = await call(daemon.baseUrl, 'DELETE', '/config/credentials');
    const keyStillBroken = readFileSync(join(CORRUPT_DATA, 'credentials.key'), 'utf8');
    const putAgain = await call(daemon.baseUrl, 'PUT', '/config/credentials', {
      apiKey: SENTINEL_KEY,
    });
    check(
      'settings',
      'credentials.corrupt-key-no-reset',
      del.status === 200 && keyStillBroken.startsWith('this-is-not') && putAgain.status === 400,
      `DELETE /config/credentials → ${String(del.status)}，但 credentials.key 未被删除/重建，再次写入 → ${String(putAgain.status)}（无复位入口，F-03-11）`,
    );
    const routes = readFileSync(join(REPO_ROOT, 'packages/contracts/src/ipc/routes.ts'), 'utf8');
    const hasResetRoute = /credential.*reset|reset.*credential/i.test(routes);
    observe(
      'settings',
      'credentials.reset-route-absent',
      hasResetRoute ? '路由表存在凭据复位路由' : '路由表无凭据复位路由（F-03-11 复现）',
    );
  } finally {
    await daemon.stop();
  }

  // credentials.json 损坏：视为空库，可重设
  rmSync(CORRUPT_DATA, { recursive: true, force: true });
  mkdirSync(CORRUPT_DATA, { recursive: true });
  writeFileSync(join(CORRUPT_DATA, 'credentials.json'), '{broken', { mode: 0o600 });
  const daemon2 = await startDaemon({
    dataRoot: CORRUPT_DATA,
    workspaceDir: join(RUN_DIR, 'corrupt-ws2'),
    logPath: join(LOG_DIR, 'daemon-corrupt-json.log'),
  });
  try {
    const put = await call(daemon2.baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
    check(
      'settings',
      'credentials.corrupt-json-recovers',
      put.status === 200 && resultOf(put)?.summary?.hasKey === true,
      `credentials.json 损坏 → 视为空库，重设 key ${String(put.status)}`,
    );
  } finally {
    await daemon2.stop();
  }
}

async function probeEnvCredentials() {
  log('C4 · 环境变量 key（只读回退）');
  rmSync(ENV_DATA, { recursive: true, force: true });
  const daemon = await startDaemon({
    dataRoot: ENV_DATA,
    workspaceDir: join(RUN_DIR, 'env-ws'),
    logPath: join(LOG_DIR, 'daemon-env.log'),
    envKey: ENV_KEY,
  });
  try {
    const config = await call(daemon.baseUrl, 'GET', '/config');
    const summary = resultOf(config)?.credentials?.deepseek ?? null;
    check(
      'settings',
      'credentials.env-source',
      summary?.hasKey === true && summary?.source === 'env' && summary?.maskedKey === 'sk-…xwvu',
      `env key 摘要 source=${String(summary?.source)} masked=${String(summary?.maskedKey)}`,
    );
    check(
      'settings',
      'credentials.env-no-plaintext',
      !config.text.includes(ENV_KEY) && !config.text.includes('SENTINEL-9876543210'),
      'GET /config 不含 env key 明文',
    );
    const put = await call(daemon.baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
    const afterPut = await call(daemon.baseUrl, 'GET', '/config');
    const afterSummary = resultOf(afterPut)?.credentials?.deepseek ?? null;
    observe(
      'settings',
      'credentials.env-precedence',
      `env 存在时写入本地 key → ${String(put.status)}；摘要仍为 source=${String(afterSummary?.source)}（env 优先，本地 key 被遮蔽）`,
    );
    const del = await call(daemon.baseUrl, 'DELETE', '/config/credentials');
    const afterDelete = await call(daemon.baseUrl, 'GET', '/config');
    const delSummary = resultOf(afterDelete)?.credentials?.deepseek ?? null;
    check(
      'settings',
      'credentials.env-clear-keeps-env',
      del.status === 200 && delSummary?.hasKey === true && delSummary?.source === 'env',
      `DELETE 后 env key 仍在：source=${String(delSummary?.source)}`,
    );
    check(
      'settings',
      'credentials.log-no-plaintext',
      !logOf(daemon).includes(ENV_KEY) && !logOf(daemon).includes(SENTINEL_KEY),
      'daemon 日志不含任何 key 明文',
    );
  } finally {
    await daemon.stop();
  }
}

async function probeSizeLimit() {
  log('D · 导出尺寸上限（ulimit -v 子进程，安全复现）');
  rmSync(LIMIT_DATA, { recursive: true, force: true });
  let daemon;
  try {
    daemon = await startDaemon({
      dataRoot: LIMIT_DATA,
      workspaceDir: join(RUN_DIR, 'limit-ws'),
      logPath: join(LOG_DIR, 'daemon-ulimit.log'),
      ulimitKb: ULIMIT_KB,
    });
  } catch (error) {
    blocked(
      'export',
      'ulimit.start',
      `ulimit=${String(ULIMIT_KB)}KB 下 daemon 未能启动：${String(error)}`,
    );
    return;
  }
  try {
    const created = await seedDocument(daemon, 'audit-huge', '审计07-大画布', {
      width: 30000,
      height: 30000,
      background: '#FFFFFF',
      children: [],
    });
    const rssBefore = Number.parseInt(
      runCommand('ps', ['-o', 'rss=', '-p', String(daemon.pid)]).stdout.trim() || '0',
      10,
    );
    const started = Date.now();
    const exported = await exportFormat(daemon, created.documentId, 'page-1', 'png');
    const elapsed = Date.now() - started;
    const rssAfter = Number.parseInt(
      runCommand('ps', ['-o', 'rss=', '-p', String(daemon.pid)]).stdout.trim() || '0',
      10,
    );
    check(
      'export',
      'size-limit.no-preflight-cap',
      exported.response.status === 500 && errorCode(exported.response) === 'export_render_failed',
      `30000x30000 PNG 在 ${String(ULIMIT_KB / 1024)}MiB 地址空间限制下 → ${String(exported.response.status)} ${String(errorCode(exported.response))}；耗时 ${String(elapsed)}ms，RSS ${String(rssBefore)}→${String(rssAfter)}KB（无尺寸预检，直接尝试 3.6GB 分配）`,
      { message: exported.response.json?.error?.message ?? null, rssBefore, rssAfter },
    );
    const health = await call(daemon.baseUrl, 'GET', '/health');
    check(
      'export',
      'size-limit.process-survives',
      health.status === 200,
      `分配失败后 daemon 仍在服务（GET /health → ${String(health.status)}）`,
    );
    observe(
      'export',
      'size-limit.no-oom-on-host',
      `未在无限制进程上触发 GB 级分配；证据以 ulimit 子进程获取（RSS 峰值 ${String(Math.max(rssBefore, rssAfter))}KB）`,
    );
  } finally {
    await daemon.stop();
  }
}

async function main() {
  log(`证据目录：${EVIDENCE_ROOT}`);
  log(`运行目录：${RUN_DIR}`);

  for (const tool of ['file', 'pdfinfo', 'pdftoppm', 'python3']) {
    const found = runCommand('bash', ['-c', `command -v ${tool}`]);
    evidence.environment.tools[tool] = found.status === 0 ? found.stdout.trim() : null;
  }
  evidence.environment.tools.rsvgConvert =
    runCommand('bash', ['-c', 'command -v rsvg-convert']).status === 0;

  // 静态事实（代码定位，供报告引用）
  const sceneSource = readFileSync(join(REPO_ROOT, 'apps/daemon/src/export/scene.ts'), 'utf8');
  const documentsClientSource = readFileSync(
    join(REPO_ROOT, 'apps/web/src/features/canvas/persistence/documents-client.ts'),
    'utf8',
  );
  evidence.staticFacts = {
    exportSceneTopLevel:
      /record\.children/.test(sceneSource) &&
      /record\.nodes/.test(sceneSource) &&
      !/record\.page/.test(sceneSource),
    exportSceneReadsPageEnvelope: /record\.page\b/.test(sceneSource),
    editorPageEnvelope:
      /CANVAS_PAGE_FORMAT/.test(documentsClientSource) &&
      /\$format: CANVAS_PAGE_FORMAT/.test(documentsClientSource),
    exportDimensionCap: /MAX_WIDTH|MAX_HEIGHT|MAX_PIXELS|maxDimension/.test(
      readFileSync(join(REPO_ROOT, 'apps/daemon/src/export/png.ts'), 'utf8') +
        readFileSync(join(REPO_ROOT, 'apps/daemon/src/export/index.ts'), 'utf8') +
        readFileSync(join(REPO_ROOT, 'apps/daemon/src/export/scene.ts'), 'utf8'),
    ),
    exportScaleCap: /EXPORT_MAX_SCALE = 4/.test(
      readFileSync(join(REPO_ROOT, 'apps/daemon/src/export/index.ts'), 'utf8'),
    ),
    engineFutureVersionReject:
      /version\s*>\s*DESIGN_IR_VERSION|DESIGN_IR_VERSION\s*<\s*version/.test(
        readFileSync(join(REPO_ROOT, 'packages/engine/src/serialize/serialize.ts'), 'utf8'),
      ),
    importRoutes: /documents\/import|importDocument/.test(
      readFileSync(join(REPO_ROOT, 'packages/contracts/src/ipc/routes.ts'), 'utf8'),
    ),
    credentialResetRoute: /credential.*reset|reset.*credential/i.test(
      readFileSync(join(REPO_ROOT, 'packages/contracts/src/ipc/routes.ts'), 'utf8'),
    ),
    workspacePatchTrims: /next\.workspaceDir = normalizePath\(input\.workspaceDir\.trim\(\)\)/.test(
      readFileSync(join(REPO_ROOT, 'apps/daemon/src/config/store.ts'), 'utf8'),
    ),
  };

  let mainDaemon;
  let fixture;
  try {
    fixture = await startFixture();
    log(`fixture HTTP 监听于 ${fixture.baseUrl}`);
    rmSync(MAIN_DATA, { recursive: true, force: true });
    rmSync(MAIN_WS, { recursive: true, force: true });
    mkdirSync(MAIN_WS, { recursive: true });
    mainDaemon = await startDaemon({
      dataRoot: MAIN_DATA,
      workspaceDir: MAIN_WS,
      logPath: join(LOG_DIR, 'daemon-main.log'),
    });
    log(`daemon 监听于 ${mainDaemon.baseUrl}（pid=${String(mainDaemon.pid)}）`);
  } catch (error) {
    blocked('export', 'daemon.start', `主 daemon/fixture 启动失败：${String(error)}`);
    evidence.exitCode = 2;
    return;
  }

  try {
    const seeded = await probeExportSurface(mainDaemon);
    await probeImportAndCompatibility(mainDaemon, seeded);
    await probeSettings(mainDaemon, fixture, seeded);
    await probeDiagnosticsAndTelemetry(mainDaemon);
    const logText = logOf(mainDaemon);
    check(
      'settings',
      'all.log-no-sentinel',
      !logText.includes(SENTINEL_KEY) && !logText.includes(SENTINEL_FRAGMENT),
      `主 daemon 日志不含哨兵 key 明文/片段（${String(logText.length)} 字节）`,
    );
  } catch (error) {
    blocked('export', 'section.crash', `某段探查异常中止：${String(error)}`, {
      stack: String(error?.stack ?? ''),
    });
  } finally {
    await mainDaemon.stop();
  }

  try {
    await probeCorruptCredentials();
  } catch (error) {
    blocked('settings', 'credentials.corrupt-probe', `损坏凭据探查异常：${String(error)}`);
  }
  try {
    await probeEnvCredentials();
  } catch (error) {
    blocked('settings', 'credentials.env-probe', `env 凭据探查异常：${String(error)}`);
  }
  try {
    await probeSizeLimit();
  } catch (error) {
    blocked('export', 'size-limit.probe', `尺寸上限探查异常：${String(error)}`);
  }

  if (fixtureServer !== null) {
    writeFileSync(
      join(PROBE_DIR, 'fixture-requests.json'),
      `${JSON.stringify(fixtureRequests, null, 2)}\n`,
    );
    await new Promise((done) => fixtureServer.server.close(done));
  }

  const all = Object.values(evidence.sections).flat();
  evidence.summary = {
    total: all.length,
    pass: all.filter((item) => item.status === 'pass').length,
    fail: all.filter((item) => item.status === 'fail').length,
    observe: all.filter((item) => item.status === 'observe').length,
    blocked: all.filter((item) => item.status === 'blocked').length,
  };
  evidence.finishedAt = new Date().toISOString();
  const infraBlockedIds = new Set(['daemon.start', 'section.crash', 'ulimit.start']);
  const infraBlocked = all.filter(
    (item) => item.status === 'blocked' && infraBlockedIds.has(item.id),
  );
  evidence.exitCode = infraBlocked.length > 0 ? 2 : 0;
  const evidencePath = join(EVIDENCE_ROOT, 'io-settings-audit.evidence.json');
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`完成：${JSON.stringify(evidence.summary)}；证据 ${evidencePath}`);
  process.exitCode = evidence.exitCode;
}

main()
  .catch((error) => {
    console.error(`[audit-07] 脚本异常：${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已退出
      }
    }
  });
