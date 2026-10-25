#!/usr/bin/env node
/**
 * verify-perf —— 渲染性能门禁（工单 04 挂点起步 → 工单 14 转正：M1-M7 真链路采集 + 判定）。
 *
 * 「先测后优化」纪律的门禁化（对标报告 §4）：M1 首帧 / M2 交互帧率 / M3 选中→面板延迟 /
 * M4 撤销延迟 / M5 保存往返 / M6 内存峰值 / M7 剔除率。基线回退超阈值 → exit 1。
 *
 * 数据源（全部**同源只读、零 daemon 改动**）：
 *   - `window.__dforgeCanvas.perf()`：帧耗时 + rAF 间隔的环形窗口快照
 *     （apps/web/src/features/canvas/render/frame-perf.ts）——M2 绘制耗时 p95 的判定读点；
 *   - `window.__dforgeCanvas.stats()`：绘制计数——M7 剔除率（clipped/nodesDrawn，记录性）；
 *   - `window.__dforgeCanvas` 其余读点（runtime/geometry/select/createRect/session）——探针支点；
 *   - 页内自埋点探针（rAF 采样器 / 双 rAF 计时）：M1 首帧信号、M2 间隔原始样本（p95/p99）、
 *     M3 选中→Inspector 反映、M4 undo+重绘、M5 save 往返（页面内 dispatch 计时）；
 *   - CDP `HeapProfiler`：M6（startSampling → collectGarbage → getSamplingProfile，
 *     汇总采样树 selfSize，记录性指标）。
 *
 * 真链路（跟随 e2e-smoke 惯例）：确定性文档生成器（packages/engine
 * `createBenchmarkDocument`，注入 IdFactory，同一参数跨机比特一致）经 daemon HTTP API
 * 落盘 → Next 生产构建 + 真 Chromium + 同源网关打开 `/_canvas?doc=`（M3 走 `/editor`
 * ——只有编辑器工作区挂 InspectorPanel）。采集逻辑的可测纯函数全部在本文件导出
 * （nearestRankPercentile / summarizeLatencySamples / computeClipRate /
 * sumSamplingProfileSelfBytes / buildPageBody / evaluatePerf / evaluatePerfRun），
 * I/O（子进程 / fetch / CDP / page.evaluate）只在 main 链路。
 *
 * **引擎生成器的加载前提**：生成器是「零运行时值导入」的叶子 TS 模块（只 `import type`），
 * 普通 node 在 dev 机（≥23.6，默认类型剥离）可直接动态 import；22.6-23.5 需
 * `NODE_OPTIONS=--experimental-strip-types`。加载失败 → 阻塞（exit 2），绝不静默降级。
 * 注意：本文件的**测试**（scripts/tests/verify-perf.test.mjs）不触发该动态 import，
 * 故 CI（node 22）跑 `pnpm test:scripts` 不受影响。
 *
 * 基线模式（`docs/quality/perf-baseline-v1.json`，schema `df.perf.baseline/v1`）：
 *   - `provisional: true`（模板/初始目标值【判断·待校准】）→ 门禁**恒阻塞**；
 *   - dev 机两轮实采（本门禁的 real-chain 证据即采集产物）替换为实测基线并置
 *     `provisional: false` 后，才进入 0/1 判定。
 *
 * 退出码（门禁三态，**禁止假绿**）：
 *   0 = 全部规模档达标；
 *   1 = **违规**——实测超阈值（性能回退）；
 *   2 = **阻塞**——基线缺失/provisional/结构非法、样本不足、采集不完整、
 *       真链路起不来（daemon/构建/Chromium/引擎生成器加载失败）——判不了就是阻塞。
 *   多档聚合口径（与 e2e-smoke 一致）：任一档违规 → 1；否则任一档阻塞 → 2。
 *
 * 证据落盘：`<DF_EVIDENCE_DIR>/perf/<时间戳>/verify-perf-<时间戳>.json`，schema
 * `df.perf.evidence/v1`（阻塞也落盘；每档附生成的页面正文 doc-<size>.json 供复核）。
 *
 * 用法（仓库根执行）：
 *   pnpm verify:perf                                     # 真链路全档（1k/5k/20k）
 *   pnpm verify:perf -- --size 5k                        # 只跑一档
 *   DF_WEB_URL=http://127.0.0.1:3000 pnpm verify:perf    # 站点已在跑，复用
 *   node scripts/verify-perf.mjs --baseline b.json --snapshot s.json   # 离线快照判定（04 模式保留）
 *   node scripts/verify-perf.mjs --self-test             # 自测夹具（验辨别力）
 *
 * 环境变量：DF_PERF_BASELINE（基线 JSON 路径）、DF_PERF_SNAPSHOT（离线快照路径）、
 *           DF_WEB_URL（复用已跑站点）、DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 路径）。
 *           临时数据目录（系统 tmpdir，路径见日志的「数据根」一行）**不自动清理**，
 *           需要复核时按日志路径手动处理（曾经的 DF_E2E_KEEP=1 声明无实现，已删除）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveChromeExecutable } from './lib/browser-toolchain.mjs';
import { freePort, startFixtureDaemon, startSameOriginGateway } from './lib/gates.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const EVIDENCE_DIR = join(EVIDENCE_ROOT, 'perf');
/** 缺省基线入库路径（dev 机基线轮产出入库；provisional 模板态 = 门禁阻塞）。 */
const DEFAULT_BASELINE = join(REPO_ROOT, 'docs', 'quality', 'perf-baseline-v1.json');
const BASELINE_SCHEMA = 'df.perf.baseline/v1';

/** 引擎侧确定性文档生成器（零运行时值导入的叶子 TS 模块——见文件头「加载前提」）。 */
const ENGINE_IDS_MODULE = join(REPO_ROOT, 'packages', 'engine', 'src', 'model', 'ids.ts');
const ENGINE_BENCH_MODULE = join(
  REPO_ROOT,
  'packages',
  'engine',
  'src',
  'testing',
  'benchmark-doc.ts',
);

/** 规模档（对标报告 §4.2：1k / 5k / 20k；与生成器 BENCHMARK_DOC_SIZES 一致）。 */
const BENCH_SIZES = [
  { key: '1k', nodeCount: 1000 },
  { key: '5k', nodeCount: 5000 },
  { key: '20k', nodeCount: 20000 },
];

/**
 * 每档采集计划（对标报告 §4.2 的规模档归属）：
 *   M1/M2 全档必采；M3（选中→面板）/M4（撤销）@5k；M5（保存往返）@5k/20k；
 *   M6（heap）/M7（剔除率）@20k 记录。
 */
const TIER_PLAN = {
  '1k': { m2: true },
  '5k': { m2: true, m3: true, m4: true, m5: true },
  '20k': { m2: true, m5: true, m6: true, m7: true },
};

/** 判定阈值字段（按规模档组织；null = 记录性不设通过线）。 */
const JUDGED_THRESHOLD_FIELDS = [
  'm1FirstFrameMs',
  'm2IntervalP95Ms',
  'm2DurationP95Ms',
  'm3SelectPanelMs',
  'm4UndoMs',
  'm5SaveRoundTripMs',
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const selfTestMode = args.includes('--self-test');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

// ---------------------------------------------------------------------------
// 纯函数区（判定与采集计算；全部可测，scripts/tests/verify-perf.test.mjs 覆盖）
// ---------------------------------------------------------------------------

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

/** 基线结构校验（schema v1：规模档阈值 + provisional 两态；判不了就是阻塞，缺项即报）。 */
export function validateBaseline(baseline) {
  const problems = [];
  if (baseline === null || typeof baseline !== 'object') {
    return ['性能基线不是对象'];
  }
  if (baseline.schema !== BASELINE_SCHEMA) {
    problems.push(`基线 schema 应为 ${BASELINE_SCHEMA}（实测 ${String(baseline.schema)}）`);
  }
  if (typeof baseline.provisional !== 'boolean') {
    problems.push(
      'provisional 必须是布尔（true=模板/待校准态→门禁阻塞；false=dev 机实测入库）——' +
        `实测 ${String(baseline.provisional)}`,
    );
  }
  const thresholds = baseline.thresholds;
  if (thresholds === null || typeof thresholds !== 'object') {
    problems.push('缺 thresholds（必须按规模档组织，如 1k/5k/20k）');
  } else {
    const sizes = Object.keys(thresholds);
    if (sizes.length === 0) {
      problems.push('thresholds 未按规模档组织（档位键缺失）');
    }
    for (const size of sizes) {
      const tier = thresholds[size];
      if (tier === null || typeof tier !== 'object') {
        problems.push(`thresholds.${size} 必须是阈值对象`);
        continue;
      }
      for (const field of JUDGED_THRESHOLD_FIELDS) {
        const value = tier[field];
        if (value === null) continue; // 记录性：该档不设通过线
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          problems.push(
            `thresholds.${size}.${field} 必须是正数或 null（null=记录不设线；实测 ${String(value)}）`,
          );
        }
      }
    }
  }
  const minFrames = baseline.minFrames;
  if (minFrames !== undefined && (typeof minFrames !== 'number' || minFrames < 0)) {
    problems.push(`minFrames 必须是非负数（实测 ${String(minFrames)}）`);
  }
  if (baseline.minSamples !== undefined) {
    const minSamples = baseline.minSamples;
    if (minSamples === null || typeof minSamples !== 'object') {
      problems.push('minSamples 必须是对象（各指标族的最小样本数）');
    } else {
      for (const [key, value] of Object.entries(minSamples)) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          problems.push(`minSamples.${key} 必须是非负整数（实测 ${String(value)}）`);
        }
      }
    }
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

/** 有限正数判定（采集读数的完整性口径：缺失/非法一律不算数，禁拿 0 或 NaN 冒充）。 */
function isPositiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 判定一份性能快照（纯函数，供 CLI 与自测共用）。不写证据、不退出——由调用方决定出口。
 *
 * 工单 14 扩展：阈值按规模档查找（`baseline.thresholds[size]`，缺省 5k 档）；
 * `provisional: true` 的基线恒阻塞（模板态禁判性能）。
 *
 * @param {object|null} snapshot `__dforgeCanvas.perf()` 快照（结构见 validateSnapshot）
 * @param {object|null} baseline 性能基线（结构见 validateBaseline）
 * @param {{ size?: string }} [options] 规模档（决定查哪份阈值；缺省 '5k'）
 * @returns {{ code: 0|1|2, summary: string, problems: string[], violations: string[], metrics: object|null }}
 */
export function evaluatePerf(snapshot, baseline, options) {
  const { size = '5k' } = options ?? {};
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
  if (baseline.provisional === true) {
    return blocked(
      '性能基线为 provisional（模板/待校准态）——dev 机两轮实采替换为实测基线（provisional:false）后才进入 0/1 判定；禁拿未校准阈值判性能',
      [],
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
  const thresholds = baseline.thresholds[size];
  if (thresholds === null || thresholds === undefined || typeof thresholds !== 'object') {
    return blocked(`基线未含规模档 ${size} 的阈值——判不了（禁拿缺口阈值判性能）`, [], null);
  }

  const minFrames = baseline.minFrames ?? 0;
  const metrics = {
    frames: snapshot.frames,
    intervalP95Ms: snapshot.interval.p95Ms,
    durationP95Ms: snapshot.duration.p95Ms,
    threshold: {
      intervalP95Ms: thresholds.m2IntervalP95Ms,
      durationP95Ms: thresholds.m2DurationP95Ms,
    },
  };
  if (snapshot.frames < minFrames) {
    return blocked(
      `样本不足（frames=${String(snapshot.frames)} < minFrames=${String(minFrames)}）——窗口未攒够，判不了（禁拿不足样本下结论）`,
      [],
      metrics,
    );
  }

  const violations = [];
  // 窗口为空（p95 = null）而阈值有值：判不了就是阻塞，绝不当作「≤ 阈值」假通过。
  if (
    typeof thresholds.m2IntervalP95Ms === 'number' &&
    !isPositiveFinite(snapshot.interval.p95Ms)
  ) {
    return blocked('perf() 快照无有效 interval p95（窗口为空或未接帧计时）——判不了就是阻塞', [], metrics);
  }
  if (
    typeof thresholds.m2DurationP95Ms === 'number' &&
    !isPositiveFinite(snapshot.duration.p95Ms)
  ) {
    return blocked('perf() 快照无有效 duration p95（窗口为空或未接帧计时）——判不了就是阻塞', [], metrics);
  }
  if (
    typeof thresholds.m2IntervalP95Ms === 'number' &&
    snapshot.interval.p95Ms > thresholds.m2IntervalP95Ms
  ) {
    violations.push(
      `interval.p95Ms ${snapshot.interval.p95Ms}ms > 阈值 ${thresholds.m2IntervalP95Ms}ms（M2 交互帧率回退）`,
    );
  }
  if (
    typeof thresholds.m2DurationP95Ms === 'number' &&
    snapshot.duration.p95Ms > thresholds.m2DurationP95Ms
  ) {
    violations.push(
      `duration.p95Ms ${snapshot.duration.p95Ms}ms > 阈值 ${thresholds.m2DurationP95Ms}ms（绘制耗时回退）`,
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
      `达标：interval p95 ${snapshot.interval.p95Ms}ms ≤ ${String(thresholds.m2IntervalP95Ms)}ms；` +
      `duration p95 ${snapshot.duration.p95Ms}ms ≤ ${String(thresholds.m2DurationP95Ms)}ms（${framesNote}）`,
    problems: [],
    violations: [],
    metrics,
  };
}

/**
 * 判定一次全量运行采集包（纯函数；真链路采集器的归一产物 → 三态结论）。
 *
 * 判定面：M1 首帧 / M2 间隔 p95（页内采样）+ 绘制耗时 p95（perf() 环形窗口）/
 * M3 选中→面板 / M4 撤销 / M5 保存往返——按 `baseline.thresholds[run.size]` 判定；
 * M6 heap / M7 剔除率为**记录性指标**（无通过线，随证据留存）。
 * 阈值为 null 的指标只记录不判违规；判定档指标缺失或样本不足 → 阻塞（禁假绿）。
 *
 * @param {object|null} run 采集包 { size, nodeCount, m1, m2, m2Window, m3, m4, m5, m6, m7 }
 * @param {object|null} baseline 性能基线（结构见 validateBaseline）
 * @returns {{ code: 0|1|2, summary: string, problems: string[], violations: string[], metrics: object|null }}
 */
export function evaluatePerfRun(run, baseline) {
  if (baseline === null || baseline === undefined) {
    return blocked('无性能基线（基线未入库）——不得据此下任何性能结论', [], null);
  }
  if (run === null || run === undefined || typeof run !== 'object') {
    return blocked('无运行采集包（真链路采集未产出）——判不了就是阻塞', [], null);
  }
  const baselineProblems = validateBaseline(baseline);
  if (baselineProblems.length > 0) {
    return blocked(
      `基线结构非法（${baselineProblems.length} 项）：${baselineProblems.join('；')}`,
      baselineProblems,
      null,
    );
  }
  if (baseline.provisional === true) {
    return blocked(
      '性能基线为 provisional（模板/待校准态）——dev 机两轮实采替换为实测基线（provisional:false）后才进入 0/1 判定；禁拿未校准阈值判性能',
      [],
      null,
    );
  }
  const thresholds = baseline.thresholds[run.size];
  if (thresholds === null || thresholds === undefined || typeof thresholds !== 'object') {
    return blocked(`基线未含规模档 ${String(run.size)} 的阈值——判不了（禁拿缺口阈值判性能）`, [], null);
  }

  const metrics = {
    size: run.size,
    nodeCount: run.nodeCount ?? null,
    threshold: thresholds,
  };

  // M2 通道证据（perf() 环形窗口）：缺失/结构非法/样本不足都是阻塞——通道没接等于没测。
  const windowProblems = validateSnapshot(run.m2Window);
  if (windowProblems.length > 0) {
    return blocked(
      `perf() 环形窗口缺失或结构非法（${windowProblems.length} 项）：${windowProblems.join('；')}`,
      windowProblems,
      metrics,
    );
  }
  const minFrames = baseline.minFrames ?? 0;
  if (run.m2Window.frames < minFrames) {
    return blocked(
      `样本不足（frames=${String(run.m2Window.frames)} < minFrames=${String(minFrames)}）——窗口未攒够，判不了`,
      [],
      metrics,
    );
  }
  metrics.m2DurationP95Ms = run.m2Window.duration.p95Ms;

  // 窗口为空（p95 = null）而阈值有值：判不了就是阻塞，绝不当作「≤ 阈值」假通过。
  if (
    typeof thresholds.m2IntervalP95Ms === 'number' &&
    !isPositiveFinite(run.m2Window.interval.p95Ms)
  ) {
    return blocked('perf() 环形窗口无有效 interval p95（窗口为空或未接帧计时）——判不了就是阻塞', [], metrics);
  }
  if (
    typeof thresholds.m2DurationP95Ms === 'number' &&
    !isPositiveFinite(run.m2Window.duration.p95Ms)
  ) {
    return blocked('perf() 环形窗口无有效 duration p95（窗口为空或未接帧计时）——判不了就是阻塞', [], metrics);
  }

  // M1 首帧（必采指标）。
  const m1 = run.m1?.firstFrameMs;
  if (!isPositiveFinite(m1)) {
    return blocked('M1 首帧未采到（采集不完整）——判不了就是阻塞', [], metrics);
  }
  metrics.m1FirstFrameMs = m1;
  metrics.m1FcpMs = run.m1?.fcpMs ?? null;

  // M2 间隔样本（页内 rAF 探针）。
  const minM2Interval = baseline.minSamples?.m2Interval ?? 0;
  const m2IntervalSamples = run.m2?.intervalSamples ?? 0;
  if (m2IntervalSamples < minM2Interval) {
    return blocked(
      `样本不足（M2 交互间隔 samples=${String(m2IntervalSamples)} < minSamples.m2Interval=${String(minM2Interval)}）——交互窗口未攒够`,
      [],
      metrics,
    );
  }
  const m2IntervalP95 = run.m2?.intervalP95Ms;
  if (!isPositiveFinite(m2IntervalP95)) {
    return blocked('M2 交互间隔 p95 未采到（采集不完整）——判不了就是阻塞', [], metrics);
  }
  metrics.m2IntervalP95Ms = m2IntervalP95;
  metrics.m2IntervalP99Ms = run.m2?.intervalP99Ms ?? null;

  // 判定档指标（M3/M4/M5）：阈值 null → 只记录；阈值有值 → 缺失/样本不足都是阻塞。
  /** @type {Array<[string, string, string, {p95Ms?: unknown, samples?: unknown}|null|undefined]>} */
  const judgedMetrics = [
    ['m3', 'm3SelectPanelMs', 'm3SelectPanelP95Ms', run.m3],
    ['m4', 'm4UndoMs', 'm4UndoP95Ms', run.m4],
    ['m5', 'm5SaveRoundTripMs', 'm5SaveRoundTripP95Ms', run.m5],
  ];
  for (const [family, thresholdKey, metricKey, reading] of judgedMetrics) {
    const threshold = thresholds[thresholdKey];
    const p95 = reading !== null && reading !== undefined ? reading.p95Ms : undefined;
    metrics[metricKey] = isPositiveFinite(p95) ? p95 : null;
    if (threshold === null || threshold === undefined) continue; // 记录性档
    if (!isPositiveFinite(p95)) {
      return blocked(`${family}（${thresholdKey}）为判定档但未采集到有效 p95——采集不完整`, [], metrics);
    }
    const min = baseline.minSamples?.[family] ?? 0;
    const samples = reading?.samples ?? 0;
    if (samples < min) {
      return blocked(
        `样本不足（${family} samples=${String(samples)} < minSamples.${family}=${String(min)}）——判不了`,
        [],
        metrics,
      );
    }
  }

  // 记录性指标（无通过线，随证据留存）。
  metrics.m6HeapSampledBytes = isPositiveFinite(run.m6?.sampledBytes) ? run.m6.sampledBytes : null;
  metrics.m7ClipRate = typeof run.m7?.rate === 'number' && Number.isFinite(run.m7.rate)
    ? run.m7.rate
    : null;

  // 违规判定（阈值 null 一律跳过）。
  const violations = [];
  const judge = (label, value, threshold) => {
    if (typeof threshold !== 'number') return; // 记录性
    if (value > threshold) {
      violations.push(`${label} ${value}ms > 阈值 ${threshold}ms（@${run.size}）`);
    }
  };
  judge('m1FirstFrameMs', m1, thresholds.m1FirstFrameMs);
  judge('m2IntervalP95Ms', m2IntervalP95, thresholds.m2IntervalP95Ms);
  judge('duration.p95Ms', run.m2Window.duration.p95Ms, thresholds.m2DurationP95Ms);
  for (const [, thresholdKey, metricKey] of judgedMetrics) {
    judge(thresholdKey, metrics[metricKey], thresholds[thresholdKey]);
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
  return {
    code: 0,
    summary: `达标（@${String(run.size)}）：M1 ${String(m1)}ms、M2 间隔 p95 ${String(m2IntervalP95)}ms / 绘制 p95 ${String(run.m2Window.duration.p95Ms)}ms、M3 ${String(metrics.m3SelectPanelP95Ms)}ms、M4 ${String(metrics.m4UndoP95Ms)}ms、M5 ${String(metrics.m5SaveRoundTripP95Ms)}ms（null=该档记录性不设线）`,
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
 * 分位数（最近秩法：升序第 ceil(p·n) 小，1 基，不插值）。
 * 与 frame-perf.ts 的 p95 口径一致（门禁复核口径确定）；空样本/全非有限值 → null。
 */
export function nearestRankPercentile(samples, p) {
  const clean = samples.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * 延迟样本一次算齐（count/p50/p95/p99/max；非有限值剔除——探针偶发 NaN 不得污染分布）。
 * 空样本 → 全 null（「没采到」与 0 是两回事）。
 */
export function summarizeLatencySamples(samples) {
  const clean = Array.isArray(samples) ? samples : [];
  const finite = clean.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    count: finite.length,
    p50Ms: nearestRankPercentile(finite, 0.5),
    p95Ms: nearestRankPercentile(finite, 0.95),
    p99Ms: nearestRankPercentile(finite, 0.99),
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * M7 剔除率（clipped/nodesDrawn；记录性指标，不设通过线）。
 *
 * **语义登记（工单 14 实现取舍）**：渲染计数器（draw-scene.ts）的 `clipped` 是
 * 「应用了 clipsContent 裁剪的画板数」，`nodesDrawn`（counters.nodes）是「实际绘制节点数」
 * （opacity=0 不计——口径变更登记见 draw-scene.ts 头注释与 perf-baseline-v1.json M7 注记）——
 * 当前渲染循环**没有视口剔除**（这正是 E-7 空间索引要立的项），故本比例现阶段衡量的是
 * 裁剪画板频度，不是「视口外剔除率」。门禁照报告 §4.2 公式记录原值，
 * 语义以本注释 + 证据字段为准，供基线讨论（先测后优化：测的就是现状）。
 * 无访问（nodesDrawn ≤ 0）或字段缺失 → null（禁拿 0 冒充「没有剔除」）。
 */
export function computeClipRate(stats) {
  const nodesDrawn = stats?.nodesDrawn;
  const clipped = stats?.clipped;
  if (!isPositiveFinite(nodesDrawn)) return null;
  if (typeof clipped !== 'number' || !Number.isFinite(clipped) || clipped < 0) return null;
  return {
    rate: clipped / nodesDrawn,
    nodesDrawn,
    clipped,
    textRuns:
      typeof stats.textRuns === 'number' && Number.isFinite(stats.textRuns)
        ? stats.textRuns
        : null,
  };
}

/**
 * M6：汇总 CDP `HeapProfiler.getSamplingProfile` 采样树的 selfSize（自用字节）。
 * samples 列是分配事件（size/count），不计入存活堆；profile 缺失 → 0（调用方决定是否记录）。
 */
export function sumSamplingProfileSelfBytes(profile) {
  const head = profile?.head;
  if (head === null || typeof head !== 'object') return 0;
  let total = 0;
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (typeof node.selfSize === 'number' && Number.isFinite(node.selfSize)) total += node.selfSize;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(head);
  return total;
}

/**
 * 设计页 → daemon 页面正文信封（与 apps/web documents-client 的 encodePageBody 同形：
 * `{ $format: 'dforge.canvas.page', $version: 1, page, tokens }`——daemon 只做 opaque 存储，
 * 载入端按此信封解码。生成的文档对象直入信封，两次构建逐字节一致）。
 */
export function buildPageBody(document) {
  const page = document?.pages?.[0];
  if (page === null || page === undefined || typeof page !== 'object') {
    throw new Error('文档缺少页面（无法编码页面正文信封）');
  }
  return {
    $format: 'dforge.canvas.page',
    $version: 1,
    page,
    tokens: document.tokens ?? {},
  };
}

// ---------------------------------------------------------------------------
// 自测（辨别力证明：无基线/provisional/无快照/结构非法/样本不足 → 2；超阈 → 1；全对 → 0）
// ---------------------------------------------------------------------------

/**
 * 自测夹具（evaluatePerf / evaluatePerfRun / 采集纯函数都是纯函数，夹具直接用字面量）。
 */
export function selfTest() {
  const baseline = {
    schema: BASELINE_SCHEMA,
    provisional: false,
    thresholds: {
      '5k': {
        m1FirstFrameMs: 1500,
        m2IntervalP95Ms: 16.7,
        m2DurationP95Ms: 16.7,
        m3SelectPanelMs: 100,
        m4UndoMs: 50,
        m5SaveRoundTripMs: 300,
      },
      '20k': {
        m1FirstFrameMs: null,
        m2IntervalP95Ms: null,
        m2DurationP95Ms: null,
        m3SelectPanelMs: null,
        m4UndoMs: null,
        m5SaveRoundTripMs: null,
      },
    },
    minFrames: 60,
    minSamples: { m2Interval: 60, m3: 4, m4: 4, m5: 3 },
  };
  const snapshot = {
    version: 1,
    frames: 120,
    windowSize: 240,
    duration: { lastMs: 10, avgMs: 9, p95Ms: 12, maxMs: 14 },
    interval: { lastMs: 16, avgMs: 15, p95Ms: 16, maxMs: 17 },
  };
  const run = {
    size: '5k',
    nodeCount: 5000,
    m1: { firstFrameMs: 1200, fcpMs: 900 },
    m2: { intervalP95Ms: 15, intervalP99Ms: 17, intervalSamples: 120 },
    m2Window: snapshot,
    m3: { p95Ms: 60, samples: 8 },
    m4: { p95Ms: 30, samples: 8 },
    m5: { p95Ms: 200, samples: 3 },
    m6: null,
    m7: null,
  };
  const run20k = {
    ...run,
    size: '20k',
    nodeCount: 20000,
    m3: null,
    m4: null,
  };
  const cases = [
    ['无基线', evaluatePerf(null, null).code, 2],
    ['有基线无快照', evaluatePerf(null, baseline).code, 2],
    ['快照结构非法（缺 duration）', evaluatePerf({}, baseline).code, 2],
    ['基线结构非法（扁平旧形）', evaluatePerf(snapshot, { thresholds: {} }).code, 2],
    ['基线 provisional（模板态）', evaluatePerf(snapshot, { ...baseline, provisional: true }).code, 2],
    ['样本不足（窗口帧数）', evaluatePerf({ ...snapshot, frames: 59 }, baseline).code, 2],
    [
      'interval p95 超阈',
      evaluatePerf({ ...snapshot, interval: { ...snapshot.interval, p95Ms: 20 } }, baseline).code,
      1,
    ],
    ['全达标（快照判定）', evaluatePerf(snapshot, baseline).code, 0],
    ['运行包全达标', evaluatePerfRun(run, baseline).code, 0],
    ['运行包 provisional', evaluatePerfRun(run, { ...baseline, provisional: true }).code, 2],
    [
      '运行包 M1 超阈',
      evaluatePerfRun({ ...run, m1: { firstFrameMs: 5000, fcpMs: 900 } }, baseline).code,
      1,
    ],
    ['运行包窗口缺失', evaluatePerfRun({ ...run, m2Window: null }, baseline).code, 2],
    [
      '运行包 M2 样本不足',
      evaluatePerfRun(
        { ...run, m2: { intervalP95Ms: 15, intervalP99Ms: 17, intervalSamples: 10 } },
        baseline,
      ).code,
      2,
    ],
    ['20k 记录档不判违规', evaluatePerfRun(run20k, baseline).code, 0],
    ['p95 最近秩（4 样本第 4 小）', nearestRankPercentile([4, 1, 3, 2], 0.95), 4],
    ['剔除率（clipped/nodesDrawn）', computeClipRate({ nodesDrawn: 800, clipped: 200 }).rate, 0.25],
    [
      'heap 采样树汇总',
      sumSamplingProfileSelfBytes({
        head: { selfSize: 100, children: [{ selfSize: 100, children: [] }] },
      }),
      200,
    ],
  ];
  const failed = cases.filter(([, actual, expected]) => actual !== expected);
  for (const [name, actual, expected] of cases) {
    console.error(
      `  ${actual === expected ? '✓' : '✗'} ${name}：exit ${String(actual)}（期望 ${String(expected)}）`,
    );
  }
  return { ok: failed.length === 0, total: cases.length, failed: failed.length };
}

// ---------------------------------------------------------------------------
// I/O 区（读输入 / 证据落盘 / 真链路子进程 / daemon HTTP / 页内探针）
// ---------------------------------------------------------------------------

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

/** 落盘证据（字段族对齐验收标准 §4：阻塞也落盘；不做像素比对 → diff 三项 null + 说明）。 */
function writeEvidence(evidence, runDir) {
  mkdirSync(runDir, { recursive: true });
  const evidencePath = join(runDir, `verify-perf-${evidence.stamp}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidencePath;
}

/** 构建前置：CanvasKit 运行时资产就位（public/canvaskit 是生成物不入库；同 e2e-smoke 口径）。 */
function ensureCanvasKitAssets() {
  const script = join(REPO_ROOT, 'apps/web/src/features/canvas/tools/copy-canvaskit-assets.mjs');
  if (!existsSync(script)) {
    log('CanvasKit 资产脚本不存在（跳过准备；编辑器页会因此失败）');
    return false;
  }
  const result = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status === 0) {
    log(result.stdout.trim());
    return true;
  }
  console.error(`CanvasKit 资产准备失败：${result.stderr ?? String(result.error)}`);
  return false;
}

/** 轮询 HTTP 直到 200（或超时）。 */
async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未发起请求';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  log(`${label} 等待超时（${lastError}）`);
  return false;
}

/** 向 stdout 打一行（带前缀，便于从日志里区分子进程输出）。 */
function log(message) {
  console.log(`[verify-perf] ${message}`);
}

// ---------------------------------------------------------------------------
// 真链路子进程登记与清理（任何退出路径都不得留残留进程；同 e2e-smoke 纪律）
// ---------------------------------------------------------------------------

const children = new Set();
let webServer = null;
let gateway = null;
let browser = null;
let fixtureDaemon = null;

function track(child) {
  if (child === null || child === undefined) return child;
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

process.on('exit', () => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
  }
});

/** 结束 daemon / 站点 / 网关 / 浏览器（幂等）。 */
async function shutdown() {
  await gateway?.close().catch(() => undefined);
  gateway = null;
  await browser?.close().catch(() => undefined);
  browser = null;
  const running = [...children];
  for (const child of running) child.kill('SIGTERM');
  await Promise.all(
    running.map(
      (child) =>
        new Promise((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
          const timer = setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // 已退出
            }
            done();
          }, 5000);
          child.on('exit', () => {
            clearTimeout(timer);
            done();
          });
        }),
    ),
  );
  await fixtureDaemon?.close().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// 引擎生成器动态加载（叶子 TS 模块；node ≥23.6 默认类型剥离，详见文件头「加载前提」）
// ---------------------------------------------------------------------------

async function loadEngineFixtureModules() {
  try {
    const ids = await import(pathToFileURL(ENGINE_IDS_MODULE).href);
    const bench = await import(pathToFileURL(ENGINE_BENCH_MODULE).href);
    if (
      typeof ids.createIdFactory !== 'function' ||
      typeof bench.createBenchmarkDocument !== 'function'
    ) {
      return { ok: false, error: '生成器模块缺少 createIdFactory / createBenchmarkDocument 导出' };
    }
    return {
      ok: true,
      createIdFactory: ids.createIdFactory,
      createBenchmarkDocument: bench.createBenchmarkDocument,
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// ---------------------------------------------------------------------------
// daemon HTTP 客户端（文档注入：create → 页面正文 PUT；信封 {ok, result|error}）
// ---------------------------------------------------------------------------

/** 统一请求：非 2xx 或 ok:false → { ok:false, error }（带上 daemon 的错误码与人话）。 */
async function daemonRequest(daemonUrl, method, path, body) {
  const response = await fetch(`${daemonUrl.replace(/\/$/, '')}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let envelope = null;
  try {
    envelope = text.length === 0 ? null : JSON.parse(text);
  } catch {
    return { ok: false, error: `响应不是合法 JSON（HTTP ${String(response.status)}）` };
  }
  if (!response.ok || envelope?.ok === false) {
    const code = envelope?.error?.code ?? envelope?.code;
    const message = envelope?.error?.message ?? envelope?.message;
    return {
      ok: false,
      error: `${code ?? `HTTP ${String(response.status)}`}${message === undefined ? '' : `：${message}`}`,
    };
  }
  return { ok: true, result: envelope?.result };
}

async function daemonCreateDocument(daemonUrl, name) {
  const created = await daemonRequest(daemonUrl, 'POST', '/documents', { name });
  if (!created.ok) return created;
  const document = created.result?.document;
  if (document === null || document === undefined || typeof document.id !== 'string') {
    return { ok: false, error: 'daemon 创建文档响应缺少 document.id' };
  }
  return { ok: true, documentId: document.id };
}

/**
 * 落盘页面正文：先 PUT `page-1`（daemon 的页面分配规则 page-{N}）；
 * 页面不存在时按客户端同款回退——POST 建页再 PUT（saveDesignDocument 的口径）。
 */
async function daemonSavePage(daemonUrl, documentId, pageId, pageBody) {
  const saved = await daemonRequest(
    daemonUrl,
    'PUT',
    `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(pageId)}`,
    { body: pageBody },
  );
  if (saved.ok) return saved;
  const created = await daemonRequest(
    daemonUrl,
    'POST',
    `/documents/${encodeURIComponent(documentId)}/pages`,
    { name: '页面 1' },
  );
  if (!created.ok) return created;
  const createdPageId = created.result?.page?.id;
  if (typeof createdPageId !== 'string') return { ok: false, error: 'daemon 创建页面响应缺少 page.id' };
  return daemonRequest(
    daemonUrl,
    'PUT',
    `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(createdPageId)}`,
    { body: pageBody },
  );
}

// ---------------------------------------------------------------------------
// 页内探针（自包含函数体，经 page.evaluate 注入；「页面内 dispatch 计时」口径）
// ---------------------------------------------------------------------------

/** M1 辅助读数：FCP（PerformanceObserver，buffered 补发；不可用则无此辅助读数）。 */
const INSTALL_FCP_OBSERVER = () => {
  globalThis.__dforgePerfFcp = null;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') globalThis.__dforgePerfFcp = entry.startTime;
      }
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // paint 类型不可用（非常老内核）：无 FCP 辅助读数，M1 以首帧信号为准
  }
};

/** M1 首帧信号：文档内容已进入画面（目标节点几何可读）——「打开 N 节点文档 → 首个有效绘制帧」。 */
const DOC_FIRST_FRAME_SIGNAL = (nodeId) => {
  const handle = globalThis.__dforgeCanvas;
  if (handle === undefined) return false;
  const geometry = handle.geometry(nodeId);
  return geometry !== null && geometry !== undefined;
};

/** M2 采样器安装：自驱 rAF 链记录帧间隔原始样本（采集期持续；不逐帧上行，只在结束取回数组）。 */
const INSTALL_PERF_SAMPLER = () => {
  const state = { intervals: [], lastMs: null, active: true };
  globalThis.__dforgePerfSampler = state;
  const tick = (timestamp) => {
    if (state === null || !state.active) return;
    if (state.lastMs !== null && typeof timestamp === 'number') {
      state.intervals.push(timestamp - state.lastMs);
    }
    state.lastMs = timestamp;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/** M2 采样器停止：取回间隔样本数组（页内样本在 Node 侧走 summarizeLatencySamples 纯函数）。 */
const STOP_PERF_SAMPLER = () => {
  const state = globalThis.__dforgePerfSampler;
  if (state === null || state === undefined) return [];
  state.active = false;
  return state.intervals;
};

/**
 * M3 选中→面板延迟探针：取消选中 → 等回空选态（canvas-settings）→ 计时 select()
 * → rAF 轮询到 Inspector 反映选中（`data-df-inspector="panel"`）→ 双 rAF（paint 完成）→ 返回毫秒。
 */
const SELECT_PANEL_PROBE = async (targetId) => {
  const handle = globalThis.__dforgeCanvas;
  if (handle === undefined) throw new Error('调试句柄未挂载');
  const raf = () => new Promise((done) => requestAnimationFrame(done));
  handle.select([]);
  const settleDeadline = performance.now() + 2000;
  for (;;) {
    await raf();
    if (document.querySelector('[data-df-inspector="panel"]') === null) break;
    if (performance.now() > settleDeadline) throw new Error('取消选中未在 2s 内回到空选态');
  }
  const start = performance.now();
  handle.select([targetId]);
  for (;;) {
    await raf();
    if (document.querySelector('[data-df-inspector="panel"]') !== null) break;
    if (performance.now() - start > 2000) throw new Error('Inspector 未在 2s 内反映选中');
  }
  await raf();
  await raf();
  return performance.now() - start;
};

/**
 * M4 撤销延迟探针：createRect（造一个可撤销变更，等它进帧）→ 计时 session.undo()
 * → 双 rAF（重绘完成）→ 返回毫秒。每次探针净效果为零（建了又撤）。
 */
const UNDO_PROBE = async (bounds) => {
  const handle = globalThis.__dforgeCanvas;
  if (handle === undefined) throw new Error('调试句柄未挂载');
  const raf = () => new Promise((done) => requestAnimationFrame(done));
  handle.createRect(bounds);
  await raf();
  await raf();
  const start = performance.now();
  handle.session().undo();
  await raf();
  await raf();
  return performance.now() - start;
};

/** M5 保存往返探针：计时 `__dforgeCanvas.save()`（客户端发起 → daemon `.dfg` 原子写 → 响应）。 */
const SAVE_PROBE = async () => {
  const handle = globalThis.__dforgeCanvas;
  if (handle === undefined) throw new Error('调试句柄未挂载');
  const start = performance.now();
  const result = await handle.save();
  return {
    ms: performance.now() - start,
    ok: result !== null && result !== undefined && result.ok === true,
    error: result !== null && result !== undefined ? (result.error ?? null) : '无结果',
  };
};

/** M7 读数前置：把视口设到确定性原点（zoom 1 / pan 0），等三帧让统计稳定，返回 stats()。 */
const READ_STATS_AT_ORIGIN = async () => {
  const handle = globalThis.__dforgeCanvas;
  if (handle === undefined) return null;
  handle.setViewport({ zoom: 1, panX: 0, panY: 0 });
  const raf = () => new Promise((done) => requestAnimationFrame(done));
  await raf();
  await raf();
  await raf();
  return handle.stats();
};

// ---------------------------------------------------------------------------
// 每档采集（真链路：daemon 文档 → 生产站点页 → 探针；异常上抛由调用方按阻塞处理）
// ---------------------------------------------------------------------------

/**
 * 采集一个规模档，返回 { run, steps }。run 为 evaluatePerfRun 的采集包；steps 为证据步骤。
 * I/O 全在此处；数值归一全部走纯函数（summarizeLatencySamples / computeClipRate /
 * sumSamplingProfileSelfBytes）。
 */
async function collectTier(browser, options) {
  const { size, nodeCount, documentId, firstNodeId, gatewayUrl, log: tierLog } = options;
  const wants = TIER_PLAN[size] ?? {};
  const steps = [];
  const studioUrl =
    `${gatewayUrl}/_canvas?daemon=${encodeURIComponent(`${gatewayUrl}/df`)}` +
    `&doc=${encodeURIComponent(documentId)}`;
  const editorUrl =
    `${gatewayUrl}/editor?daemon=${encodeURIComponent(`${gatewayUrl}/df`)}` +
    `&documentId=${encodeURIComponent(documentId)}`;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // FCP 辅助读数 + M6 采样要赶在文档装载之前就位（捕捉装载期分配）。
  await page.evaluateOnNewDocument(INSTALL_FCP_OBSERVER);
  let cdp = null;
  if (wants.m6 === true) {
    try {
      cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
      steps.push({ name: 'M6 · CDP HeapProfiler 采样启动', status: 'pass' });
    } catch (error) {
      cdp = null;
      steps.push({
        name: 'M6 · CDP HeapProfiler 采样启动',
        status: 'blocked',
        detail: String(error).slice(0, 200),
      });
    }
  }

  // --- M1：打开生成文档 → 首个有效绘制帧 ---
  const t0 = Date.now();
  await page.goto(studioUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
  await page.waitForFunction(
    () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForFunction(DOC_FIRST_FRAME_SIGNAL, firstNodeId, { timeout: 120_000 });
  const m1FirstFrameMs = Date.now() - t0;
  const fcpMs = await page.evaluate(() => globalThis.__dforgePerfFcp).catch(() => null);
  steps.push({
    name: 'M1 · 打开文档 → 首个有效绘制帧',
    status: 'pass',
    detail: `${String(m1FirstFrameMs)}ms（FCP ${fcpMs === null || fcpMs === undefined ? 'n/a' : `${String(Math.round(fcpMs))}ms`}）`,
  });
  tierLog(`M1 首帧 ${String(m1FirstFrameMs)}ms`);

  // --- M2：交互期 rAF 采样（拖拽 + 滚轮手势）→ perf() 环形窗口 ---
  await page.evaluate(INSTALL_PERF_SAMPLER);
  const canvas = page.locator('canvas[data-df-canvas]');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('画布元素无几何（boundingBox 为空）');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX - box.width * 0.2, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + box.width * 0.2, centerY, { steps: 16 });
  await page.mouse.up();
  await page.mouse.move(centerX + box.width * 0.2, centerY - box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(centerX - box.width * 0.2, centerY + box.height * 0.1, { steps: 24 });
  await page.mouse.up();
  for (const deltaY of [-240, -240, -240, 240, 240, 240, -180, 180, -120, 120]) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(60);
  }
  const intervalSamples = await page.evaluate(STOP_PERF_SAMPLER);
  const intervalSummary = summarizeLatencySamples(intervalSamples);
  const perfWindow = await page.evaluate(() => {
    const handle = globalThis.__dforgeCanvas;
    return handle === undefined ? null : handle.perf();
  });
  steps.push({
    name: 'M2 · 交互帧率采样（拖拽×2 + 滚轮×10）',
    status: intervalSummary.count > 0 ? 'pass' : 'blocked',
    detail: `间隔样本 ${String(intervalSummary.count)} 个，p95 ${String(intervalSummary.p95Ms)}ms / p99 ${String(intervalSummary.p99Ms)}ms`,
  });
  tierLog(
    `M2 间隔 p95 ${String(intervalSummary.p95Ms)}ms / p99 ${String(intervalSummary.p99Ms)}ms（样本 ${String(intervalSummary.count)}）`,
  );

  // --- M3：选中→面板延迟（编辑器工作区；只有 /editor 挂 InspectorPanel） ---
  let m3 = null;
  if (wants.m3 === true) {
    const editorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const editorPage = await editorContext.newPage();
    const editorErrors = [];
    editorPage.on('pageerror', (error) => editorErrors.push(String(error)));
    try {
      await editorPage.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await editorPage.waitForSelector('canvas[data-df-canvas]', { timeout: 60_000 });
      await editorPage.waitForFunction(
        () => globalThis.__dforgeCanvas?.runtime().canvasKit === 'ready',
        undefined,
        { timeout: 120_000 },
      );
      await editorPage.waitForFunction(DOC_FIRST_FRAME_SIGNAL, firstNodeId, { timeout: 120_000 });
      const latencies = [];
      for (let index = 0; index < 8; index += 1) {
        latencies.push(await editorPage.evaluate(SELECT_PANEL_PROBE, firstNodeId));
      }
      const summary = summarizeLatencySamples(latencies);
      m3 = { p95Ms: summary.p95Ms, p99Ms: summary.p99Ms, samples: summary.count };
      steps.push({
        name: 'M3 · 选中→Inspector 反映（×8）',
        status: 'pass',
        detail: `p95 ${String(summary.p95Ms)}ms`,
      });
      tierLog(`M3 选中→面板 p95 ${String(summary.p95Ms)}ms`);
    } finally {
      await editorContext.close();
    }
    if (editorErrors.length > 0) {
      steps.push({
        name: 'M3 · 编辑器页无未捕获异常',
        status: 'fail',
        detail: editorErrors.join(' | ').slice(0, 300),
      });
    }
  }

  // --- M4：撤销延迟（undo + 重绘；×8，净效果为零） ---
  let m4 = null;
  if (wants.m4 === true) {
    const latencies = [];
    for (let index = 0; index < 8; index += 1) {
      latencies.push(
        await page.evaluate(UNDO_PROBE, { x: 40, y: 40, width: 120, height: 90 }),
      );
    }
    const summary = summarizeLatencySamples(latencies);
    m4 = { p95Ms: summary.p95Ms, p99Ms: summary.p99Ms, samples: summary.count };
    steps.push({
      name: 'M4 · 撤销+重绘（×8）',
      status: 'pass',
      detail: `p95 ${String(summary.p95Ms)}ms`,
    });
    tierLog(`M4 撤销 p95 ${String(summary.p95Ms)}ms`);
  }

  // --- M5：保存往返（×3；失败样本剔除并记录，不得混入成功分布） ---
  let m5 = null;
  if (wants.m5 === true) {
    const latencies = [];
    const saveFailures = [];
    for (let index = 0; index < 3; index += 1) {
      const reading = await page.evaluate(SAVE_PROBE);
      if (reading.ok) {
        latencies.push(reading.ms);
      } else {
        saveFailures.push(String(reading.error).slice(0, 120));
      }
    }
    const summary = summarizeLatencySamples(latencies);
    m5 = latencies.length > 0 ? { p95Ms: summary.p95Ms, samples: summary.count } : null;
    steps.push({
      name: 'M5 · 保存往返（×3）',
      status: saveFailures.length === 0 ? 'pass' : 'fail',
      detail:
        (m5 === null ? '全部失败' : `p95 ${String(summary.p95Ms)}ms`) +
        (saveFailures.length > 0 ? `；失败：${saveFailures.join(' | ')}` : ''),
    });
    tierLog(`M5 保存往返 p95 ${m5 === null ? '失败' : String(summary.p95Ms)}ms`);
  }

  // --- M7：剔除率读数（确定性视口原点；记录性） ---
  let m7 = null;
  if (wants.m7 === true) {
    const rawStats = await page.evaluate(READ_STATS_AT_ORIGIN);
    m7 = computeClipRate(rawStats);
    steps.push({
      name: 'M7 · 剔除率读数（stats()，记录性）',
      status: m7 === null ? 'blocked' : 'pass',
      detail:
        m7 === null
          ? 'stats() 无有效计数（nodesDrawn=0 或缺失）'
          : `clipped/nodesDrawn = ${String(m7.clipped)}/${String(m7.nodesDrawn)} = ${m7.rate.toFixed(3)}`,
    });
  }

  // --- M6：heap（collectGarbage 后取采样树；记录性） ---
  let m6 = null;
  if (cdp !== null) {
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      const profile = await cdp.send('HeapProfiler.getSamplingProfile');
      m6 = { sampledBytes: sumSamplingProfileSelfBytes(profile), samplingIntervalBytes: 32768 };
      steps.push({
        name: 'M6 · heap 采样汇总',
        status: 'pass',
        detail: `${String(m6.sampledBytes)} 字节（采样自用）`,
      });
      tierLog(`M6 heap（采样）${String(m6.sampledBytes)} 字节`);
    } catch (error) {
      steps.push({
        name: 'M6 · heap 采样汇总',
        status: 'blocked',
        detail: String(error).slice(0, 200),
      });
    }
    await cdp.detach().catch(() => undefined);
  }

  if (pageErrors.length > 0) {
    steps.push({
      name: '取样页无未捕获异常',
      status: 'fail',
      detail: pageErrors.join(' | ').slice(0, 300),
    });
  }

  await context.close();

  return {
    run: {
      size,
      nodeCount,
      m1: { firstFrameMs: m1FirstFrameMs, fcpMs: fcpMs ?? null },
      m2: {
        intervalP95Ms: intervalSummary.p95Ms,
        intervalP99Ms: intervalSummary.p99Ms,
        intervalSamples: intervalSummary.count,
      },
      m2Window: perfWindow,
      m3,
      m4,
      m5,
      m6,
      m7,
    },
    steps,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function mainRealChain(baselineInput, requestedSizes) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
  const runDir = join(EVIDENCE_DIR, stamp);
  mkdirSync(runDir, { recursive: true });
  const evidence = {
    schema: 'df.perf.evidence/v1',
    ticket: 'RW-14',
    gate: 'verify-perf',
    mode: 'real-chain',
    stamp,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    environment: { node: process.version, platform: process.platform },
    baseline: {
      path: baselineInput.path,
      present: baselineInput.value !== null && baselineInput.value !== undefined,
      schema: baselineInput.value?.schema ?? null,
      provisional: baselineInput.value?.provisional ?? null,
      loadReason: baselineInput.reason,
    },
    requestedSizes,
    tiers: [],
    // 验收标准 §4 字段族：性能门禁只判时延/帧率/内存，不产像素比对 → 三项 null + 说明。
    diff: {
      bbox: null,
      diffPixels: null,
      ratio: null,
      note: '性能门禁：只判时延 p95 / 帧时长 p95 / heap 采样，不做像素比对（不比图，故无 diff 结论）',
    },
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '阈值入库由 dev 机基线轮签字：两轮实采（本证据即采集产物）→ 写入 docs/quality/perf-baseline-v1.json 并置 provisional:false',
    },
    exitCode: 2,
  };

  const finish = async (code) => {
    evidence.exitCode = code;
    evidence.finishedAt = new Date().toISOString();
    const evidencePath = writeEvidence(evidence, runDir);
    log(`证据：${evidencePath}`);
    await shutdown();
    return code;
  };

  // ① 引擎生成器（叶子 TS 模块；node 类型剥离前提见文件头）
  const fixtures = await loadEngineFixtureModules();
  if (!fixtures.ok) {
    console.error(
      [
        '阻塞：引擎生成器加载失败（真链路采集需要确定性文档，禁用临时拼凑文档替代）。',
        `原因：${fixtures.error}`,
        '前提：node ≥ 23.6（默认 TS 类型剥离；dev 机 node 24 可直跑），或 node 22.6-23.5 设 NODE_OPTIONS=--experimental-strip-types。',
      ].join('\n'),
    );
    evidence.tiers.push({ size: null, code: 2, summary: `引擎生成器加载失败：${fixtures.error}` });
    return finish(2);
  }

  // ② 真链路：daemon 子进程（临时数据根）+ 站点（复用或生产构建起服）+ 同源网关
  const dataRoot = join(tmpdir(), `df-perf-${stamp}`);
  const workspaceDir = join(dataRoot, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  try {
    fixtureDaemon = await startFixtureDaemon({ dataRoot, workspaceDir });
  } catch (error) {
    console.error(`阻塞：daemon 起不来（真链路需真 daemon 落盘确定性文档）。${String(error)}`);
    return finish(2);
  }
  const daemonUrl = fixtureDaemon.url;
  log(`daemon 就绪：${daemonUrl}（数据根 ${dataRoot}）`);

  let webUrl = process.env.DF_WEB_URL ?? null;
  if (webUrl === null) {
    const webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    const nextBin = join(REPO_ROOT, 'apps/web/node_modules/.bin/next');
    if (!existsSync(nextBin)) {
      console.error('阻塞：未找到 next 可执行文件（先 pnpm install）。');
      return finish(2);
    }
    if (!ensureCanvasKitAssets()) {
      console.error('阻塞：CanvasKit 资产准备失败（apps/web/public/canvaskit）。');
      return finish(2);
    }
    const build = track(
      spawn(nextBin, ['build'], { cwd: join(REPO_ROOT, 'apps/web'), stdio: 'inherit' }),
    );
    const buildCode = await new Promise((resolveBuild) => build.on('exit', resolveBuild));
    if (buildCode !== 0) {
      console.error('阻塞：web 构建失败（见上方 next build 输出）。');
      return finish(2);
    }
    webServer = track(
      spawn(nextBin, ['start', '-p', String(webPort)], {
        cwd: join(REPO_ROOT, 'apps/web'),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    webServer.stdout.on('data', (chunk) => {
      if (verbose) process.stdout.write(`[web] ${String(chunk)}`);
    });
    webServer.stderr.on('data', (chunk) => {
      if (verbose) process.stderr.write(`[web] ${String(chunk)}`);
    });
  }
  evidence.webUrl = webUrl;
  if (!(await waitForHttp(webUrl, 60_000, '站点'))) {
    console.error(`阻塞：站点不可达（${webUrl}）。`);
    return finish(2);
  }
  log(`站点就绪：${webUrl}`);

  gateway = await startSameOriginGateway({ webUrl, daemonUrl });
  const gatewayUrl = gateway.url;
  evidence.gatewayUrl = gatewayUrl;
  log(`同源网关就绪：${gatewayUrl}（/df/* → daemon，其余 → 站点）`);

  // ③ Chromium
  const chrome = resolveChromeExecutable();
  if (chrome === undefined) {
    console.error('阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
    return finish(2);
  }
  const { chromium } = await import('playwright-core');
  try {
    browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  } catch (error) {
    console.error(`阻塞：Chromium 启动失败：${String(error)}`);
    return finish(2);
  }

  // ④ 逐档：生成确定性文档 → daemon 落盘 → 打开采集 M1-M7 → 判定
  const baseline = baselineInput.value;
  for (const tier of requestedSizes) {
    const size = tier.key;
    const nodeCount = tier.nodeCount;
    log(`开始采集 @${size}（${String(nodeCount)} 节点）`);
    try {
      // 生成（确定性：注入 createIdFactory(1)，同一参数跨机比特一致）+ 落盘 daemon
      const document = fixtures.createBenchmarkDocument({
        nodeCount,
        ids: fixtures.createIdFactory(1),
        pageId: 'page-1',
      });
      const pageBody = buildPageBody(document);
      const firstNodeId = document.pages[0].rootIds[0];
      const created = await daemonCreateDocument(daemonUrl, `perf-bench-${size}`);
      if (!created.ok) {
        evidence.tiers.push({
          size,
          code: 2,
          summary: `daemon 创建文档失败：${created.error}`,
          steps: [],
        });
        console.error(`阻塞 @${size}：daemon 创建文档失败（${created.error}）。`);
        continue;
      }
      const saved = await daemonSavePage(daemonUrl, created.documentId, 'page-1', pageBody);
      if (!saved.ok) {
        evidence.tiers.push({
          size,
          code: 2,
          summary: `daemon 写入页面失败：${saved.error}`,
          steps: [],
        });
        console.error(`阻塞 @${size}：daemon 写入页面失败（${saved.error}）。`);
        continue;
      }
      // 采集产物落证据目录（正文即 PUT 到 daemon 的字节，供跨机比对复核）
      writeFileSync(
        join(runDir, `doc-${size}.json`),
        `${JSON.stringify(pageBody, null, 2)}\n`,
        'utf8',
      );
      log(`文档就绪：${created.documentId}（正文 doc-${size}.json 已留档）`);

      const { run, steps } = await collectTier(browser, {
        size,
        nodeCount,
        documentId: created.documentId,
        firstNodeId,
        gatewayUrl,
        log,
      });
      const result = evaluatePerfRun(run, baseline);
      evidence.tiers.push({
        size,
        code: result.code,
        summary: result.summary,
        violations: result.violations,
        metrics: result.metrics,
        documentId: created.documentId,
        steps,
      });
      for (const step of steps) {
        const mark = step.status === 'pass' ? '✓' : step.status === 'blocked' ? '⏸' : '✗';
        log(`  ${mark} ${step.name}${step.detail === undefined ? '' : ` —— ${step.detail}`}`);
      }
      console.error(`@${size} → exit ${String(result.code)}：${result.summary}`);
    } catch (error) {
      evidence.tiers.push({
        size,
        code: 2,
        summary: `采集中断：${String(error).slice(0, 300)}`,
        steps: [],
      });
      console.error(`阻塞 @${size}：采集中断（${String(error).slice(0, 300)}）。`);
    }
  }

  // ⑤ 聚合：任一档违规 → 1；否则任一档阻塞 → 2；否则 0（与 e2e-smoke 同序）
  const failures = evidence.tiers.filter((tier) => tier.code === 1);
  const blockedTiers = evidence.tiers.filter((tier) => tier.code === 2);
  if (failures.length > 0) {
    console.error(
      [
        `违规：渲染性能回退（${String(failures.length)} 档超阈值）——先查渲染回归再谈优化立项。`,
        ...failures.map((tier) => `  · @${String(tier.size)}：${tier.summary}`),
      ].join('\n'),
    );
    return finish(1);
  }
  if (blockedTiers.length > 0) {
    console.error(
      [
        `阻塞：${String(blockedTiers.length)} 档判不了（基线/provisional/采集不完整——禁假绿）。`,
        ...blockedTiers.map((tier) => `  · @${String(tier.size)}：${tier.summary}`),
        `待办：dev 机两轮实采后把实测值写入 ${DEFAULT_BASELINE} 并置 provisional:false，门禁才进入 0/1 判定。`,
      ].join('\n'),
    );
    return finish(2);
  }
  console.error(`通过：全部 ${String(evidence.tiers.length)} 档达标（基线实测态）。`);
  return finish(0);
}

/** 离线快照判定（04 模式保留：给快照 JSON + 基线 → 三态结论，不跑真链路）。 */
function mainOfflineSnapshot(baselinePath, snapshotPath, baselineInput, snapshotInput) {
  const result = evaluatePerf(snapshotInput.value, baselineInput.value);
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
  const evidence = {
    schema: 'df.perf.evidence/v1',
    ticket: 'RW-14',
    gate: 'verify-perf',
    mode: 'offline-snapshot',
    stamp,
    baselinePath,
    snapshotPath,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...result,
    counters: snapshotInput.value?.stats ?? null,
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
  };
  const evidencePath = writeEvidence(evidence, EVIDENCE_DIR);

  if (result.code === 2) {
    const reasons = [
      '阻塞：性能观测证据不足——不得据此出任何性能结论（禁假绿）。',
      `原因：${result.summary}`,
    ];
    if (baselineInput.reason !== null) reasons.push(`基线：${baselineInput.reason}`);
    if (snapshotInput.reason !== null) reasons.push(`快照：${snapshotInput.reason}`);
    reasons.push(`证据：${evidencePath}`);
    reasons.push(
      `待办：dev 机基线轮采集两轮数据后落盘 ${DEFAULT_BASELINE}（阈值入库 + provisional:false）；或直接跑真链路采集（pnpm verify:perf）。`,
    );
    console.error(reasons.join('\n'));
    return 2;
  }
  if (result.code === 1) {
    console.error(
      [
        '违规：渲染性能回退（超阈值）——先查渲染回归再谈优化立项。',
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

function main() {
  if (selfTestMode) {
    const result = selfTest();
    console.error(
      result.ok
        ? `自测通过：${String(result.total)} 例（辨别力：无基线/provisional/无快照/结构非法/样本不足 → 2、超阈 → 1、全对 → 0）`
        : `自测失败：${String(result.failed)}/${String(result.total)} 例`,
    );
    return result.ok ? 0 : 1;
  }

  // 硬自证：每次实跑先验辨别力；自测失败 = 门禁自身坏了，按违规退出（绝不带着坏门禁去判性能）。
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

  // 离线快照模式（--snapshot / DF_PERF_SNAPSHOT）：不跑真链路，直接判定快照 JSON。
  const rawSnapshotPath = flagValue('--snapshot') ?? process.env.DF_PERF_SNAPSHOT ?? '';
  if (rawSnapshotPath !== '') {
    const snapshotPath = resolve(rawSnapshotPath);
    const baselineInput = { path: baselinePath, reason: null, value: null };
    const baselineFile = loadJsonInput(baselinePath, '基线');
    baselineInput.value = baselineFile.value;
    baselineInput.reason = baselineFile.reason;
    const snapshotInput = loadJsonInput(snapshotPath, '快照');
    return mainOfflineSnapshot(baselinePath, snapshotPath, baselineInput, snapshotInput);
  }

  // 真链路模式（缺省）：确定性文档 → daemon → 生产站点 → Chromium → M1-M7。
  const baselineInput = { ...loadJsonInput(baselinePath, '基线'), path: baselinePath };
  const sizeArg = flagValue('--size') ?? flagValue('--sizes');
  let requestedSizes = BENCH_SIZES;
  if (sizeArg !== undefined) {
    const keys = sizeArg.split(',').map((item) => item.trim()).filter(Boolean);
    const unknown = keys.filter((key) => !BENCH_SIZES.some((tier) => tier.key === key));
    if (unknown.length > 0) {
      console.error(
        `阻塞：未知规模档 ${unknown.join('、')}（可用：${BENCH_SIZES.map((tier) => tier.key).join('、')}）。`,
      );
      return 2;
    }
    requestedSizes = BENCH_SIZES.filter((tier) => keys.includes(tier.key));
  }

  mainRealChain(baselineInput, requestedSizes)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`阻塞：真链路执行中断（${String(error)}）——采集未完成，判不了就是阻塞。`);
      process.exit(2);
    });
  return undefined;
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

if (isMainModule()) {
  const exitCode = main();
  if (exitCode !== undefined) process.exit(exitCode);
}
