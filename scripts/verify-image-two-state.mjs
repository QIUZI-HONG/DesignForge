#!/usr/bin/env node
/**
 * verify-image-two-state —— FE-10 门禁之二：出图面板的**两态**取证（issue #23 DoD）。
 *
 * 两态（都真跑 daemon）：
 *   态 A「ComfyUI 未启动」：真跑——指向死端口 → `/image/probe` reachable:false + 结构化失败态；
 *       `/image/runs` → 503 + actions（未启动是一等状态，不是统一报错）；
 *   态 B「正常态（本机 mock ComfyUI）」：真跑——mock 实现 `/system_stats`、`/object_info`、
 *       `/prompt`、`/queue`、`/history/:id`、`/view`（全程本机回环）→ 提交、**前端轮询器推进**、
 *       产出按内容哈希落盘（sha256 复算）、取消落 canceled；再加大 OOM 分支（降档重试的依据）。
 *
 * 断言的真源：脚本直接导入前端纯逻辑 `apps/web/src/features/image/{run,failure}.ts`
 * （与面板是同一份代码）——轮询序列、失败映射、OOM 降档都跑它们。
 *
 * 退出码（《前端验收标准 v1》§4，禁止假绿）：
 *   0 = 两态取证通过；1 = 断言失败；2 = **阻塞**（daemon 或 mock ComfyUI 未能启动）。
 *
 * 用法（仓库根执行）：node scripts/verify-image-two-state.mjs [--verbose]
 * 环境变量：DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  downgradeInputs,
  failureFromStatus,
  failureOf,
} from '../apps/web/src/features/image/failure.ts';
import { trackImageRun } from '../apps/web/src/features/image/run.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts', 'verify-image-two-state');
const TICKET = 'fe-10';
/** 死端口：承诺无服务的回环端口（对本机可能真实运行的 ComfyUI 无假设）。 */
const DEAD_COMFY_URL = 'http://127.0.0.1:59998';
/** 1×1 透明 PNG（mock `/view` 的产出字节；daemon 只做内容哈希，不做图像解析）。 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

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

function waitForListening(child) {
  return new Promise((settle, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('daemon 启动超时（10s）')), 10_000);
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
      reject(new Error(`daemon 提前退出（code=${code}）：${buffer.slice(-300)}`));
    });
  });
}

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

/**
 * 本机 mock ComfyUI（ComfyUI 原生 HTTP 子集；只回环、不出机）。
 *
 * 计划序列（按 `/prompt` 调用次序）：1=成功；2=OOM 失败；3=运行中（供取消）。
 */
function startMockComfy() {
  const plans = [];
  const calls = { prompts: 0, views: 0, history: 0 };
  let nextId = 1;
  const pending = new Map(); // prompt_id → plan

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const sendJson = (payload) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (url.pathname === '/system_stats') {
      sendJson({
        devices: [{ name: 'mock-gpu', vram_total: 8 * 1024 * 1024 * 1024 }],
      });
      return;
    }
    if (url.pathname === '/object_info') {
      sendJson({
        CheckpointLoaderSimple: {
          input: { required: { ckpt_name: [['sd15.safetensors'], { tooltip: 'mock' }] } },
        },
      });
      return;
    }
    if (url.pathname === '/prompt' && request.method === 'POST') {
      calls.prompts += 1;
      const plan = plans.shift() ?? 'success';
      const promptId = `mock-${String(nextId)}`;
      nextId += 1;
      pending.set(promptId, plan);
      sendJson({ prompt_id: promptId, number: calls.prompts });
      return;
    }
    if (url.pathname === '/queue') {
      const running = [...pending.entries()]
        .filter(([, plan]) => plan === 'running')
        .map(([id]) => [0, id, {}, {}]);
      sendJson({ queue_running: running, queue_pending: [] });
      return;
    }
    if (url.pathname.startsWith('/history/')) {
      calls.history += 1;
      const promptId = url.pathname.slice('/history/'.length);
      const plan = pending.get(promptId);
      if (plan === undefined || plan === 'running') {
        sendJson({});
        return;
      }
      if (plan === 'success') {
        sendJson({
          [promptId]: {
            status: { status_str: 'success', completed: true },
            outputs: {
              9: { images: [{ filename: 'icon_00001_.png', subfolder: '', type: 'output' }] },
            },
          },
        });
        return;
      }
      sendJson({
        [promptId]: {
          status: {
            status_str: 'error',
            completed: false,
            messages: [['execution_error', { exception_message: 'CUDA out of memory' }]],
          },
          outputs: {},
        },
      });
      return;
    }
    if (url.pathname === '/view') {
      calls.views += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
      return;
    }
    if (url.pathname === '/interrupt' && request.method === 'POST') {
      sendJson({ ok: true });
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });

  return new Promise((settle, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      settle({
        baseUrl: `http://127.0.0.1:${String(server.address().port)}`,
        calls,
        setPlans(sequence) {
          plans.length = 0;
          plans.push(...sequence);
        },
        /** 把某个任务的计划改判（如 running → success），推进轮询序列。 */
        finish(promptId, plan = 'success') {
          pending.set(promptId, plan);
        },
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** 用前端轮询器跟踪一个任务（intervalMs 注入为 60ms，避免证据生成久等）。 */
function trackViaFrontend(baseUrl, runId, options = {}) {
  const updates = [];
  let settleDone;
  const done = new Promise((settle) => {
    settleDone = settle;
  });
  const port = {
    status: async (id) => {
      const response = await call(baseUrl, 'GET', `/image/runs/${encodeURIComponent(id)}`);
      if (response.json?.ok !== true) {
        const error = new Error(response.json?.error?.message ?? 'status 失败');
        error.code = response.json?.error?.code;
        throw error;
      }
      const value = response.json.result;
      return value;
    },
    cancel: async (id) => {
      const response = await call(baseUrl, 'POST', `/image/runs/${encodeURIComponent(id)}/cancel`);
      return response.json.result;
    },
  };
  const tracker = trackImageRun({
    runId,
    port,
    intervalMs: 60,
    onUpdate: (status) => {
      updates.push({
        state: status.state,
        queuePosition: status.queuePosition,
        progress: status.progress,
        artifacts: status.artifacts.length,
      });
      if (updates.length === 1) options.onFirstUpdate?.(status);
      if (['succeeded', 'failed', 'canceled'].includes(status.state)) settleDone(status);
    },
    onError: (error) => {
      updates.push({ state: 'error', message: String(error) });
      settleDone(null);
    },
  });
  return { tracker, updates, done };
}

/** 可选 UI 挂载探测（宿主页未挂载即如实记 pending，不影响本门禁的功能判定）。 */
async function probeUiEvidence() {
  const webUrl = process.env.DF_WEB_URL;
  if (webUrl === undefined || webUrl.length === 0) {
    return { status: 'not-configured', reason: '未设置 DF_WEB_URL（UI 截图门禁归参照集票）' };
  }
  try {
    const response = await fetch(webUrl, { redirect: 'manual' });
    const html = await response.text();
    const mounted = html.includes('data-df-panel="image"');
    return mounted
      ? { status: 'captured-marker', reason: '宿主页 HTML 含 data-df-panel="image" 挂点' }
      : {
          status: 'pending',
          reason: '宿主页未挂载出图面板（FE-03 编辑器壳未接入口）；功能两态已完成取证',
        };
  } catch (error) {
    return { status: 'pending', reason: `宿主页不可达：${String(error)}` };
  }
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'df-verify-fe10-image-'));
  const dataRoot = join(tempRoot, 'data');
  let child = null;
  let mock = null;
  let exitCode = 0;
  let blockedReason = null;
  let daemonLog = '';
  const evidence = {
    ticket: 'FE-10',
    gate: 'verify-image-two-state',
    page: 'image-panel（F5）· 数据面两态',
    level: 'A（结构化失败态 + 轮询序列 + 产出哈希复算）',
    states: {},
    exitCode: 2,
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定覆盖数据面两态；界面像素对照归 verify-figma-*（参照集未冻结 → exit 2）。',
    },
  };

  try {
    mock = await startMockComfy();
    console.log(`[verify-image-two-state] mock ComfyUI 就绪：${mock.baseUrl}（本机回环）`);

    child = spawn(
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
    child.stdout.on('data', (chunk) => {
      daemonLog += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      daemonLog += chunk.toString();
    });
    const baseUrl = await waitForListening(child);
    console.log(`[verify-image-two-state] daemon 监听于 ${baseUrl}`);
    // —— 态 A：ComfyUI 未启动（真跑死端口）——
    await call(baseUrl, 'PUT', '/config', { comfy: { baseUrl: DEAD_COMFY_URL } });
    const probeA = await call(baseUrl, 'GET', '/image/probe');
    record(
      'A.probe.unreachable',
      probeA.status === 200 &&
        probeA.json?.result?.reachable === false &&
        probeA.json?.result?.failure?.code === 'comfy_unreachable',
      `GET /image/probe（死端口）→ ${probeA.status}（reachable=false + comfy_unreachable）`,
    );
    const submitA = await call(baseUrl, 'POST', '/image/runs', {
      inputs: { positive: 'wasteland gear icon', width: 768 },
    });
    const viewA = failureOf({
      code: submitA.json?.error?.code ?? 'internal',
      message: submitA.json?.error?.message ?? '',
      details: submitA.json?.error?.details ?? null,
    });
    record(
      'A.submit.actions',
      submitA.status === 503 &&
        viewA.code === 'comfy_unreachable' &&
        viewA.actions.includes('retry-probe') &&
        viewA.actions.includes('set-base-url'),
      `POST /image/runs → ${submitA.status}；前端失败视图 actions=[${viewA.actions.join(', ')}]`,
    );
    evidence.states.stateA = {
      id: 'comfy-not-running',
      label: 'ComfyUI 未启动（真跑）',
      probe: probeA.json?.result ?? null,
      submitError: submitA.json?.error ?? null,
      uiFailureView: viewA,
    };

    // —— 态 B：正常态（mock ComfyUI；成功 / 取消 / OOM 三分支）——
    await call(baseUrl, 'PUT', '/config', { comfy: { baseUrl: mock.baseUrl } });
    const probeB = await call(baseUrl, 'GET', '/image/probe');
    record(
      'B.probe.reachable',
      probeB.status === 200 &&
        probeB.json?.result?.reachable === true &&
        probeB.json?.result?.models?.checkpoints?.includes('sd15.safetensors'),
      `GET /image/probe（mock）→ ${probeB.status}（reachable=true，checkpoint sd15.safetensors）`,
    );

    const runInputs = {
      positive: 'wasteland gear icon',
      width: 512,
      height: 512,
      steps: 20,
      cfg: 7,
    };
    // 计划：B=运行中（脚本再推进为成功，演示 running→succeeded）；C=运行中（供取消）；D=OOM
    mock.setPlans(['running', 'running', 'oom']);
    const submitB = await call(baseUrl, 'POST', '/image/runs', { inputs: runInputs });
    const runId = submitB.json?.result?.runId;
    record(
      'B.submit.handle',
      submitB.status === 202 &&
        typeof runId === 'string' &&
        submitB.json?.result?.state === 'queued',
      `POST /image/runs → ${submitB.status}（runId=${String(runId)}，queued）`,
    );

    // 前端轮询器推动到终态（与面板同源）；首轮看到 running 后把 mock 的该任务改判为成功
    const tracked = trackViaFrontend(baseUrl, runId, {
      onFirstUpdate: (status) => {
        if (status.state === 'running') mock.finish(runId, 'success');
      },
    });
    const finalStatus = await tracked.done;
    const expectedSha = createHash('sha256').update(PNG_BYTES).digest('hex');
    const artifact = finalStatus?.artifacts?.[0] ?? null;
    const pollSequence = tracked.updates.map((update) => update.state);
    record(
      'B.poll.succeeded',
      finalStatus?.state === 'succeeded' &&
        pollSequence[0] === 'running' &&
        pollSequence.at(-1) === 'succeeded',
      `前端轮询器推进 ${tracked.updates.length} 次 → ${String(finalStatus?.state)}（序列 ${pollSequence.join(' > ')}）`,
    );
    let storedHashOk = false;
    if (artifact !== null && artifact.storedPath !== null) {
      try {
        const bytes = await readFile(artifact.storedPath);
        storedHashOk = createHash('sha256').update(bytes).digest('hex') === artifact.sha256;
      } catch {
        storedHashOk = false;
      }
    }
    record(
      'B.artifact.content-addressed',
      artifact !== null && artifact.sha256 === expectedSha && storedHashOk && mock.calls.views >= 1,
      `产出按内容哈希落盘：sha256=${String(artifact?.sha256).slice(0, 12)}…（与 mock 字节一致，落盘可复算）`,
    );

    // 取消分支：mock 计划 = running（无 history）→ 取消落 canceled
    const submitC = await call(baseUrl, 'POST', '/image/runs', { inputs: runInputs });
    const runIdC = submitC.json?.result?.runId;
    const cancel = await call(baseUrl, 'POST', `/image/runs/${encodeURIComponent(runIdC)}/cancel`);
    record(
      'B.cancel.canceled',
      cancel.status === 200 && cancel.json?.result?.state === 'canceled',
      `POST /image/runs/:id/cancel → ${cancel.status}（canceled：用户取消是静默非错误）`,
    );

    // OOM 分支：mock history 带 execution_error + out of memory → comfy_oom + 降档依据
    const submitD = await call(baseUrl, 'POST', '/image/runs', { inputs: runInputs });
    const runIdD = submitD.json?.result?.runId;
    const statusD = await call(baseUrl, 'GET', `/image/runs/${encodeURIComponent(runIdD)}`);
    const oomFailure = statusD.json?.result?.failure ?? null;
    const oomView = oomFailure === null ? null : failureFromStatus(oomFailure);
    const lowered = downgradeInputs(runInputs);
    record(
      'B.oom.downgrade',
      statusD.json?.result?.state === 'failed' &&
        oomView?.isOom === true &&
        lowered.width === 384 &&
        lowered.height === 384 &&
        lowered.steps === 15,
      `OOM → comfy_oom；降档（512→${String(lowered.width)}，steps 20→${String(lowered.steps)}）即「降档重试」动作依据`,
    );

    evidence.states.stateB = {
      id: 'comfy-running-mock',
      label: '正常态（本机 mock ComfyUI）',
      mockBaseUrl: mock.baseUrl,
      probe: probeB.json?.result ?? null,
      submittedRunId: runId ?? null,
      pollUpdates: tracked.updates,
      finalArtifacts: finalStatus?.artifacts ?? [],
      expectedArtifactSha256: expectedSha,
      storedHashOk,
      cancel: cancel.json?.result ?? null,
      oomFailure,
      oomUiView: oomView,
      downgradedInputs: lowered,
      mockCalls: mock.calls,
    };
    if (verbose) {
      console.log(`  轮询序列：${tracked.updates.map((update) => update.state).join(' > ')}`);
    }
    evidence.uiEvidence = await probeUiEvidence();
    if (evidence.uiEvidence.status === 'pending') {
      console.log(`  [待办] UI 挂点：${evidence.uiEvidence.reason}`);
    }
  } catch (error) {
    exitCode = 2;
    blockedReason = String(error);
    console.error(`[verify-image-two-state] 阻塞：${blockedReason}`);
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

  evidence.exitCode = exitCode;
  evidence.blockedReason = blockedReason;
  evidence.steps = steps;
  evidence.meta = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    node: process.version,
    daemonLogBytes: daemonLog.length,
    stepsTotal: steps.length,
    stepsFailed: steps.filter((step) => !step.ok).length,
  };

  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = join(EVIDENCE_ROOT, TICKET, 'verify-image-two-state.json');
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, text);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(join(ARTIFACTS_DIR, 'evidence.json'), text);

  console.log(
    `[verify-image-two-state] 步骤 ${steps.length} 项，失败 ${evidence.meta.stepsFailed} 项；证据：${evidencePath}；退出码 ${exitCode}`,
  );
  if (exitCode === 0) {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`[verify-image-two-state] 保留现场：${tempRoot}`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[verify-image-two-state] 未捕获异常：', error);
  process.exit(2);
});
