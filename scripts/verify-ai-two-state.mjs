#!/usr/bin/env node
/**
 * verify-ai-two-state —— FE-10 门禁之一：AI 抽屉的**真/桩两态**取证（issue #23 DoD）。
 *
 * 两态：
 *   态 A「无 key 降级」（默认真跑）：真实 daemon（临时数据目录、无凭据）→ `/ai/status` 未配置
 *       + 降级提示；`/ai/chat`（SSE 与一次性）→ 降级响应与真响应**同构**。全程不发凭据、
 *       不建 key，脚本代码路径不发起任何到官方 API 的调用（不代表 daemon 内部一定没出机，
 *       仅声明脚本本身没触发）。
 *   态 B「有 key + mock 上游流式」（**默认跳过**，见下方「出机风险段」）：需要设
 *       `DF_ALLOW_AI_EGRESS=1` 才启用；启用后会 PUT 哨兵 key + 试 PUT ai.baseUrl。
 *       ⚠️ 现实：daemon 侧 `access-control.isAllowedAiBaseUrl` 白名单**只放行 https://api.deepseek.com**，
 *       回环 mock 一定被拒；一旦段 B 跑到 `/ai/chat`，daemon 会以哨兵 key 打**真实官方端**。
 *       本脚本**没有上游探针**——不能声称「未出机」，只能说「段 B 已开，操作者显式接受出机」。
 *       不开段 B 时脚本代码路径未发起 /ai/chat（真实或 mock），这是能观察到的最强断言。
 *
 * 时序断言的真源：脚本直接导入前端适配层 `apps/web/src/features/ai/stream.ts`
 * （与抽屉是同一份代码）——把 daemon 原样吐出的 SSE 文本喂进去，断言步骤时序
 * queued → llm → validate → compile 与降级标记，即用户看到的时序。SSE 帧解析由
 * `scripts/lib/sse-frames.mjs` 提供，畸形帧会抛（不再 catch{} 静默丢帧），
 * 帧数（`dataLineCount`）与事件数（`events.length`+`doneCount`）由一条
 * `*.stream.sse-frames-accounted` 步骤钉住，防「上游丢帧」在门禁里隐身。
 *
 * 退出码（《前端验收标准 v1》§4，禁止假绿）：
 *   0 = 段 A + UI 挂载全过；**且**段 B 已显式跑过（`DF_ALLOW_AI_EGRESS=1` 且过）；
 *   1 = 有断言失败（真失败）；
 *   2 = **阻塞**：daemon 起不来 / UI 段前置不成立（未找到 Chromium、站点起不来、
 *       编辑器路由不可达）/ **段 B 未 opt-in**（默认路径）——`2` 绝不等价于通过。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-ai-two-state.mjs [--verbose]                # 段 B 默认跳过 → exit 2
 *   DF_ALLOW_AI_EGRESS=1 node scripts/verify-ai-two-state.mjs        # 段 B 显式启用（真实出机！）
 * 环境变量：DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *   DF_WEB_URL（站点；未设置则自起 next dev，4420+ 端口）、
 *   BENCH_CHROME_EXECUTABLE（Chromium 路径；缺省读 ~/.cache/ms-playwright）、
 *   DF_ALLOW_AI_EGRESS=1（显式启用段 B；不设则段 B 整块 skip + 强制 exit 2）。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAiRunReader } from '../apps/web/src/features/ai/stream.ts';
import { parseSseFrames } from './lib/sse-frames.mjs';
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

/** 建议 kind 合法枚举（contracts AiSuggestionKind）。 */
const SUGGESTION_KINDS = new Set([
  'configure-credentials',
  'retry-later',
  'check-network',
  'manual-edit',
]);

/**
 * 降级响应语义判据（票 03 加固）：suggestions 不是「键存在」而是要**可操作**——
 * 条数下限 1、逐条 kind 合法 + title 非空、finishReason=degraded、usage=null（不造用量）、
 * content=''（空正文是设计，可操作性由建议清单承接）。返回 [ok, detail]。
 */
function degradedShapeAudit(result, expectReason) {
  if (result === null || typeof result !== 'object') return [false, '响应体缺失'];
  const problems = [];
  if (result.degraded !== true) problems.push('degraded 非 true');
  if (result.degradedReason !== expectReason)
    problems.push(`degradedReason=${String(result.degradedReason)}`);
  if (result.finishReason !== 'degraded')
    problems.push(`finishReason=${String(result.finishReason)}（伪装成功）`);
  if (result.usage !== null) problems.push('usage 非 null（无上游不得有用量）');
  if (result.content !== '') problems.push('降级 content 应为空串（设计口径）');
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : null;
  if (suggestions === null) return [false, problems.concat('suggestions 非数组').join('；')];
  if (suggestions.length < 1) problems.push('suggestions 为空（降级面板成死路）');
  for (const s of suggestions) {
    if (!SUGGESTION_KINDS.has(s?.kind)) problems.push(`kind 非法：${String(s?.kind)}`);
    if (typeof s?.title !== 'string' || s.title.trim().length === 0)
      problems.push(`title 空：${JSON.stringify(s)}`);
    if (!(s?.detail === null || typeof s?.detail === 'string'))
      problems.push(`detail 形状非法：${String(s?.kind)}`);
  }
  return [
    problems.length === 0,
    problems.length === 0 ? `语义判据全过（${suggestions.length} 条建议）` : problems.join('；'),
  ];
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

      // ③′ 票 03 加固：降级态不是空白面板——真提交后渲染「本地模板」角标 + **非空建议清单**
      //    + 结果区说明文案。字面量镜像 zh-CN 主目录 i18n 键（ai.badge.localTemplate /
      //    ai.suggestion.actions / ai.badge.localTemplate.desc；门禁脚本不 import web i18n——
      //    其依赖 @/ 别名与 JSON import attributes，node 直跑不可用）。
      // 每个断言单独 try/catch：上一版把两步共一段 try，
      // 结果 `ui.degraded-result-nonblank` 挂掉时被 catch 里的兜底 record 写成
      // `ui.degraded-suggestions=false`（覆盖/漏报第二步，判据失真）。
      let suggestionCount = null;
      try {
        await page.fill('[data-df-panel="ai"] textarea', '加一个主按钮');
        await page.click('[data-df-panel="ai"] button:text-is("生成")');
        await page.waitForSelector('[data-df-panel="ai"] [data-df-badge="local-template"]', {
          timeout: 60_000,
        });
        suggestionCount = await page
          .locator('[data-df-panel="ai"] ul[aria-label="建议动作"] > li')
          .count();
      } catch (error) {
        suggestionCount = null;
        record(
          'ui.degraded-suggestions',
          false,
          `提交或角标/清单查询失败，判据不可评估：${String(error)}`,
        );
      }
      if (suggestionCount !== null) {
        record(
          'ui.degraded-suggestions',
          suggestionCount >= 1,
          `降级提交后建议清单渲染 ${suggestionCount} 条（≥1 才通过；空白面板=假降级判红）`,
        );
      }
      let resultText = null;
      try {
        resultText = await page
          .locator('[data-df-panel="ai"] [data-df-ai-result="done"]')
          .first()
          .innerText();
      } catch (error) {
        record(
          'ui.degraded-result-nonblank',
          false,
          `结果区节点缺失或读取失败，判据不可评估：${String(error)}`,
        );
      }
      if (resultText !== null) {
        record(
          'ui.degraded-result-nonblank',
          resultText.includes('本地模板') && resultText.includes('降级结果'),
          '结果区非空白且如实标注本地模板（不伪装模型输出）',
        );
      }
      await screenshot('ui-ai-drawer.png');

      // ④ Esc → 关闭（面板卸载）
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-df-panel="ai"]', { state: 'detached', timeout: 30_000 });
      record('ui.drawer.closes', true, 'Esc → 抽屉关闭（面板卸载）');
    },
  });
}

async function main() {
  // 现场目录：仓库外、**不用 /tmp**（本仓纪律：临时数据根/保留现场一律落在 `~/df-evidence` 下，
  // 避免重启丢失与「证据写在临时目录里当场查不到」）。
  const scratchRoot = join(EVIDENCE_ROOT, 'scratch');
  await mkdir(scratchRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(scratchRoot, 'verify-ai-two-state-'));
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
    console.log(
      `[verify-ai-two-state] mock 上游就绪：${mock.baseUrl}（本机回环 stand-in；段 B 默认跳过时不使用；` +
        '即便段 B 被 opt-in，daemon 的 baseUrl 白名单会拒这个 URL——本 mock 不能替 daemon 观测真实出机）',
    );

    child = spawn(
      process.execPath,
      [
        join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts'),
        '--data-root',
        join(tempRoot, 'data'),
        '--workspace',
        join(tempRoot, 'workspace'),
        // 端口纪律（本仓红线）：夹具 daemon **不占常驻 4318**，向内核要 0 号端口；
        // `startDaemon` 会回读 `server.address().port` 并打印真实 URL，下面的
        // `waitForListening` 与 UI 段代理都按那一条真实端口接线（不再假设 4318）。
        '--port',
        '0',
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
        typeof statusA.json?.result?.degradedHint === 'string' &&
        statusA.json.result.degradedHint.trim().length > 0,
      `GET /ai/status → ${statusA.status}（configured=false + 降级提示非空）`,
    );

    const streamA = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '加一个主按钮' }], stream: true }),
    });
    const textA = await readStreamText(streamA);
    const drivenA = driveReader(textA);
    const timelineA = drivenA.timeline.map((entry) => entry.step);
    // 票 03 加固：从「子串在场」升级为**解析 done 帧后逐字段语义判据**——
    // `"suggestions":[]` 也含子串 `"suggestions"`，原判据对空清单假绿。
    // 帧解析：畸形帧现在会抛（见 scripts/lib/sse-frames.mjs）；这里包一层把抛错
    // 转成一条 FAIL 步骤，然后按 events 走后续判据。
    let parsedA;
    try {
      parsedA = parseSseFrames(textA);
      record(
        'A.stream.sse-frames-accounted',
        parsedA.dataLineCount === parsedA.events.length + parsedA.doneCount &&
          parsedA.malformedCount === 0 &&
          parsedA.events.length >= 2,
        `线上 data 行 ${String(parsedA.dataLineCount)} = 事件 ${String(parsedA.events.length)} + DONE ${String(parsedA.doneCount)}（无静默丢帧；畸形已抛）`,
      );
    } catch (error) {
      record('A.stream.sse-frames-accounted', false, `SSE 畸形帧：${String(error)}`);
      parsedA = { events: [], dataLineCount: 0, doneCount: 0, commentCount: 0, malformedCount: 1 };
    }
    const framesA = parsedA.events;
    const doneFrameA = framesA.find((event) => event?.type === 'done') ?? null;
    const degradedAuditA = degradedShapeAudit(doneFrameA?.response ?? null, 'no-credentials');
    record(
      'A.stream.degraded-shape',
      streamA.status === 200 &&
        !textA.includes('event: error') &&
        framesA.some((event) => event?.type === 'start' && event.degraded === true) &&
        doneFrameA !== null &&
        degradedAuditA[0] &&
        (doneFrameA.response.suggestions ?? []).some((s) => s.kind === 'configure-credentials'),
      `流式降级帧逐字段判据：${degradedAuditA[1]}（no-credentials 含配置凭据出口；不发 error 帧）`,
    );
    record(
      'A.stream.steps-timeline',
      timelineA.join('>') === 'queued>llm>validate>compile' &&
        drivenA.snapshot.phase === 'done' &&
        drivenA.snapshot.degraded === true &&
        Array.isArray(drivenA.snapshot.suggestions) &&
        drivenA.snapshot.suggestions.length >= 1,
      `四步时序 ${timelineA.join(' > ')}（角标「本地模板」依据 degraded=true；适配层建议清单非空）`,
    );

    const onceA = await call(baseUrl, 'POST', '/ai/chat', {
      messages: [{ role: 'user', content: '加一个主按钮' }],
    });
    const onceAuditA = degradedShapeAudit(onceA.json?.result ?? null, 'no-credentials');
    record(
      'A.once.degraded-shape',
      onceA.status === 200 &&
        onceA.json?.ok === true &&
        onceAuditA[0] &&
        !onceA.text.includes(SENTINEL_KEY) &&
        !onceA.text.includes(SENTINEL_FRAGMENT),
      `一次性降级响应逐字段判据：${onceAuditA[1]}（响应体无 key 明文/片段）`,
    );
    record(
      'A.stream.once-isomorphic',
      doneFrameA !== null &&
        onceA.json?.result !== undefined &&
        Object.keys(doneFrameA.response).sort().join(',') ===
          Object.keys(onceA.json.result).sort().join(','),
      '流式 done 帧与一次性响应键集同构（前端不分支的契约基座）',
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
      // 诚实口径：本门禁**没有观测上游的探针**（我们只观测 daemon 与 mock，观测不到
      // daemon 是否向 https://api.deepseek.com 发了什么），所以不能声称「未出机」。
      // 真正被观测的是：段 B 默认跳过；即便段 B 被显式 DF_ALLOW_AI_EGRESS=1 打开，
      // 也不设 mock baseUrl 走 https://api.deepseek.com——`egressAttemptedByGate: false`
      // 是本脚本自己的可验证断言（脚本代码路径未发起任何 /ai/chat 到官方 base URL），
      // 至于 daemon 内部有没有别的路径偷偷出机——不在本门禁的观测面。
      egressAttemptedByGate: false,
      egressObservability: 'no-probe：脚本不声称「未出机」，只声明「脚本不发起」',
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
    // 【默认跳过 · round-2 G4】本仓 `access-control.ts:isAllowedAiBaseUrl` 只放行
    // `https://api.deepseek.com`，任何回环 mock 都在 `PUT /config` 处被拒；一旦本段
    // 继续跑到 `POST /ai/chat`，daemon 会以哨兵 key 打向**真实官方端**（baseUrl 停在默认），
    // 而脚本又没有任何上游探针——`cloudCalls: 0` 是编不出证的假绿。所以段 B 默认整块
    // 跳过并**强制 exit 2**（阻塞 ≠ 通过）；只有显式设 `DF_ALLOW_AI_EGRESS=1` 才启用，
    // 意味着操作者**已知**并接受真实出机风险（配套票 22 已把这一约束落到完成记录）。
    const aiEgressOptIn = process.env.DF_ALLOW_AI_EGRESS === '1';
    if (!aiEgressOptIn) {
      const reason =
        '段 B「有 key + mock 上游」默认跳过：ai.baseUrl 白名单只允许 https://api.deepseek.com，' +
        '回环 stand-in 走不进 allowlist；不设 opt-in 就发起 /ai/chat 会以哨兵 key 打真实官方端；' +
        '脚本侧无上游探针，无法观测「未出机」——不假装 attestation。' +
        '要跑段 B 请显式设 DF_ALLOW_AI_EGRESS=1 并接受真实出机（详见票 22）。';
      const skippedSteps = [
        'B.credentials.masked',
        'B.config.base-url',
        'B.status.configured',
        'B.stream.sse-frames-accounted',
        'B.stream.steps-timeline',
        'B.stream.content-accumulated',
        'B.upstream.authorization',
        'B.no-leak',
        'B.once.real-response',
      ];
      evidence.states.stateB = {
        id: 'key-mock-upstream',
        label: '有 key + mock 上游流式（默认跳过）',
        status: 'skipped',
        reason,
        skippedSteps,
        optInEnv: 'DF_ALLOW_AI_EGRESS=1',
        // 本门禁没有网络观测能力，只声明脚本代码路径未发起 /ai/chat（真实或 mock）。
        egressAttemptedByGate: false,
        egressObservability: 'no-probe：段 B 未开，脚本不声称「未出机」',
      };
      for (const id of skippedSteps) {
        steps.push({ id, ok: null, skipped: true, detail: `段 B 跳过：${reason.slice(0, 80)}…` });
        console.log(`  [SKIP] ${id} —— 段 B 默认跳过（详见票 22）`);
      }
      if (blockedReason === null) blockedReason = reason;
      // 三态语义：阻塞（2）优先于「其他步全绿即 0」；违规（1）仍最优先。
      exitCode = 2;
    } else {
      console.warn(
        '[verify-ai-two-state] ⚠️ DF_ALLOW_AI_EGRESS=1 已开启：段 B 会真实出机至 api.deepseek.com。',
      );
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
        body: JSON.stringify({
          messages: [{ role: 'user', content: '加一个主按钮' }],
          stream: true,
        }),
      });
      const textB = await readStreamText(streamB);
      const drivenB = driveReader(textB);
      const timelineB = drivenB.timeline.map((entry) => entry.step);
      // 帧账与段 A **同口径**：线上 data 行数 = 事件数 + DONE 数，畸形帧直接抛（不静默丢）。
      let parsedB;
      try {
        parsedB = parseSseFrames(textB);
        record(
          'B.stream.sse-frames-accounted',
          parsedB.dataLineCount === parsedB.events.length + parsedB.doneCount &&
            parsedB.malformedCount === 0 &&
            parsedB.events.length >= 2,
          `线上 data 行 ${String(parsedB.dataLineCount)} = 事件 ${String(parsedB.events.length)} + DONE ${String(parsedB.doneCount)}（无静默丢帧；畸形已抛）`,
        );
      } catch (error) {
        record('B.stream.sse-frames-accounted', false, `SSE 畸形帧：${String(error)}`);
        parsedB = {
          events: [],
          dataLineCount: 0,
          doneCount: 0,
          commentCount: 0,
          malformedCount: 1,
        };
      }
      // delta 从**解析后的帧**取，不对原文做正则：正则对「丢帧 / 跨行 JSON」完全无感，
      // 正是 finding 指的「没有任何断言把帧数与线上绑定」。
      const deltas = parsedB.events
        .filter((event) => event?.type === 'delta')
        .map((event) => String(event?.delta ?? ''));
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
        label: '有 key + mock 上游流式（段 B 显式启用）',
        status: 'executed-with-opt-in',
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
        egressAttemptedByGate: true,
        egressObservability: 'opt-in：段 B 已跑；脚本仍无上游探针，"未出机" 不由本门禁断言',
      };
    }
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
    const failed = steps.filter((step) => step.ok === false);
    if (failed.length > 0) exitCode = 1;
    else if (steps.some((step) => step.skipped === true)) exitCode = 2;
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
    stepsFailed: steps.filter((step) => step.ok === false).length,
    stepsSkipped: steps.filter((step) => step.skipped === true).length,
    // 本门禁**不声称**「未出机」——脚本没有网络观测能力；能观察到的只有
    // 「本脚本代码路径未发起 /ai/chat」，段 B 默认跳过时该断言成立。
    egressObservability:
      'no-probe：脚本不观测上游、不声称未出机；只声明本脚本代码路径未发起 /ai/chat 到真实官方端',
    egressAttemptedByGate: process.env.DF_ALLOW_AI_EGRESS === '1',
    aiEgressOptInEnv: process.env.DF_ALLOW_AI_EGRESS === '1' ? 'DF_ALLOW_AI_EGRESS=1' : 'unset',
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
