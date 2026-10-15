#!/usr/bin/env node
/**
 * verify-mcp-stub —— FE-10 门禁之三：MCP 确认**桩**的契约冒烟 + 显式「桩」标注断言（issue #23 DoD）。
 *
 * 两态（都是真实 daemon 代码路径）：
 *   态 A「正常 diff + 一次性 ack」：真实进程（spawn `apps/daemon/src/main.ts`）——
 *       dryRun 提案（逐项 diff + 一次性 ackToken + 审计 pending）→ 批准（applied:false，桩不真写）
 *       → 重放被拒（mcp_ack_invalid）→ 拒绝路径 → 未知工具被拒 → 审计留痕（token 只存哈希）；
 *   态 B「超时失效」：同一 daemon 应用**进程内**跑（`testing/harness.ts` 注入 ackTtlMs=400ms，
 *       这是唯一免 120s 空等的观察方式，证据里如实标注）→ 过期 ack → 410 mcp_ack_expired
 *       + 审计 decision=expired；并用前端 `confirm.ts` 复核「已失效」语义。
 *
 * 显式「桩」标注断言（达标语义硬要求）：提案响应 `stub:true`、审计备注含「桩」、
 * 前端确认条源码含 `data-df-stub="true"` 挂点、zh-CN 消息的桩角标文案 = 「桩」。
 *
 * 退出码（《前端验收标准 v1》§4，禁止假绿）：
 *   0 = 通过；1 = 断言失败；2 = **阻塞**（daemon 未能启动 / 依赖缺失）。
 *
 * 用法（仓库根执行）：node scripts/verify-mcp-stub.mjs [--verbose]
 * 环境变量：DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）。
 */
import { spawn } from 'node:child_process';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestDaemon, injectJson } from '../apps/daemon/src/testing/harness.ts';
import { createConfirmation, settleAckError, tick } from '../apps/web/src/features/mcp/confirm.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts', 'verify-mcp-stub');
const TICKET = 'fe-10';
/** 契约口径：ackToken 时效 120s（`MCP_ACK_TTL_MS`，形状对齐不引包）。 */
const ACK_TTL_MS = 120_000;

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

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'df-verify-fe10-mcp-'));
  let child = null;
  let inProcess = null;
  let exitCode = 0;
  let blockedReason = null;
  const evidence = {
    ticket: 'FE-10',
    gate: 'verify-mcp-stub',
    page: 'mcp-confirm-bar（F9）· **桩**',
    level: 'A（契约形状 + 一次性/失效语义 + 显式桩标注）',
    stub: true,
    states: {},
    exitCode: 2,
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定覆盖桩契约与标注；界面像素对照归 verify-figma-*（参照集未冻结 → exit 2）。',
    },
  };

  try {
    // —— 态 A：真实进程（完整 HTTP 链路）——
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
    const baseUrl = await waitForListening(child);
    console.log(`[verify-mcp-stub] daemon 监听于 ${baseUrl}`);

    const proposedAt = Date.now();
    const proposal = await call(baseUrl, 'POST', '/mcp/proposals', {
      tool: 'df_apply_patch',
      caller: 'mcp:zcode',
      documentId: 'verify-doc',
      args: { ops: [{ op: 'set-fill', nodeId: 'n1', value: '#0D99FF' }] },
    });
    const proposalResult = proposal.json?.result ?? null;
    const token = proposalResult?.ackToken ?? '';
    const expiresAtMs = Date.parse(proposalResult?.expiresAt ?? '');
    record(
      'A.propose.dryrun-shape',
      proposal.status === 201 &&
        proposalResult?.dryRun === true &&
        proposalResult?.diff?.ops?.length >= 1 &&
        typeof proposalResult?.auditId === 'string' &&
        typeof token === 'string' &&
        token.length >= 32,
      `POST /mcp/proposals → ${proposal.status}（dryRun + 逐项 diff ${proposalResult?.diff?.ops?.length ?? 0} 项 + 一次性 token）`,
    );
    record(
      'A.propose.ttl',
      Number.isFinite(expiresAtMs) && Math.abs(expiresAtMs - proposedAt - ACK_TTL_MS) < 5000,
      `ackToken 时效 = ${String(Math.round((expiresAtMs - proposedAt) / 1000))}s（契约 120s，短时效）`,
    );
    record(
      'A.propose.stub-flag',
      proposalResult?.stub === true,
      '提案响应显式携带 stub:true（桩的机器可读标注）',
    );

    const acked = await call(baseUrl, 'POST', '/mcp/ack', { ackToken: token, approve: true });
    record(
      'A.ack.approved',
      acked.status === 200 &&
        acked.json?.result?.decision === 'approved' &&
        acked.json?.result?.applied === false,
      `POST /mcp/ack → ${acked.status}（approved；applied=false = 桩不真写文档）`,
    );
    record(
      'A.ack.stub-note',
      typeof acked.json?.result?.note === 'string' && acked.json.result.note.includes('桩'),
      `决策备注显式标注桩：「${String(acked.json?.result?.note).slice(0, 40)}…」`,
    );

    const replay = await call(baseUrl, 'POST', '/mcp/ack', { ackToken: token, approve: true });
    record(
      'A.ack.one-shot',
      replay.status === 403 && replay.json?.error?.code === 'mcp_ack_invalid',
      `POST /mcp/ack（重放）→ ${replay.status}（一次性 token 生效：mcp_ack_invalid）`,
    );

    const proposal2 = await call(baseUrl, 'POST', '/mcp/proposals', {
      tool: 'df_run_skill',
      caller: 'local-ai',
      args: { skillId: 'skill-1' },
    });
    const rejected = await call(baseUrl, 'POST', '/mcp/ack', {
      ackToken: proposal2.json?.result?.ackToken ?? '',
      approve: false,
    });
    record(
      'A.ack.rejected',
      rejected.status === 200 &&
        rejected.json?.result?.decision === 'rejected' &&
        rejected.json?.result?.applied === false,
      `拒绝路径 → ${rejected.status}（rejected；未产生任何写入）`,
    );

    const unknownTool = await call(baseUrl, 'POST', '/mcp/proposals', {
      tool: 'df_get_tree',
      caller: 'mcp:zcode',
      args: {},
    });
    record(
      'A.propose.unknown-tool',
      unknownTool.status === 400 && unknownTool.json?.error?.code === 'mcp_tool_unknown',
      `POST /mcp/proposals（读工具冒充写工具）→ ${unknownTool.status}（mcp_tool_unknown）`,
    );

    const audit = await call(baseUrl, 'GET', '/mcp/audit');
    const auditRecords = Array.isArray(audit.json?.result?.records)
      ? audit.json.result.records
      : [];
    const decisions = auditRecords.map((item) => item.decision).sort();
    record(
      'A.audit.decisions',
      decisions.includes('pending') &&
        decisions.includes('approved') &&
        decisions.includes('rejected'),
      `审计留痕：${decisions.join(' / ')}（提案即 pending，决策追加）`,
    );
    record(
      'A.audit.token-hashed',
      !audit.text.includes(token) &&
        auditRecords.every((item) => typeof item.argsDigest === 'string'),
      'token 只存哈希、参数只存摘要（审计不可回放秘密）',
    );
    record(
      'A.audit.stub-note',
      auditRecords.some((item) => typeof item.note === 'string' && item.note.includes('桩')),
      '审计备注显式标注桩（证据口径一致）',
    );

    evidence.states.stateA = {
      id: 'proposal-ack-audit',
      label: '正常 diff + 一次性 ack（真实进程）',
      mode: 'spawned process（完整 HTTP）',
      proposal: proposalResult,
      ack: acked.json?.result ?? null,
      replay: replay.json?.error ?? null,
      rejected: rejected.json?.result ?? null,
      auditDecisions: decisions,
      auditRecords: auditRecords.length,
    };

    // —— 态 B：超时失效（同一 daemon 应用，注入短 TTL 以便观察）——
    const TTL_MS = 400;
    inProcess = await createTestDaemon({ envApiKey: null, mcpAckTtlMs: TTL_MS });
    const proposalB = await injectJson(inProcess.app, {
      method: 'POST',
      url: '/mcp/proposals',
      payload: { tool: 'df_comment_add', caller: 'mcp:workbuddy', args: { text: 'ok' } },
    });
    await sleep(TTL_MS + 150);
    const expired = await injectJson(inProcess.app, {
      method: 'POST',
      url: '/mcp/ack',
      payload: { ackToken: proposalB.payload?.result?.ackToken ?? '', approve: true },
    });
    record(
      'B.ack.expired',
      expired.statusCode === 410 && expired.payload?.error?.code === 'mcp_ack_expired',
      `过期 ack → ${expired.statusCode}（mcp_ack_expired；TTL=${String(TTL_MS)}ms 注入，仅本门禁）`,
    );
    const auditB = await injectJson(inProcess.app, { method: 'GET', url: '/mcp/audit' });
    const expiredRecord = (auditB.payload?.result?.records ?? []).find(
      (item) => item.decision === 'expired',
    );
    record(
      'B.audit.expired-decision',
      expiredRecord !== undefined,
      '失效在审计里落 decision=expired（超时是一等状态，不是静默）',
    );

    // 前端语义复核：同一提案的「已失效」由纯状态机判定（与面板同源）
    const confirmation = createConfirmation(proposalB.payload?.result, Date.now());
    const expiredAt = Date.parse(proposalB.payload?.result?.expiresAt ?? '') + 10;
    const frontendExpired = tick(confirmation, expiredAt);
    const afterServerError = settleAckError(
      { ...confirmation, phase: 'submitting' },
      { code: expired.payload?.error?.code ?? '', message: expired.payload?.error?.message ?? '' },
    );
    record(
      'B.frontend.expired-semantics',
      frontendExpired.phase === 'expired' && afterServerError.phase === 'expired',
      `前端状态机：倒计时越界 → expired；服务端 410 → expired（UI 与 daemon 同判）`,
    );

    evidence.states.stateB = {
      id: 'ack-expired',
      label: '超时失效（同 daemon 应用，短 TTL 注入）',
      mode: `in-process（testing/harness.ts，mcpAckTtlMs=${String(TTL_MS)}；免 120s 空等）`,
      proposal: proposalB.payload?.result ?? null,
      expiredResponse: expired.payload ?? null,
      auditExpired: expiredRecord ?? null,
      frontendPhase: frontendExpired.phase,
    };

    // —— 显式「桩」标注断言（源码 + 消息目录；渲染断言在组件测试里）——
    const barSource = await readFile(
      join(REPO_ROOT, 'apps/web/src/features/mcp/components/McpConfirmBar.tsx'),
      'utf8',
    );
    const zhMessages = JSON.parse(
      await readFile(join(REPO_ROOT, 'apps/web/messages/zh-CN.json'), 'utf8'),
    );
    record(
      'C.ui.stub-marker',
      barSource.includes('data-df-stub="true"'),
      '确认条源码含 data-df-stub="true" 挂点（UI 显式标注，门禁可取样）',
    );
    record(
      'C.ui.stub-copy',
      zhMessages['mcp.stub'] === '桩' &&
        typeof zhMessages['mcp.stub.desc'] === 'string' &&
        zhMessages['mcp.stub.desc'].includes('不会真正改动文档'),
      `zh-CN 桩角标文案 = 「${zhMessages['mcp.stub']}」+ 悬停说明（ADR-0003 全中文）`,
    );
    evidence.stubAnnotations = {
      proposalStubFlag: proposalResult?.stub === true,
      ackNoteMentionsStub: String(acked.json?.result?.note ?? '').includes('桩'),
      auditMentionsStub: auditRecords.some((item) => String(item.note ?? '').includes('桩')),
      uiMarker: 'data-df-stub="true"',
      uiCopy: zhMessages['mcp.stub'],
      evidenceStubFlag: true,
    };
  } catch (error) {
    exitCode = 2;
    blockedReason = String(error);
    console.error(`[verify-mcp-stub] 阻塞：${blockedReason}`);
    record('bootstrap', false, `阻塞：${blockedReason}`);
  } finally {
    if (child !== null) {
      child.kill('SIGTERM');
      await sleep(150);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (inProcess !== null) await inProcess.cleanup();
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
    ackTtlMsContract: ACK_TTL_MS,
    stepsTotal: steps.length,
    stepsFailed: steps.filter((step) => !step.ok).length,
  };
  if (verbose) console.log(`  证据摘要：${JSON.stringify(evidence.stubAnnotations)}`);

  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = join(EVIDENCE_ROOT, TICKET, 'verify-mcp-stub.json');
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, text);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(join(ARTIFACTS_DIR, 'evidence.json'), text);

  console.log(
    `[verify-mcp-stub] 步骤 ${steps.length} 项，失败 ${evidence.meta.stepsFailed} 项；证据：${evidencePath}；退出码 ${exitCode}`,
  );
  if (exitCode === 0) {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`[verify-mcp-stub] 保留现场：${tempRoot}`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[verify-mcp-stub] 未捕获异常：', error);
  process.exit(2);
});
