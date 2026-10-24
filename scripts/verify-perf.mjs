#!/usr/bin/env node
/**
 * verify-perf —— 渲染性能门禁挂点（工单 04 · 挂点起步，**未接 CI**）。
 *
 * 数据源（规格 §渲染观测 seam）：`window.__dforgeCanvas.perf()` 只读快照
 * （帧耗时 + rAF 间隔的环形窗口汇总，见 apps/web/src/features/canvas/render/frame-perf.ts）
 * 与 `stats()` 绘制计数——同源只读、按需查询，不逐帧上行、无独立上报链路
 * （daemon 遥测仅接收汇总，沿用 JSONL；本门禁本身零网络零写盘副作用，除证据落盘）。
 *
 * 职责（对标报告 §4.5 门禁挂点设计）：
 *   1. 校验性能基线（`df.perf.baseline/v1`：阈值 + 最小样本数）与性能快照的结构；
 *   2. 判定：interval/duration 的窗口 p95 是否超阈值。
 *
 * 退出码（门禁三态，**禁止假绿**）：
 *   0 = 有基线有快照、样本足、全部达标；
 *   1 = **违规**——有基线有快照但 p95 超阈值（性能回退）；
 *   2 = **阻塞**——基线未入库 / 快照缺失 / 结构非法 / 样本不足（判不了就是阻塞）。
 *
 * M7 剔除率（clipped/nodes）是**记录性指标**（§4.4：不设通过线，数据随证据留存，
 * 供「空间索引是否立项」的基线讨论），故不在本判定内；快照里若带 stats 计数则原样入证据。
 *
 * 证据落盘：`<DF_EVIDENCE_DIR>/perf/verify-perf-<时间戳>.json`，schema `df.perf.evidence/v1`
 * （字段族对齐既有 verify-* 证据纪律；阻塞也落盘）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-perf.mjs                                   # 缺省基线 docs/quality/perf-baseline-v1.json
 *   DF_PERF_SNAPSHOT=snap.json node scripts/verify-perf.mjs --verbose
 *   node scripts/verify-perf.mjs --baseline b.json --snapshot s.json
 *   node scripts/verify-perf.mjs --self-test                       # 自测夹具（验辨别力：2/1/0 三态）
 *
 * 环境变量：DF_PERF_BASELINE（基线 JSON 路径）、DF_PERF_SNAPSHOT（快照 JSON 路径）、
 *           DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const EVIDENCE_DIR = join(EVIDENCE_ROOT, 'perf');
/** 缺省基线入库路径（dev 机基线轮产出入库；未入库 = 门禁阻塞，禁拿拍脑袋阈值判性能）。 */
const DEFAULT_BASELINE = join(REPO_ROOT, 'docs', 'quality', 'perf-baseline-v1.json');
const BASELINE_SCHEMA = 'df.perf.baseline/v1';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const selfTestMode = args.includes('--self-test');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** 结构校验：每个字段必须是正数。 */
function requirePositiveNumbers(object, fields, problems, label) {
  for (const field of fields) {
    const value = object?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      problems.push(`${label}.${field} 必须是正数（实测 ${String(value)}）`);
    }
  }
}

/** 结构校验：窗口四项（last/avg/p95/max）必须是数字或 null。 */
function validateWindow(window, problems, label) {
  if (window === null || typeof window !== 'object') {
    problems.push(`${label} 必须是对象`);
    return;
  }
  for (const field of ['lastMs', 'avgMs', 'p95Ms', 'maxMs']) {
    const value = window[field];
    if (value !== null && typeof value !== 'number') {
      problems.push(`${label}.${field} 必须是数字或 null（实测 ${String(value)}）`);
    }
  }
}

/** 基线结构校验（判不了就是阻塞，缺项即报）。 */
export function validateBaseline(baseline) {
  const problems = [];
  if (baseline === null || typeof baseline !== 'object') {
    return ['性能基线不是对象'];
  }
  if (baseline.schema !== BASELINE_SCHEMA) {
    problems.push(`基线 schema 应为 ${BASELINE_SCHEMA}（实测 ${String(baseline.schema)}）`);
  }
  if (baseline.thresholds === null || typeof baseline.thresholds !== 'object') {
    problems.push('缺 thresholds（阈值对象）');
  } else {
    requirePositiveNumbers(
      baseline.thresholds,
      ['intervalP95Ms', 'durationP95Ms'],
      problems,
      'thresholds',
    );
  }
  const minFrames = baseline.minFrames;
  if (minFrames !== undefined && (typeof minFrames !== 'number' || minFrames < 0)) {
    problems.push(`minFrames 必须是非负数（实测 ${String(minFrames)}）`);
  }
  return problems;
}

/** 快照结构校验（`__dforgeCanvas.perf()` 打包落盘的形态）。 */
export function validateSnapshot(snapshot) {
  const problems = [];
  if (snapshot === null || typeof snapshot !== 'object') {
    return ['性能快照不是对象'];
  }
  if (snapshot.version !== 1) {
    problems.push(`快照 version 应为 1（实测 ${String(snapshot.version)}）`);
  }
  if (typeof snapshot.frames !== 'number' || snapshot.frames < 0) {
    problems.push(`快照 frames 必须是非负数（实测 ${String(snapshot.frames)}）`);
  }
  if (typeof snapshot.windowSize !== 'number' || snapshot.windowSize <= 0) {
    problems.push(`快照 windowSize 必须是正数（实测 ${String(snapshot.windowSize)}）`);
  }
  validateWindow(snapshot.duration, problems, '快照 duration');
  validateWindow(snapshot.interval, problems, '快照 interval');
  return problems;
}

/**
 * 判定一份性能快照（纯函数，供 CLI 与自测共用）。不写证据、不退出——由调用方决定出口。
 *
 * @param {object|null} snapshot `__dforgeCanvas.perf()` 快照（结构见 validateSnapshot）
 * @param {object|null} baseline 性能基线（结构见 validateBaseline）
 * @returns {{ code: 0|1|2, summary: string, problems: string[], violations: string[], metrics: object|null }}
 */
export function evaluatePerf(snapshot, baseline) {
  if (baseline === null || baseline === undefined) {
    return blocked('无性能基线（基线未入库）——不得据此下任何性能结论', [], null);
  }
  if (snapshot === null || snapshot === undefined) {
    return blocked('无性能快照（观测通道未产出证据；需经 __dforgeCanvas.perf() 采集）', [], null);
  }
  const baselineProblems = validateBaseline(baseline);
  if (baselineProblems.length > 0) {
    return blocked(
      `基线结构非法（${baselineProblems.length} 项）：${baselineProblems.join('；')}`,
      baselineProblems,
      null,
    );
  }
  const snapshotProblems = validateSnapshot(snapshot);
  if (snapshotProblems.length > 0) {
    return blocked(
      `快照结构非法（${snapshotProblems.length} 项）：${snapshotProblems.join('；')}`,
      snapshotProblems,
      null,
    );
  }

  const thresholds = baseline.thresholds;
  const minFrames = baseline.minFrames ?? 0;
  const metrics = {
    frames: snapshot.frames,
    intervalP95Ms: snapshot.interval.p95Ms,
    durationP95Ms: snapshot.duration.p95Ms,
    threshold: { intervalP95Ms: thresholds.intervalP95Ms, durationP95Ms: thresholds.durationP95Ms },
  };
  if (snapshot.frames < minFrames) {
    return blocked(
      `样本不足（frames=${String(snapshot.frames)} < minFrames=${String(minFrames)}）——窗口未攒够，判不了（禁拿不足样本下结论）`,
      [],
      metrics,
    );
  }

  const violations = [];
  if (snapshot.interval.p95Ms > thresholds.intervalP95Ms) {
    violations.push(
      `interval.p95Ms ${snapshot.interval.p95Ms}ms > 阈值 ${thresholds.intervalP95Ms}ms（M2 交互帧率回退）`,
    );
  }
  if (snapshot.duration.p95Ms > thresholds.durationP95Ms) {
    violations.push(
      `duration.p95Ms ${snapshot.duration.p95Ms}ms > 阈值 ${thresholds.durationP95Ms}ms（绘制耗时回退）`,
    );
  }
  if (violations.length > 0) {
    return {
      code: 1,
      summary: `性能回退 ${String(violations.length)} 项：${violations.join('；')}`,
      problems: [],
      violations,
      metrics,
    };
  }
  const framesNote = `frames=${String(snapshot.frames)}`;
  return {
    code: 0,
    summary:
      `达标：interval p95 ${snapshot.interval.p95Ms}ms ≤ ${thresholds.intervalP95Ms}ms；` +
      `duration p95 ${snapshot.duration.p95Ms}ms ≤ ${thresholds.durationP95Ms}ms（${framesNote}）`,
    problems: [],
    violations: [],
    metrics,
  };
}

/** 阻塞结果（code 2）的统一形状。 */
function blocked(summary, problems, metrics) {
  return { code: 2, summary, problems, violations: [], metrics };
}

/**
 * 自测夹具：证明门禁有辨别力（无基线/无快照/结构非法/样本不足 → 2；超阈 → 1；全对 → 0）。
 * evaluatePerf 是纯函数，夹具直接用字面量。
 */
export function selfTest() {
  const baseline = {
    schema: BASELINE_SCHEMA,
    thresholds: { intervalP95Ms: 16.7, durationP95Ms: 16.7 },
    minFrames: 60,
  };
  const snapshot = {
    version: 1,
    frames: 120,
    windowSize: 240,
    duration: { lastMs: 10, avgMs: 9, p95Ms: 12, maxMs: 14 },
    interval: { lastMs: 16, avgMs: 15, p95Ms: 16, maxMs: 17 },
  };
  const cases = [
    ['无基线', evaluatePerf(null, null).code, 2],
    ['有基线无快照', evaluatePerf(null, baseline).code, 2],
    ['快照结构非法（缺 duration）', evaluatePerf({}, baseline).code, 2],
    ['基线结构非法（缺 thresholds）', evaluatePerf(snapshot, {}).code, 2],
    ['样本不足', evaluatePerf({ ...snapshot, frames: 59 }, baseline).code, 2],
    [
      'interval p95 超阈',
      evaluatePerf({ ...snapshot, interval: { ...snapshot.interval, p95Ms: 20 } }, baseline).code,
      1,
    ],
    [
      'duration p95 超阈',
      evaluatePerf({ ...snapshot, duration: { ...snapshot.duration, p95Ms: 25 } }, baseline).code,
      1,
    ],
    ['全达标', evaluatePerf(snapshot, baseline).code, 0],
  ];
  const failed = cases.filter(([, actual, expected]) => actual !== expected);
  for (const [name, actual, expected] of cases) {
    console.error(
      `  ${actual === expected ? '✓' : '✗'} ${name}：exit ${String(actual)}（期望 ${String(expected)}）`,
    );
  }
  return { ok: failed.length === 0, total: cases.length, failed: failed.length };
}

/** 读 JSON 输入（未提供/不存在/非法 → null 并给出原因；解析失败与缺文件同等阻塞）。 */
function loadJsonInput(path, label) {
  if (path === undefined || path === null) return { value: null, reason: '未提供路径' };
  if (!existsSync(path)) return { value: null, reason: `文件不存在：${path}` };
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')), reason: null };
  } catch (error) {
    return { value: null, reason: `${label} 不是合法 JSON：${String(error)}` };
  }
}

/** 落盘证据（与各 verify-* 同口径：字段族对齐验收标准 §4，阻塞也落盘）。 */
function writeEvidence(result, inputs) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = join(
    EVIDENCE_DIR,
    `verify-perf-${new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')}.json`,
  );
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schema: 'df.perf.evidence/v1',
        ticket: 'RW-04',
        gate: 'verify-perf',
        page: '（画布渲染观测通道：帧时长窗口汇总 + 绘制计数）',
        level: 'B（体验层 · 帧时长 p95 判定；M7 剔除率记录性指标随证据留存）',
        baselinePath: inputs.baselinePath,
        snapshotPath: inputs.snapshotPath,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ...result,
        // 观测计数原样留存（M7 = clipped/nodes 的基线讨论材料；不设通过线）
        counters: inputs.snapshot?.stats ?? null,
        // 验收标准 §4 字段族：本门禁只判帧时长，不产截图 → 无像素比对（三项 null + 说明）。
        diff: {
          bbox: null,
          diffPixels: null,
          ratio: null,
          note: '性能门禁：只判帧时长 p95 与样本充分性，不做像素比对（不比图，故无 diff 结论）',
        },
        artifacts: { ref: null, actual: null, diff: null },
        humanReview: {
          verdict: 'pending',
          reviewer: null,
          reason: '性能基线阈值由 dev 机基线轮签字入库（先记录两轮基线，再定优化立项）',
        },
        exitCode: result.code,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return evidencePath;
}

function main() {
  if (selfTestMode) {
    const result = selfTest();
    console.error(
      result.ok
        ? `自测通过：${String(result.total)} 例（辨别力：无基线/无快照/结构非法/样本不足 → 2、超阈 → 1、全对 → 0）`
        : `自测失败：${String(result.failed)}/${String(result.total)} 例`,
    );
    return result.ok ? 0 : 1;
  }

  // 硬自证：每次实跑先验辨别力（无基线/无快照/样本不足 → 2，超阈 → 1，全对 → 0）；
  // 自测失败 = 门禁自身坏了，按违规退出（绝不带着坏门禁去判性能）。
  const gate = selfTest();
  if (!gate.ok) {
    console.error(
      `门禁自测未通过（${String(gate.failed)}/${String(gate.total)} 例）——本门禁此刻不可信。`,
    );
    return 1;
  }

  const baselinePath = resolve(
    flagValue('--baseline') ?? process.env.DF_PERF_BASELINE ?? DEFAULT_BASELINE,
  );
  // 快照未提供时保持 null（不能 resolve('') —— 那会变成 cwd，把「未提供」误报成「非法 JSON」）
  const rawSnapshotPath = flagValue('--snapshot') ?? process.env.DF_PERF_SNAPSHOT ?? '';
  const snapshotPath = rawSnapshotPath === '' ? null : resolve(rawSnapshotPath);
  const baselineInput = loadJsonInput(baselinePath, '基线');
  const snapshotInput = loadJsonInput(snapshotPath, '快照');
  const result = evaluatePerf(snapshotInput.value, baselineInput.value);
  const evidencePath = writeEvidence(result, {
    baselinePath,
    snapshotPath,
    snapshot: snapshotInput.value,
  });

  if (result.code === 2) {
    const reasons = [
      `阻塞：性能观测证据不足——不得据此出任何性能结论（禁假绿）。`,
      `原因：${result.summary}`,
    ];
    if (baselineInput.reason !== null) reasons.push(`基线：${baselineInput.reason}`);
    if (snapshotInput.reason !== null) reasons.push(`快照：${snapshotInput.reason}`);
    reasons.push(`证据：${evidencePath}`);
    reasons.push(
      `待办：dev 机基线轮采集两轮数据后落盘 ${DEFAULT_BASELINE}（阈值入库）；观测采集经 __dforgeCanvas.perf() / stats() 打包为快照 JSON。`,
    );
    console.error(reasons.join('\n'));
    return 2;
  }
  if (result.code === 1) {
    console.error(
      [
        `违规：渲染性能回退（超阈值）——先查渲染回归再谈优化立项。`,
        `明细：${result.summary}`,
        `证据：${evidencePath}`,
      ].join('\n'),
    );
    return 1;
  }
  console.error(`通过：${result.summary}`);
  if (verbose) console.error(`  证据：${evidencePath}`);
  return 0;
}

/**
 * 是否作为主模块直跑。
 *
 * 为什么用 `realpath` 比较而不是 basename 后缀匹配：basename 匹配在**经符号链接调用**时
 * 会判 false（`argv[1]` 是链接名，与真实文件名不同）→ `main()` 整个不执行、进程以 exit 0 结束，
 * 表现为「零校验的假绿」。realpath 把两侧都解析到真实文件再比较，链接调用与直调行为一致。
 */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main());
