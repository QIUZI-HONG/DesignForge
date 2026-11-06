/**
 * perf-ci-judgment —— 渲染性能门禁（verify:perf）「正式判定挂点」的 CI 裁决共享件。
 *
 * 批 7（0b733ae）把本步接成 CI 时，exit 2 的收放判据写成了 **grep 门禁日志文本**
 * （「日志含 provisional 字样即红」）——但门禁 exit 2 的**合法阻塞文案**本身就含
 * 「provisional」字样（verify-perf.mjs 阻塞聚合行与待办行），CI 无 Chromium 恒 exit 2
 * → 文案必然命中 → 该步在 CI **永不可能绿**（run 42313746571 翻车实录，audit-d07b）。
 *
 * 本模块把判据从「自由文本」改到「**基线 JSON 状态字段**」：查
 * `docs/quality/perf-baseline-v1.json` 的 `provisional` 字段（布尔）——基线是否被回退
 * 成模板态，以字段为准，与门禁输出的措辞彻底解耦（门禁文案从此无害，不降判定强度：
 * provisional:true 基线回退依旧红）。判定语义：
 *   exit 0        → 收：门禁正式判定通过（判定档全达标）；
 *   exit 1        → 红：实测超阈值（真违规，禁以环境理由掩盖）；
 *   exit 2        → 仅当基线 `provisional === false`（已实采转正）→ 收（挂点阻塞语义：
 *                    CI 无真链路族阻塞，阻塞不是通过）；基线回退（provisional:true）、
 *                    字段缺失/非布尔、基线文件缺失或 JSON 解析失败 → 一律红；
 *   其余退出码    → 红。
 *
 * 与 two-state-verdict.mjs（tp2-03）同构：本模块**不运行门禁脚本**、不读门禁日志，
 * 只做裁决；门禁脚本 verify-perf.mjs 本身与输出文案不改。
 *
 * 用法（仓库根执行）：
 *   node scripts/lib/perf-ci-judgment.mjs <baseline-json> <gate-exit-code> [gate-name]
 *   baseline-json  性能基线 JSON 路径（判定输入；CI 传 docs/quality/perf-baseline-v1.json）；
 *   gate-exit-code 门禁脚本退出码；
 *   gate-name      门禁显示名（可选，仅用于日志措辞，不影响判定）。
 * 退出码：0 = 该 CI 步骤收下（含合规阻塞语义收）；1 = 违规 / 红（含缺参误用）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE =
  '用法：node scripts/lib/perf-ci-judgment.mjs <baseline-json> <gate-exit-code> [gate-name]';

/**
 * 裁决渲染性能门禁的一步 CI 判码。纯函数：不 process.exit、不直接打印，返回判定结果
 * 由调用方（CLI 壳 / 测试）落地——单测因此可以直采判定而不必 spawn。
 *
 * @param {string} baselinePath 性能基线 JSON 路径（`provisional` 字段的判定输入）。
 * @param {number} gateExitCode 门禁脚本退出码。
 * @param {string} [gateName='渲染性能门禁'] 门禁显示名（仅用于日志措辞）。
 * @returns {{exitCode: 0 | 1, stream: 'out' | 'err', message: string}} 判定结果：
 *   exitCode=该 CI 步骤应收下的退出码；stream/message=判定说明应落的输出流与文案。
 */
export function perfCiJudgment(baselinePath, gateExitCode, gateName = '渲染性能门禁') {
  if (gateExitCode === 0) {
    return {
      exitCode: 0,
      stream: 'out',
      message: `OK：${gateName}正式判定通过（基线已转正，判定档全达标）。`,
    };
  }
  if (gateExitCode === 1) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：${gateName} exit=1——性能实测超阈值（真违规），禁以环境理由掩盖。`,
    };
  }
  if (gateExitCode !== 2) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：${gateName} exit=${gateExitCode}——不符三态语义（期望 0 收 / 1 红违规 / 2+基线转正态阻塞）。`,
    };
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：exit 2 但基线缺失或 JSON 解析失败（${baselinePath}：${err?.message ?? err}）——判据在基线状态字段不在日志文本，基线不可读一律红。`,
    };
  }
  // 严格布尔判定：`provisional` 字段必须恰为 false 才证明基线已实采转正；
  // true = 基线被回退成模板态（门禁按设计恒阻塞，收下即假绿）；缺失/非布尔 = 无法
  // 证明转正态，同样红——字段不可读时宁可误红给人工复核，不得静默放行。
  const provisional = baseline?.provisional;
  if (provisional === false) {
    return {
      exitCode: 0,
      stream: 'out',
      message: `OK（挂点，非通过）：基线 provisional:false（已实采转正）但 CI 无真链路（Chromium 缺失/构建/daemon）→ exit 2 阻塞——门禁确已执行且未假绿；严格正式判定随浏览器门禁票接入 CI 真链路后收口。`,
    };
  }
  if (provisional === true) {
    return {
      exitCode: 1,
      stream: 'err',
      message: `违规：exit 2 且基线 provisional:true——基线已回退成模板态（查 ${baselinePath} 是否被回退），门禁不得以模板态阻塞收场。`,
    };
  }
  return {
    exitCode: 1,
    stream: 'err',
    message: `违规：exit 2 且基线 provisional 字段缺失或非布尔（值=${JSON.stringify(provisional)}）——无法证明基线已转正，不得收。`,
  };
}

/** CLI 壳：argv → 判定 → 输出与退出码。供 `node scripts/lib/perf-ci-judgment.mjs` 直跑。 */
function main(argv) {
  const [baselinePath, codeArg, gateName] = argv;
  // 缺参 / 退出码非非负整数 = CI 步骤自身误配，必须红（不得静默放行）。
  if (!baselinePath || codeArg === undefined || !/^\d+$/.test(codeArg)) {
    console.error(USAGE);
    return 1;
  }
  const verdict = perfCiJudgment(baselinePath, Number(codeArg), gateName);
  if (verdict.stream === 'out') console.log(verdict.message);
  else console.error(verdict.message);
  return verdict.exitCode;
}

// 仅作为主模块直跑时落地 CLI（单测 import 本模块取 perfCiJudgment，不得触发退出）。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
