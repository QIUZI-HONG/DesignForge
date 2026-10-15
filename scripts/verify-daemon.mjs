#!/usr/bin/env node
/**
 * verify-daemon —— INF-01 门禁：真实启动 daemon（临时数据目录）→ 契约冒烟（每路由一成功一失败）
 * → 输出功能证据 JSON（《前端验收标准 v1》§4 字段；`scripts/` 内不引 contracts，凭形状对齐）。
 *
 * 退出码语义（禁止假绿）：`0 = 通过`；`1 = 违规`（冒烟断言失败）；`2 = 阻塞`（daemon 未能启动）。
 * 证据落仓库外：`~/df-evidence/inf-01/verify-daemon.evidence.json`（同文件同时落
 * `artifacts/verify-daemon/`，该目录已 gitignore，仅作本地副本）。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts', 'verify-daemon');
const EVIDENCE_OUTSIDE = join(homedir(), 'df-evidence', 'inf-01', 'verify-daemon.evidence.json');
/** 冒烟用的哨兵 key：全链路（响应/日志/落盘）不得出现其明文或其显著片段。 */
const SENTINEL_KEY = 'sk-verify-SENTINEL-0123456789-wxyz';
const SENTINEL_FRAGMENT = 'SENTINEL-0123456789';
/** 未启动态验证：指向一个必定无服务的回环端口（对本机可能真实运行的 ComfyUI 保持无假设）。 */
const DEAD_COMFY_URL = 'http://127.0.0.1:59999';

const steps = [];
const startedAt = new Date().toISOString();

function record(id, ok, detail) {
  steps.push({ id, ok, detail });
  const mark = ok ? 'ok' : 'FAIL';
  console.log(`  [${mark}] ${id} —— ${detail}`);
}

async function sleep(ms) {
  await new Promise((settle) => setTimeout(settle, ms));
}

/** 等待 daemon 打印监听行（含端口探测后的真实端口）。 */
function waitForListening(child) {
  return new Promise((settle, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error('daemon 启动超时（10s 内未打印 listening）'));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/\[daemon\] listening on (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        settle(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon 提前退出（code=${code}）；输出：${buffer.slice(-500)}`));
    });
  });
}

/** 极简 HTTP 客户端：返回 { status, json, text }。 */
async function call(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function expectOk(condition, id, detail) {
  record(id, Boolean(condition), detail);
  return Boolean(condition);
}

async function runSmoke(baseUrl) {
  // ---- 基座 ----
  const health = await call(baseUrl, 'GET', '/health');
  expectOk(
    health.status === 200 &&
      health.json?.ok === true &&
      health.json?.result?.name === '@dforge/daemon',
    'health',
    `GET /health → ${health.status}`,
  );

  // ---- 配置与凭据（key 绝不下行）----
  const config = await call(baseUrl, 'GET', '/config');
  expectOk(
    config.status === 200 &&
      config.json?.result?.config?.workspaceDir &&
      config.json?.result?.credentials?.deepseek?.hasKey === false,
    'config.get',
    `GET /config → ${config.status}（初始未配置凭据）`,
  );

  // 先造一个文件占位，验证「工作目录落在文件下」被拒（ensureDir 必然失败）
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(join(ARTIFACTS_DIR, 'blocker'), 'x');
  const badConfig = await call(baseUrl, 'PUT', '/config', {
    workspaceDir: join(ARTIFACTS_DIR, 'blocker', 'sub'),
  });
  expectOk(
    badConfig.status === 400 && badConfig.json?.error?.code === 'config_invalid',
    'config.put.invalid',
    `PUT /config（非法工作目录）→ ${badConfig.status}（code=${badConfig.json?.error?.code}）`,
  );

  const goodWorkspace = join(ARTIFACTS_DIR, 'workspace');
  const goodConfig = await call(baseUrl, 'PUT', '/config', {
    workspaceDir: goodWorkspace,
    comfy: { baseUrl: DEAD_COMFY_URL },
  });
  expectOk(
    goodConfig.status === 200 &&
      goodConfig.json?.result?.config?.workspaceDir === resolve(goodWorkspace),
    'config.put.ok',
    `PUT /config（合法工作目录 + 出图指向死端口）→ ${goodConfig.status}`,
  );

  const badKey = await call(baseUrl, 'PUT', '/config/credentials', { apiKey: 'not-a-key' });
  expectOk(
    badKey.status === 400 && badKey.json?.error?.code === 'credential_invalid',
    'credentials.put.invalid',
    `PUT /config/credentials（非法 key）→ ${badKey.status}`,
  );

  const setKey = await call(baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
  const masked = setKey.json?.result?.summary?.maskedKey;
  expectOk(
    setKey.status === 200 &&
      typeof masked === 'string' &&
      !setKey.text.includes(SENTINEL_KEY) &&
      !setKey.text.includes(SENTINEL_FRAGMENT),
    'credentials.put.masked',
    `PUT /config/credentials → ${setKey.status}（只回掩码 ${masked}）`,
  );

  const configAfter = await call(baseUrl, 'GET', '/config');
  expectOk(
    configAfter.json?.result?.credentials?.deepseek?.hasKey === true &&
      !configAfter.text.includes(SENTINEL_KEY) &&
      !configAfter.text.includes(SENTINEL_FRAGMENT),
    'credentials.get.masked',
    'GET /config（写入后）只回掩码与来源，无明文',
  );

  const cleared = await call(baseUrl, 'DELETE', '/config/credentials');
  expectOk(
    cleared.status === 200 && cleared.json?.result?.summary?.hasKey === false,
    'credentials.delete',
    `DELETE /config/credentials → ${cleared.status}（已清除）`,
  );

  const connectivity = await call(baseUrl, 'POST', '/config/connectivity');
  const connectivityIds = Array.isArray(connectivity.json?.result?.items)
    ? connectivity.json.result.items.map((item) => item.id)
    : [];
  expectOk(
    connectivity.status === 200 && connectivityIds.join(',') === 'daemon,comfyui,ai',
    'connectivity',
    `POST /config/connectivity → ${connectivity.status}（三项：${connectivityIds.join('/')}）`,
  );

  // ---- 文档（.dfg 目录态）----
  const created = await call(baseUrl, 'POST', '/documents', { name: '冒烟文档' });
  expectOk(
    created.status === 201 && created.json?.result?.document?.pageCount === 1,
    'documents.create',
    `POST /documents → ${created.status}（id=${created.json?.result?.document?.id}）`,
  );

  const duplicate = await call(baseUrl, 'POST', '/documents', { name: '冒烟文档' });
  expectOk(
    duplicate.status === 409 && duplicate.json?.error?.code === 'doc_exists',
    'documents.create.duplicate',
    `POST /documents（重名）→ ${duplicate.status}（code=${duplicate.json?.error?.code}）`,
  );

  const list = await call(baseUrl, 'GET', '/documents');
  expectOk(
    list.status === 200 &&
      list.json?.result?.documents?.length === 1 &&
      list.json?.result?.documents[0]?.sizeBytes > 0,
    'documents.list',
    `GET /documents → ${list.status}（1 份，体积 > 0）`,
  );

  const missingDoc = await call(baseUrl, 'GET', '/documents/不存在');
  expectOk(
    missingDoc.status === 404 && missingDoc.json?.error?.code === 'doc_not_found',
    'documents.get.missing',
    `GET /documents/不存在 → ${missingDoc.status}`,
  );

  const pageBody = {
    width: 300,
    height: 200,
    children: [{ kind: 'rect', x: 8, y: 8, width: 60, height: 40, fill: '#00AA00' }],
  };
  const saved = await call(baseUrl, 'PUT', '/documents/冒烟文档/pages/page-1', { body: pageBody });
  expectOk(
    saved.status === 200,
    'page.save',
    `PUT /documents/冒烟文档/pages/page-1 → ${saved.status}`,
  );

  const readBack = await call(baseUrl, 'GET', '/documents/冒烟文档/pages/page-1');
  expectOk(
    readBack.status === 200 && readBack.json?.result?.body?.width === 300,
    'page.get',
    `GET /documents/冒烟文档/pages/page-1 → ${readBack.status}（正文往返保真）`,
  );

  const missingPage = await call(baseUrl, 'GET', '/documents/冒烟文档/pages/page-9');
  expectOk(
    missingPage.status === 404,
    'page.get.missing',
    `GET /documents/冒烟文档/pages/page-9 → ${missingPage.status}`,
  );

  // ---- 导出（PNG/SVG/PDF）----
  for (const format of ['svg', 'png', 'pdf']) {
    const exported = await call(baseUrl, 'POST', '/export', {
      documentId: '冒烟文档',
      pageId: 'page-1',
      format,
    });
    const artifact = exported.json?.result?.artifact;
    let hashOk = false;
    if (typeof artifact?.base64 === 'string' && typeof artifact?.sha256 === 'string') {
      const bytes = Buffer.from(artifact.base64, 'base64');
      hashOk =
        createHash('sha256').update(bytes).digest('hex') === artifact.sha256 &&
        bytes.length === artifact.length;
    }
    expectOk(
      exported.status === 200 && hashOk,
      `export.${format}`,
      `POST /export(${format}) → ${exported.status}（sha256/length 自洽）`,
    );
  }

  const badFormat = await call(baseUrl, 'POST', '/export', {
    documentId: '冒烟文档',
    pageId: 'page-1',
    format: 'jpg',
  });
  expectOk(
    badFormat.status === 400 && badFormat.json?.error?.code === 'export_unsupported_format',
    'export.bad-format',
    `POST /export(jpg) → ${badFormat.status}`,
  );

  // ---- AI（两态：未配置降级 / 上游不可达降级；均不出网）----
  const aiStatus = await call(baseUrl, 'GET', '/ai/status');
  expectOk(
    aiStatus.status === 200 &&
      aiStatus.json?.result?.configured === false &&
      aiStatus.json?.result?.degradedHint,
    'ai.status.unconfigured',
    `GET /ai/status → ${aiStatus.status}（未配置 + 降级提示）`,
  );

  const aiChat = await call(baseUrl, 'POST', '/ai/chat', {
    messages: [{ role: 'user', content: '画一个按钮' }],
  });
  expectOk(
    aiChat.status === 200 &&
      aiChat.json?.result?.degraded === true &&
      aiChat.json?.result?.degradedReason === 'no-credentials' &&
      Array.isArray(aiChat.json?.result?.suggestions),
    'ai.degrade.no-credentials',
    `POST /ai/chat（无 key）→ ${aiChat.status}（降级响应 + 建议清单，不报错）`,
  );

  // ---- 出图（未启动是一等状态）----
  const probe = await call(baseUrl, 'GET', '/image/probe');
  expectOk(
    probe.status === 200 &&
      probe.json?.result?.reachable === false &&
      probe.json?.result?.failure?.code === 'comfy_unreachable',
    'image.probe.unreachable',
    `GET /image/probe（死端口）→ ${probe.status}（reachable=false + comfy_unreachable）`,
  );

  const imageRun = await call(baseUrl, 'POST', '/image/runs', {
    inputs: { positive: 'wasteland gear icon', width: 768 },
  });
  expectOk(
    imageRun.status === 503 &&
      imageRun.json?.error?.code === 'comfy_unreachable' &&
      Array.isArray(imageRun.json?.error?.details?.actions),
    'image.runs.unreachable',
    `POST /image/runs（未启动）→ ${imageRun.status}（结构化错误 + actions）`,
  );

  // ---- 市场（无索引 → 空态）----
  const market = await call(baseUrl, 'GET', '/market/query');
  expectOk(
    market.status === 200 &&
      market.json?.result?.state === 'empty' &&
      market.json?.result?.warnings?.[0]?.code === 'index-missing',
    'market.query.empty',
    `GET /market/query（无索引）→ ${market.status}（空态 + index-missing）`,
  );

  const marketDetail = await call(
    baseUrl,
    'GET',
    `/market/assets/${encodeURIComponent('gh:none#none')}`,
  );
  expectOk(
    marketDetail.status === 404 && marketDetail.json?.error?.code === 'market_asset_not_found',
    'market.asset.missing',
    `GET /market/assets（不存在）→ ${marketDetail.status}`,
  );

  // ---- 遥测（本地 JSONL 往返）----
  const appended = await call(baseUrl, 'POST', '/telemetry/events', {
    name: 'export.completed',
    payload: { format: 'png' },
  });
  const queried = await call(baseUrl, 'GET', '/telemetry/events');
  const clearedTelemetry = await call(baseUrl, 'DELETE', '/telemetry/events');
  expectOk(
    appended.json?.result?.stored === true &&
      queried.json?.result?.total >= 1 &&
      clearedTelemetry.json?.result?.cleared === true,
    'telemetry.roundtrip',
    `POST/GET/DELETE /telemetry/events → ${appended.status}/${queried.status}/${clearedTelemetry.status}`,
  );

  // ---- MCP 确认桩（dryRun → 一次性 ackToken → 审计）----
  const proposal = await call(baseUrl, 'POST', '/mcp/proposals', {
    tool: 'df_apply_patch',
    caller: 'mcp:zcode',
    documentId: '冒烟文档',
    args: { ops: [] },
  });
  const token = proposal.json?.result?.ackToken;
  expectOk(
    proposal.status === 201 && proposal.json?.result?.dryRun === true && typeof token === 'string',
    'mcp.propose',
    `POST /mcp/proposals → ${proposal.status}（dryRun + 一次性 token）`,
  );

  const acked = await call(baseUrl, 'POST', '/mcp/ack', { ackToken: token, approve: true });
  expectOk(
    acked.status === 200 && acked.json?.result?.decision === 'approved',
    'mcp.ack',
    `POST /mcp/ack → ${acked.status}（approved，桩不真实写入）`,
  );

  const replayed = await call(baseUrl, 'POST', '/mcp/ack', { ackToken: token, approve: true });
  expectOk(
    replayed.status === 403 && replayed.json?.error?.code === 'mcp_ack_invalid',
    'mcp.ack.replay',
    `POST /mcp/ack（重放）→ ${replayed.status}（一次性 token 生效）`,
  );

  const unknownTool = await call(baseUrl, 'POST', '/mcp/proposals', {
    tool: 'df_get_tree',
    caller: 'mcp:zcode',
    args: {},
  });
  expectOk(
    unknownTool.status === 400 && unknownTool.json?.error?.code === 'mcp_tool_unknown',
    'mcp.unknown-tool',
    `POST /mcp/proposals（读工具冒充写工具）→ ${unknownTool.status}`,
  );

  const audit = await call(baseUrl, 'GET', '/mcp/audit');
  const auditText = audit.text;
  expectOk(
    audit.status === 200 &&
      Array.isArray(audit.json?.result?.records) &&
      audit.json.result.records.length >= 2 &&
      !auditText.includes(token),
    'mcp.audit',
    `GET /mcp/audit → ${audit.status}（审计含决策记录；token 只存哈希）`,
  );
}

async function main() {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  // 每次运行重置工作目录（否则上一轮遗留的文档会让「重名 409」步骤误判）
  await rm(join(ARTIFACTS_DIR, 'workspace'), { recursive: true, force: true });
  const tempRoot = await mkdtemp(join(tmpdir(), 'df-verify-daemon-'));
  const dataRoot = join(tempRoot, 'data');
  const logPath = join(ARTIFACTS_DIR, 'daemon.log');

  console.log('[verify-daemon] 启动 daemon（临时数据目录）…');
  const child = spawn(
    process.execPath,
    [
      join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts'),
      '--data-root',
      dataRoot,
      '--workspace',
      join(tempRoot, 'workspace'),
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DF_DEEPSEEK_API_KEY: '' },
    },
  );

  const logChunks = [];
  child.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));

  let exitCode = 0;
  let baseUrl = null;
  let failureReason = null;
  try {
    baseUrl = await waitForListening(child);
    console.log(`[verify-daemon] 监听于 ${baseUrl}；开始契约冒烟…`);
    await runSmoke(baseUrl);

    // 端到端断言：哨兵 key 不出现在 daemon 日志（真实进程 logger 开启）
    await sleep(200);
    const logText = logChunks.join('');
    record(
      'credentials.never-in-log',
      !logText.includes(SENTINEL_KEY) && !logText.includes(SENTINEL_FRAGMENT),
      'daemon 日志不含 key 明文或显著片段',
    );
  } catch (error) {
    exitCode = 2;
    failureReason = String(error);
    console.error(`[verify-daemon] 阻塞：${failureReason}`);
    record('daemon.bootstrap', false, `阻塞：${failureReason}`);
  } finally {
    child.kill('SIGTERM');
    await sleep(150);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await writeFile(logPath, logChunks.join(''));
  }

  if (exitCode === 0) {
    const failed = steps.filter((step) => !step.ok);
    if (failed.length > 0) exitCode = 1;
  }

  const logBytes = await readFile(logPath).catch(() => Buffer.alloc(0));
  const evidence = {
    page: 'verify-daemon',
    level: 'A',
    diff: { bbox: null, diffPixels: 0, ratio: 0 },
    artifacts: {
      ref: null,
      actual: {
        sha256: createHash('sha256').update(logBytes).digest('hex'),
        length: logBytes.length,
      },
      diff: null,
    },
    humanReview: { verdict: null, reviewer: null, reason: null },
    exitCode,
    meta: {
      startedAt,
      finishedAt: new Date().toISOString(),
      daemonUrl: baseUrl,
      dataRoot,
      node: process.version,
      sentinelKeyUsed: true,
      blockedReason: failureReason,
      stepsTotal: steps.length,
      stepsFailed: steps.filter((step) => !step.ok).length,
    },
    steps,
  };

  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const localEvidencePath = join(ARTIFACTS_DIR, 'evidence.json');
  await writeFile(localEvidencePath, evidenceText);
  await mkdir(dirname(EVIDENCE_OUTSIDE), { recursive: true });
  await writeFile(EVIDENCE_OUTSIDE, evidenceText);

  console.log(
    `[verify-daemon] 步骤 ${steps.length} 项，失败 ${evidence.meta.stepsFailed} 项；证据：${EVIDENCE_OUTSIDE}；退出码 ${exitCode}`,
  );

  if (exitCode === 0) {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`[verify-daemon] 保留现场用于排查：${tempRoot}（含数据目录与 daemon 日志副本）`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[verify-daemon] 未捕获异常：', error);
  process.exit(2);
});
