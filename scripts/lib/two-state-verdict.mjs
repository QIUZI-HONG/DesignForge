/**
 * two-state-verdict —— FE-10 两态门禁的 CI 判码共享裁决（tp2-03 · 评审 Nit#7 去重）。
 *
 * tp1-05 在 ci.yml 的 AI / 出图两步里各留了一段 ~40 行同构判码（bash 退出码分派 +
 * 内联 node 读证据），本模块把**逐语义等价**的判定抽成共享件，两步各缩至数行。
 * 判定语义（与 ci.yml 原两段一致，口径见 implementation-workflow.md 三态语义，禁假绿）：
 *   exit 0        → 收：门禁在 CI 完整通过（含 UI 段）；
 *   exit 1 / 其余 → 红：真失败，不得当阻塞；
 *   exit 2        → 仅当证据 JSON `meta.stepsFailed === 0` 且 `blockedReason` 为非空字符串
 *                    → 收（阻塞语义：数据面全过、仅 UI 挂载段阻塞，挂点）；
 *                    证据缺失 / JSON 解析失败 / 证据不符（bootstrap 阻塞如 daemon 起不来
 *                    会留下失败步骤）→ 一律红。
 *
 * 本模块**不运行门禁脚本**（NODE_OPTIONS / env 由 ci.yml 步骤原样保留），只做裁决；
 * 两态门禁脚本本身（verify-ai/image-two-state.mjs）不改。
 *
 * 用法（仓库根执行）：
 *   node scripts/lib/two-state-verdict.mjs <evidence-json> <gate-exit-code> [gate-name]
 *   evidence-json  门禁证据 JSON 路径（判定输入）；
 *   gate-exit-code 门禁脚本退出码；
 *   gate-name      门禁显示名（可选，仅用于日志措辞，不影响判定）。
 * 退出码：0 = 该 CI 步骤收下（含合规阻塞语义收）；1 = 违规 / 红（含缺参误用）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = '用法：node scripts/lib/two-state-verdict.mjs <evidence-json> <gate-exit-code> [gate-name]';

/**
 * 裁决两态门禁的一步 CI 判码。纯函数：不 process.exit、不直接打印，返回判定结果
 * 由调用方（CLI 壳 / 测试）落地——单测因此可以直采判定而不必 spawn。
 *
 * @param {string} evidencePath 门禁证据 JSON 路径（判定输入）。
 * @param {number} gateExitCode 门禁脚本退出码。
 * @param {string} [gateName='两态门禁'] 门禁显示名（仅用于日志措辞）。
 * @returns {{exitCode: 0 | 1, stream: 'out' | 'err', message: string}} 判定结果：
 *   exitCode=该 CI 步骤应收下的退出码；stream/message=判定说明应落的输出流与文案。
 */
export function twoStateVerdict(evidencePath, gateExitCode, gateName = '两态门禁') {
  if (gateExitCode === 0) {
    return {
      exitCode: 0,
      stream: 'out',
      message: `${gateName}在 CI 完整通过（含 UI 段）：本步骤此后应改为必须 exit 0。`,
    };
  }
  if (gateExitCode !== 2) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：${gateName} exit=${gateExitCode}（1=数据面断言失败；其余=非预期）——真失败，不得当阻塞。`,
    };
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (err) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：exit 2 但证据缺失或 JSON 解析失败（${evidencePath}：${err?.message ?? err}）——bootstrap 阻塞不得冒充 UI 段挂点。`,
    };
  }
  // 证据语义与原两段内联判定一致：stepsFailed 落 `?? -1`（缺失/非 0 都不符），
  // blockedReason 必须是非空字符串；`evidence?.` 兜住 JSON null（原实现此处抛 TypeError
  // 崩溃红，这里改判码红——判定结果等价，文案更可读）。
  const failed = evidence?.meta?.stepsFailed ?? -1;
  const blockedReason = evidence?.blockedReason;
  const blocked = typeof blockedReason === 'string' && blockedReason.length > 0;
  if (failed !== 0 || !blocked) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：exit 2 但证据不符（stepsFailed=${String(failed)}，blockedReason=${JSON.stringify(blockedReason)}）——bootstrap 阻塞不得冒充 UI 段挂点。`,
    };
  }
  return {
    exitCode: 0,
    stream: 'out',
    message: `OK：${gateName}数据面两态 ${String(evidence?.meta?.stepsTotal ?? '?')} 步全过；仅 UI 挂载段阻塞（exit 2 非通过，UI 段挂点）。`,
  };
}

/** CLI 壳：argv → 判定 → 输出与退出码。供 `node scripts/lib/two-state-verdict.mjs` 直跑。 */
function main(argv) {
  const [evidencePath, codeArg, gateName] = argv;
  // 缺参 / 退出码非非负整数 = CI 步骤自身误配，必须红（不得静默放行）。
  if (!evidencePath || codeArg === undefined || !/^\d+$/.test(codeArg)) {
    console.error(USAGE);
    return 1;
  }
  const verdict = twoStateVerdict(evidencePath, Number(codeArg), gateName);
  if (verdict.stream === 'out') console.log(verdict.message);
  else console.error(verdict.message);
  return verdict.exitCode;
}

// 仅作为主模块直跑时落地 CLI（单测 import 本模块取 twoStateVerdict，不得触发退出）。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
