#!/usr/bin/env node
/**
 * verify-ai-two-state —— FE-10 门禁之一：AI 抽屉的**真/桩两态**取证（issue #23 DoD）。
 *
 * 两态（都真跑 daemon，**不真调云端**）：
 *   态 A「无 key 降级」：真实 daemon（临时数据目录、无凭据）→ `/ai/status` 未配置 + 降级提示；
 *       `/ai/chat`（SSE 与一次性）→ 降级响应与真响应**同构**；
 *   态 B「有 key + mock 上游流式」：真实 daemon + **本机 mock 上游**（OpenAI-compatible SSE，
 *       不出机）→ 流式 delta 累积、四步时序走完、`degraded:false`。
 *
 * 时序断言的真源：脚本直接导入前端适配层 `apps/web/src/features/ai/stream.ts`
 * （与抽屉是同一份代码）——把 daemon 原样吐出的 SSE 文本喂进去，断言步骤时序
 * queued → llm → validate → compile 与降级标记，即用户看到的时序。
 *
 * 退出码（《前端验收标准 v1》§4，禁止假绿）：
 *   0 = 两态取证 + UI 挂载断言全过；
 *   1 = 有断言失败（真失败）；
 *   2 = **阻塞**：daemon 未能启动 / 本机 mock 上游未能启动 / UI 段前置不成立
 *       （未找到 Chromium、站点起不来、编辑器路由不可达）——阻塞不是通过。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-ai-two-state.mjs [--verbose]
 * 环境变量：DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *   DF_WEB_URL（站点；未设置则自起 next dev，4420+ 端口）、
 *   BENCH_CHROME_EXECUTABLE（Chromium 路径；缺省读 ~/.cache/ms-playwright）。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAiRunReader } from '../apps/web/src/features/ai/stream.ts';
import { runUiMountCheck } from './lib/ui-mount.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts', 'verify-ai-two-state');
const TICKET = 'fe-10';
/** 哨兵 key：mock 上游必须收到它（BYOK 透传），而 daemon 响应/审计不得出现它。 */
const SENTINEL_KEY = 'sk-verify-FE10-AI-0123456789-zzzz';
const SENTINEL_FRAGMENT = 'FE10-AI-0123456789';
/** mock 上游吐出的流式文本（按 delta 分三块）。 */
const MOCK_DELTAS = ['按钮组', '已按', '设计令牌生成'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const startedAt = new Date();

const steps = [];
function record(id, ok, detail) {
  steps.push({ id, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${id} —— ${detail}`);
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
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon 提前退出（code=${code}）；输出：${buffer.slice(-500)}`));
    });
  });
}

/** 极简 HTTP 客户端：返回 { status, text, json }。 */
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
  return { status: response.status, text, json };
}

/** 读 SSE 响应体为文本块（喂给前端适配层）。 */
async function readStreamText(response) {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text;
}

/**
 * 本机 mock 上游（OpenAI-compatible）：
 * - POST /chat/completions（stream 或一次性）→ 分块 SSE / JSON；
 * - 记录收到的 Authorization 与请求体（BYOK 透传的证据）。
 */
function startMockUpstream() {
  const received = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url.startsWith('/chat/completions')) {
      response.writeHead(404).end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk.toString();
    });
    request.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      received.push({ authorization: request.headers.authorization ?? null, body });
      if (body !== null && body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const delta of MOCK_DELTAS) {
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`,
          );
        }
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
        );
        response.write('data: [DONE]\n\n');
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: MOCK_DELTAS.join('') }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 },
        }),
      );
    });
  });
  return new Promise((settle, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${String(address.port)}`;
      settle({
        baseUrl,
        received,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** 前端适配层断言辅助：跑一遍 reader 并返回快照与时间线。 */
function driveReader(sseText) {
  const reader = createAiRunReader();
  const begun = reader.begin();
  reader.pushText(sseText);
  return { snapshot: reader.snapshot(), timeline: reader.timeline(), begin: begun };
}

/**
 * UI 挂载断言（D1 · D-6/UX-10 的回归）——**真浏览器**（playwright-core）。
 *
 * 断言（全部走用户路径）：
 * 1. 编辑器工具栏出现 AI 入口按钮（`[data-df-ai-entry]`）；
 * 2. 点它 → AI 抽屉打开（`[data-df-panel="ai"]` 可见）；
 * 3. 无 key 时抽屉渲染 daemon 给的降级提示（`/ai/status.degradedHint` 同一文本）；
 * 4. Esc → 抽屉关闭（面板卸载）。
 *
 * 为什么必须真浏览器：客户端挂载组件不出现在 SSR HTML——原「fetch HTML 找挂点」的探测
 * 恒为 pending（等于没测）。站点优先复用 `DF_WEB_URL`，否则自起 next dev（见 lib/ui-mount）。
 *
 * @param {{ daemonUrl: string, degradedHint: string }} options
 * @returns {Promise<Awaited<ReturnType<import('./lib/ui-mount.mjs').runUiMountCheck>>>}
 */
async function probeUiMount({ daemonUrl, degradedHint }) {
  return runUiMountCheck({
    daemonUrl,
    evidenceDir: join(EVIDENCE_ROOT, TICKET),
    screenshotName: 'ui-ai-drawer.png',
    log: (message) => {
      console.log(`[verify-ai-two-state] ${message}`);
    },
    check: async ({ page, record, screenshot }) => {
      // ① 入口可见（工具栏按钮由 canvas 工作区的 toolbar 插槽挂载）
      await page.waitForSelector('[data-df-ai-entry]', { timeout: 120_000 });
      record('ui.entry.visible', true, '工具栏 AI 入口按钮挂载（[data-df-ai-entry]）');

      // ② 点入口 → 抽屉打开
      await page.click('[data-df-ai-entry]');
      await page.waitForSelector('[data-df-panel="ai"]', { state: 'visible', timeout: 60_000 });
      const pressed = await page
        .locator('[data-df-ai-entry]')
        .getAttribute('aria-pressed')
        .catch(() => null);
      record(
        'ui.drawer.opens',
        pressed === 'true',
        `点入口 → AI 抽屉打开（data-df-panel=ai 可见；入口 aria-pressed=${String(pressed)}）`,
      );

      // ③ 无 key 降级态可见：抽屉里的提示文本 = daemon `/ai/status` 的 degradedHint
      const hint = await page
        .locator('[data-df-panel="ai"] [role="status"]')
        .first()
        .innerText()
        .catch(() => '');
      record(
        'ui.degraded-hint',
        degradedHint.length > 0 && hint.includes(degradedHint),
        `抽屉可见降级提示「${hint.slice(0, 40)}」= /ai/status.degradedHint`,
      );
      await screenshot('ui-ai-drawer.png');

      // ④ Esc → 关闭（面板卸载）
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-df-panel="ai"]', { state: 'detached', timeout: 30_000 });
      record('ui.drawer.closes', true, 'Esc → 抽屉关闭（面板卸载）');
    },
  });
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'df-verify-fe10-ai-'));
  const logChunks = [];
  let child = null;
  let mock = null;
  let exitCode = 0;
  let blockedReason = null;
  const evidence = {
    ticket: 'FE-10',
    gate: 'verify-ai-two-state',
    page: 'ai-drawer（F4）· 数据面两态 + UI 挂载断言（真浏览器）',
    level: 'A（契约形状 + 步骤时序断言 + 用户路径挂载）',
    states: {},
    exitCode: 2,
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason:
        '自动判定覆盖两态形状与时序 + 用户路径挂载（真点击）；界面像素对照归 verify-figma-*（参照集未冻结 → exit 2）。',
    },
  };

  try {
    mock = await startMockUpstream();
    console.log(`[verify-ai-two-state] mock 上游就绪：${mock.baseUrl}（本机回环，不出机）`);

    child = spawn(
      process.execPath,
      [
        join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts'),
        '--data-root',
        join(tempRoot, 'data'),
        '--workspace',
        join(tempRoot, 'workspace'),
      ],
      {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DF_DEEPSEEK_API_KEY: '' },
      },
    );
    child.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
    child.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));
    const baseUrl = await waitForListening(child);
    console.log(`[verify-ai-two-state] daemon 监听于 ${baseUrl}`);

    // —— 态 A：无 key（真跑降级路径）——
    const statusA = await call(baseUrl, 'GET', '/ai/status');
    record(
      'A.status.unconfigured',
      statusA.status === 200 &&
        statusA.json?.result?.configured === false &&
        typeof statusA.json?.result?.degradedHint === 'string',
      `GET /ai/status → ${statusA.status}（configured=false + 降级提示）`,
    );

    const streamA = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '加一个主按钮' }], stream: true }),
    });
    const textA = await readStreamText(streamA);
    const drivenA = driveReader(textA);
    const timelineA = drivenA.timeline.map((entry) => entry.step);
    record(
      'A.stream.degraded-shape',
      textA.includes('"degraded":true') &&
        textA.includes('"degradedReason":"no-credentials"') &&
        textA.includes('"suggestions"'),
      '流式降级帧与真响应同构（degraded + degradedReason + suggestions）',
    );
    record(
      'A.stream.steps-timeline',
      timelineA.join('>') === 'queued>llm>validate>compile' &&
        drivenA.snapshot.phase === 'done' &&
        drivenA.snapshot.degraded === true,
      `四步时序 ${timelineA.join(' > ')}（角标「本地模板」依据 degraded=true）`,
    );

    const onceA = await call(baseUrl, 'POST', '/ai/chat', {
      messages: [{ role: 'user', content: '加一个主按钮' }],
    });
    record(
      'A.once.degraded-shape',
      onceA.status === 200 &&
        onceA.json?.result?.degraded === true &&
        Array.isArray(onceA.json?.result?.suggestions) &&
        onceA.json?.result?.finishReason === 'degraded',
      `一次性响应 → ${onceA.status}（与流式同一形状口径）`,
    );

    evidence.states.stateA = {
      id: 'no-key-degraded',
      label: '无 key 降级（真跑）',
      status: await call(baseUrl, 'GET', '/ai/status').then((r) => r.json?.result),
      streamRaw: textA,
      timeline: drivenA.timeline,
      snapshot: {
        phase: drivenA.snapshot.phase,
        degraded: drivenA.snapshot.degraded,
        degradedReason: drivenA.snapshot.degradedReason,
        suggestions: drivenA.snapshot.suggestions,
      },
      onceResponse: onceA.json?.result ?? null,
      cloudCalls: 0,
    };

    // —— UI 段（D1 挂载断言，真浏览器）：趁 daemon 仍无凭据，断言抽屉可见「本地模板」降级态 ——
    evidence.uiEvidence = await probeUiMount({
      daemonUrl: baseUrl,
      degradedHint: statusA.json?.result?.degradedHint ?? '',
    });
    if (evidence.uiEvidence.status === 'blocked') {
      console.log(`  [阻塞] UI 挂载断言未执行：${evidence.uiEvidence.reason}`);
      blockedReason = `UI 段阻塞：${evidence.uiEvidence.reason}`;
    } else {
      for (const step of evidence.uiEvidence.steps) record(step.id, step.ok, step.detail);
      console.log(
        `  UI 段（真浏览器）：${evidence.uiEvidence.status}（截图：${evidence.uiEvidence.screenshot ?? '无'}）`,
      );
    }

    // —— 态 B：有 key + mock 上游（真跑流式，不真调云端）——
    const setKey = await call(baseUrl, 'PUT', '/config/credentials', { apiKey: SENTINEL_KEY });
    record(
      'B.credentials.masked',
      setKey.status === 200 &&
        setKey.json?.result?.summary?.hasKey === true &&
        !setKey.text.includes(SENTINEL_KEY) &&
        !setKey.text.includes(SENTINEL_FRAGMENT),
      `PUT /config/credentials → ${setKey.status}（只回掩码，明文不出响应）`,
    );

    const setBase = await call(baseUrl, 'PUT', '/config', { ai: { baseUrl: mock.baseUrl } });
    record(
      'B.config.base-url',
      setBase.status === 200 && setBase.json?.result?.config?.ai?.baseUrl === mock.baseUrl,
      `PUT /config（ai.baseUrl → mock）→ ${setBase.status}`,
    );

    const statusB = await call(baseUrl, 'GET', '/ai/status');
    record(
      'B.status.configured',
      statusB.status === 200 &&
        statusB.json?.result?.configured === true &&
        statusB.json?.result?.degradedHint === null,
      `GET /ai/status → ${statusB.status}（configured=true，无降级提示）`,
    );

    const streamB = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '加一个主按钮' }], stream: true }),
    });
    const textB = await readStreamText(streamB);
    const drivenB = driveReader(textB);
    const timelineB = drivenB.timeline.map((entry) => entry.step);
    const deltas = [...textB.matchAll(/"type":"delta","delta":"([^"]*)"/g)].map((m) => m[1]);
    record(
      'B.stream.steps-timeline',
      timelineB.join('>') === 'queued>llm>validate>compile' && drivenB.snapshot.phase === 'done',
      `四步时序 ${timelineB.join(' > ')}（与降级态同一路径）`,
    );
    record(
      'B.stream.content-accumulated',
      deltas.join('') === MOCK_DELTAS.join('') &&
        drivenB.snapshot.content === MOCK_DELTAS.join('') &&
        drivenB.snapshot.degraded === false,
      `delta 累积 = mock 文本「${MOCK_DELTAS.join('')}」，degraded=false`,
    );
    record(
      'B.upstream.authorization',
      mock.received.length === 1 && mock.received[0]?.authorization === `Bearer ${SENTINEL_KEY}`,
      `mock 上游收到 ${mock.received.length} 次调用，Authorization 为哨兵 key（BYOK 只在 daemon→上游方向出现）`,
    );
    record(
      'B.no-leak',
      !textB.includes(SENTINEL_KEY) &&
        !textB.includes(SENTINEL_FRAGMENT) &&
        !statusB.text.includes(SENTINEL_FRAGMENT),
      'daemon 响应不含 key 明文或显著片段',
    );

    const onceB = await call(baseUrl, 'POST', '/ai/chat', {
      messages: [{ role: 'user', content: '加一个主按钮' }],
    });
    record(
      'B.once.real-response',
      onceB.status === 200 &&
        onceB.json?.result?.degraded === false &&
        onceB.json?.result?.usage?.totalTokens === 16,
      `一次性真响应 → ${onceB.status}（usage.totalTokens=16）`,
    );

    if (verbose) console.log(`  时序（态 B）：${JSON.stringify(drivenB.timeline)}`);
    evidence.states.stateB = {
      id: 'key-mock-upstream',
      label: '有 key + mock 上游流式（不真调云端）',
      mockUpstream: mock.baseUrl,
      streamRaw: textB,
      timeline: drivenB.timeline,
      deltas,
      snapshot: {
        phase: drivenB.snapshot.phase,
        degraded: drivenB.snapshot.degraded,
        content: drivenB.snapshot.content,
      },
      onceResponse: onceB.json?.result ?? null,
      upstreamCalls: mock.received.map((entry) => ({
        authorizationPresent: entry.authorization !== null,
      })),
      cloudCalls: 0,
    };
  } catch (error) {
    exitCode = 2;
    blockedReason = String(error);
    console.error(`[verify-ai-two-state] 阻塞：${blockedReason}`);
    record('bootstrap', false, `阻塞：${blockedReason}`);
  } finally {
    if (child !== null) {
      child.kill('SIGTERM');
      await sleep(150);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (mock !== null) await mock.close();
  }

  if (exitCode === 0) {
    const failed = steps.filter((step) => !step.ok);
    if (failed.length > 0) exitCode = 1;
  }
  // UI 段阻塞 → exit 2（三态语义；违规（1）优先于阻塞（2），见 implementation-workflow）
  if (exitCode === 0 && evidence.uiEvidence?.status === 'blocked') exitCode = 2;
  if (exitCode === 0 && evidence.uiEvidence?.status === 'failed') exitCode = 1;

  evidence.exitCode = exitCode;
  evidence.blockedReason = blockedReason;
  evidence.steps = steps;
  evidence.meta = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    node: process.version,
    daemonLog: createHash('sha256').update(logChunks.join('')).digest('hex'),
    daemonLogBytes: logChunks.join('').length,
    stepsTotal: steps.length,
    stepsFailed: steps.filter((step) => !step.ok).length,
    cloudCalls: 0,
  };

  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = join(EVIDENCE_ROOT, TICKET, 'verify-ai-two-state.json');
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, text);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(join(ARTIFACTS_DIR, 'evidence.json'), text);

  console.log(
    `[verify-ai-two-state] 步骤 ${steps.length} 项，失败 ${evidence.meta.stepsFailed} 项；证据：${evidencePath}；退出码 ${exitCode}`,
  );

  if (exitCode === 0) {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`[verify-ai-two-state] 保留现场：${tempRoot}`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[verify-ai-two-state] 未捕获异常：', error);
  process.exit(2);
});
