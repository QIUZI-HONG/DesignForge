/**
 * `scripts/verify-perf.mjs` 的行为测试（工单 04 挂点起步 + 工单 14 转正扩展）。
 *
 * 断言口径：门禁三态的外部契约——
 *   0 = 有基线有采集、样本足、全部达标；1 = 有基线有采集但超阈值（性能回退）；2 = 阻塞
 *   （基线缺失 / 基线 provisional / 结构非法 / 样本不足 / 采集不完整——判不了就是阻塞，禁假绿）。
 *
 * 工单 14 新增覆盖：
 *   - 基线两态：`provisional: true`（模板态）恒阻塞，`provisional: false`（dev 机实测入库）才进入 0/1 判定；
 *   - `evaluatePerfRun`：M1-M5 全量运行判定（M6/M7 记录性指标不设通过线）；
 *   - 采集纯函数：`nearestRankPercentile`（与 frame-perf.ts 同口径最近秩法）、
 *     `summarizeLatencySamples`、`computeClipRate`、`sumSamplingProfileSelfBytes`、`buildPageBody`。
 * 判定层是纯函数，夹具直接用字面量；真链路 I/O（daemon/构建/Chromium）不在本文件覆盖。
 *
 * 用法：`pnpm test:scripts`。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPageBody,
  computeClipRate,
  evaluatePerf,
  evaluatePerfRun,
  nearestRankPercentile,
  sumSamplingProfileSelfBytes,
  summarizeLatencySamples,
  validateBaseline,
} from '../verify-perf.mjs';

/** 实测基线（dev 机基线轮入库后的形态；阈值取对标报告 §4.4 初始假设【判断·待校准】）。 */
const baseline = {
  schema: 'df.perf.baseline/v1',
  provisional: false,
  thresholds: {
    '1k': {
      m1FirstFrameMs: 1000,
      m2IntervalP95Ms: 16.7,
      m2DurationP95Ms: 16.7,
      m3SelectPanelMs: 100,
      m4UndoMs: 50,
      m5SaveRoundTripMs: 300,
    },
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

/** 合法快照（`__dforgeCanvas.perf()` 打包落盘的形态）。 */
const snapshot = {
  version: 1,
  frames: 120,
  windowSize: 240,
  duration: { lastMs: 10, avgMs: 9, p95Ms: 12, maxMs: 14 },
  interval: { lastMs: 16, avgMs: 15, p95Ms: 16, maxMs: 17 },
};

/** 合法运行采集包（真链路采集器归一后的形态；全达标取值）。 */
function makeRun(overrides = {}) {
  return {
    size: '5k',
    nodeCount: 5000,
    m1: { firstFrameMs: 1200, fcpMs: 900 },
    m2: { intervalP95Ms: 15, intervalP99Ms: 17, durationP95Ms: 12, intervalSamples: 120 },
    m2Window: {
      ...snapshot,
      duration: { ...snapshot.duration },
      interval: { ...snapshot.interval },
    },
    m3: { p95Ms: 60, samples: 8 },
    m4: { p95Ms: 30, samples: 8 },
    m5: { p95Ms: 200, samples: 3 },
    m6: null,
    m7: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateBaseline（工单 14 基线 schema v1：规模档阈值 + provisional 两态）
// ---------------------------------------------------------------------------

test('validateBaseline：实测基线（provisional:false）→ 无问题', () => {
  assert.deepEqual(validateBaseline(baseline), []);
});

test('validateBaseline：缺 provisional 字段 → 结构非法（两态必须显式声明，禁默认放行）', () => {
  const problems = validateBaseline({ ...baseline, provisional: undefined });
  assert.equal(problems.length > 0, true);
  assert.match(problems.join('；'), /provisional/);
});

test('validateBaseline：thresholds 扁平旧形（未按规模档组织）→ 结构非法', () => {
  const problems = validateBaseline({
    schema: 'df.perf.baseline/v1',
    provisional: false,
    thresholds: { intervalP95Ms: 16.7, durationP95Ms: 16.7 },
  });
  assert.equal(problems.length > 0, true);
});

test('validateBaseline：thresholds 档内值既非正数也非 null → 结构非法', () => {
  const problems = validateBaseline({
    ...baseline,
    thresholds: {
      ...baseline.thresholds,
      '5k': { ...baseline.thresholds['5k'], m4UndoMs: -1 },
    },
  });
  assert.equal(problems.length > 0, true);
  assert.match(problems.join('；'), /m4UndoMs/);
});

// ---------------------------------------------------------------------------
// evaluatePerf（快照判定 · 工单 04 契约保持 + 工单 14 基线两态扩展）
// ---------------------------------------------------------------------------

test('evaluatePerf：无基线 → 2（无基准数据禁判，阻塞语义）', () => {
  assert.equal(evaluatePerf(null, null).code, 2);
  assert.equal(evaluatePerf(snapshot, null).code, 2);
});

test('evaluatePerf：有基线无快照 → 2（观测通道未产出证据）', () => {
  assert.equal(evaluatePerf(null, baseline).code, 2);
});

test('evaluatePerf：快照结构非法（缺 duration/interval 或版本不对）→ 2', () => {
  assert.equal(evaluatePerf({}, baseline).code, 2);
  assert.equal(evaluatePerf({ ...snapshot, version: 2 }, baseline).code, 2);
  assert.equal(evaluatePerf({ ...snapshot, duration: null }, baseline).code, 2);
  assert.equal(
    evaluatePerf({ ...snapshot, interval: { ...snapshot.interval, p95Ms: 'x' } }, baseline).code,
    2,
  );
});

test('evaluatePerf：基线结构非法（缺 thresholds / 扁平旧形 / 阈值为负）→ 2', () => {
  assert.equal(evaluatePerf(snapshot, {}).code, 2);
  assert.equal(evaluatePerf(snapshot, { thresholds: {} }).code, 2);
  assert.equal(
    evaluatePerf(snapshot, { thresholds: { intervalP95Ms: -1, durationP95Ms: 16.7 } }).code,
    2,
  );
});

test('evaluatePerf：基线 provisional（模板态）→ 恒阻塞 2（禁拿未校准阈值判性能）', () => {
  const result = evaluatePerf(snapshot, { ...baseline, provisional: true });
  assert.equal(result.code, 2);
  assert.match(result.summary, /provisional/);
});

test('evaluatePerf：样本不足（frames < minFrames）→ 2（判不了，不猜）', () => {
  const result = evaluatePerf({ ...snapshot, frames: 59 }, baseline);
  assert.equal(result.code, 2);
  assert.match(result.summary, /样本不足/);
});

test('evaluatePerf：interval p95 超阈 → 1（交互帧率回退）', () => {
  const result = evaluatePerf(
    { ...snapshot, interval: { ...snapshot.interval, p95Ms: 20 } },
    baseline,
  );
  assert.equal(result.code, 1);
  assert.match(result.summary, /interval\.p95Ms/);
});

test('evaluatePerf：duration p95 超阈 → 1（绘制耗时回退）', () => {
  const result = evaluatePerf(
    { ...snapshot, duration: { ...snapshot.duration, p95Ms: 25 } },
    baseline,
  );
  assert.equal(result.code, 1);
  assert.match(result.summary, /duration\.p95Ms/);
});

test('evaluatePerf：阈值 null（记录性档，如 20k）→ 不判违规只记录 → 0', () => {
  const result = evaluatePerf(
    { ...snapshot, interval: { ...snapshot.interval, p95Ms: 999 } },
    baseline,
    { size: '20k' },
  );
  assert.equal(result.code, 0);
  assert.equal(result.metrics.threshold.intervalP95Ms, null);
});

test('evaluatePerf：基线未含该规模档 → 2（阈值缺口判不了）', () => {
  const partial = {
    ...baseline,
    thresholds: { '5k': baseline.thresholds['5k'] },
  };
  assert.equal(evaluatePerf(snapshot, partial, { size: '1k' }).code, 2);
});

test('evaluatePerf：全达标 → 0，明细带实测值（证据可核）', () => {
  const result = evaluatePerf(snapshot, baseline);
  assert.equal(result.code, 0);
  assert.match(result.summary, /16(\.0)?/);
  assert.deepEqual(result.metrics, {
    frames: 120,
    intervalP95Ms: 16,
    durationP95Ms: 12,
    threshold: { intervalP95Ms: 16.7, durationP95Ms: 16.7 },
  });
});

test('evaluatePerf：snapshot.stats 缺失不影响判定（M7 记录性指标，不设通过线）', () => {
  assert.equal(evaluatePerf(snapshot, baseline).code, 0);
  assert.equal(
    evaluatePerf({ ...snapshot, stats: { nodes: 100, clipped: 70, textRuns: 3 } }, baseline).code,
    0,
  );
});

// ---------------------------------------------------------------------------
// evaluatePerfRun（全量运行判定 · 工单 14：M1-M5 判定 + M6/M7 记录）
// ---------------------------------------------------------------------------

test('evaluatePerfRun：全达标（实测基线）→ 0，metrics 带全部实测与阈值', () => {
  const result = evaluatePerfRun(makeRun(), baseline);
  assert.equal(result.code, 0);
  assert.equal(result.metrics.size, '5k');
  assert.equal(result.metrics.m1FirstFrameMs, 1200);
  assert.equal(result.metrics.m2IntervalP95Ms, 15);
  assert.equal(result.metrics.m2DurationP95Ms, 12);
  assert.equal(result.metrics.m7ClipRate, null);
  assert.equal(result.metrics.threshold.m1FirstFrameMs, 1500);
});

test('evaluatePerfRun：provisional 基线 → 2（模板态禁判定）', () => {
  const result = evaluatePerfRun(makeRun(), { ...baseline, provisional: true });
  assert.equal(result.code, 2);
  assert.match(result.summary, /provisional/);
});

test('evaluatePerfRun：M1 首帧超阈 → 1（打开文档到首帧回退）', () => {
  const result = evaluatePerfRun(makeRun({ m1: { firstFrameMs: 5000, fcpMs: 900 } }), baseline);
  assert.equal(result.code, 1);
  assert.match(result.violations.join('；'), /m1FirstFrameMs/);
});

test('evaluatePerfRun：M2 间隔 p95 超阈 → 1（交互帧率回退）', () => {
  const result = evaluatePerfRun(
    makeRun({
      m2: { intervalP95Ms: 40, intervalP99Ms: 60, durationP95Ms: 12, intervalSamples: 120 },
    }),
    baseline,
  );
  assert.equal(result.code, 1);
  assert.match(result.violations.join('；'), /m2IntervalP95Ms/);
});

test('evaluatePerfRun：M2 绘制耗时 p95（来自 perf() 环形窗口）超阈 → 1', () => {
  const run = makeRun({
    m2Window: { ...snapshot, duration: { ...snapshot.duration, p95Ms: 90 } },
  });
  const result = evaluatePerfRun(run, baseline);
  assert.equal(result.code, 1);
  assert.match(result.violations.join('；'), /duration\.p95Ms/);
});

test('evaluatePerfRun：M3/M4/M5 各自超阈 → 1（选中/撤销/保存往返回退）', () => {
  assert.match(
    evaluatePerfRun(makeRun({ m3: { p95Ms: 500, samples: 8 } }), baseline).violations.join('；'),
    /m3SelectPanelMs/,
  );
  assert.match(
    evaluatePerfRun(makeRun({ m4: { p95Ms: 500, samples: 8 } }), baseline).violations.join('；'),
    /m4UndoMs/,
  );
  assert.match(
    evaluatePerfRun(makeRun({ m5: { p95Ms: 500, samples: 3 } }), baseline).violations.join('；'),
    /m5SaveRoundTripMs/,
  );
});

test('evaluatePerfRun：20k 档阈值全 null → 只记录不判违规（即便数值巨大）→ 0', () => {
  const result = evaluatePerfRun(
    makeRun({
      size: '20k',
      nodeCount: 20000,
      m1: { firstFrameMs: 99_999, fcpMs: 9_999 },
      m2: { intervalP95Ms: 999, intervalP99Ms: 1_999, durationP95Ms: 999, intervalSamples: 200 },
      m3: null,
      m4: null,
      m5: { p95Ms: 9_999, samples: 3 },
    }),
    baseline,
  );
  assert.equal(result.code, 0);
  assert.equal(result.violations.length, 0);
  assert.equal(result.metrics.m1FirstFrameMs, 99_999);
});

test('evaluatePerfRun：perf() 窗口缺失或结构非法 → 2（M2 判不了）', () => {
  assert.equal(evaluatePerfRun(makeRun({ m2Window: null }), baseline).code, 2);
  assert.equal(evaluatePerfRun(makeRun({ m2Window: { version: 2 } }), baseline).code, 2);
});

test('evaluatePerfRun：perf() 窗口帧数不足 minFrames → 2（样本攒不够不判）', () => {
  const result = evaluatePerfRun(makeRun({ m2Window: { ...snapshot, frames: 10 } }), baseline);
  assert.equal(result.code, 2);
  assert.match(result.summary, /样本不足/);
});

test('evaluatePerfRun：M1 采集缺失 → 2（首帧是必采指标）', () => {
  assert.equal(evaluatePerfRun(makeRun({ m1: null }), baseline).code, 2);
  assert.equal(
    evaluatePerfRun(makeRun({ m1: { firstFrameMs: Number.NaN, fcpMs: null } }), baseline).code,
    2,
  );
});

test('evaluatePerfRun：M2 间隔样本不足 → 2（交互窗口未攒够）', () => {
  const result = evaluatePerfRun(
    makeRun({
      m2: { intervalP95Ms: 15, intervalP99Ms: 17, durationP95Ms: 12, intervalSamples: 10 },
    }),
    baseline,
  );
  assert.equal(result.code, 2);
  assert.match(result.summary, /样本不足/);
});

test('evaluatePerfRun：判定档指标缺失或样本不足 → 2；阈值 null 档缺失不阻塞', () => {
  // 5k 判定档：m3 缺失 → 阻塞
  assert.equal(evaluatePerfRun(makeRun({ m3: null }), baseline).code, 2);
  // 5k 判定档：m3 样本不足 → 阻塞
  assert.equal(evaluatePerfRun(makeRun({ m3: { p95Ms: 60, samples: 2 } }), baseline).code, 2);
  // 20k 记录档：m3/m4 缺失 → 不阻塞（阈值 null，采了也只记录）
  const run20k = makeRun({
    size: '20k',
    nodeCount: 20000,
    m3: null,
    m4: null,
  });
  assert.equal(evaluatePerfRun(run20k, baseline).code, 0);
});

test('evaluatePerfRun：M6/M7 记录性指标缺失不阻塞（无通过线，随证据留存）', () => {
  assert.equal(evaluatePerfRun(makeRun({ m6: null, m7: null }), baseline).code, 0);
});

test('evaluatePerfRun：规模档阈值缺口 → 2', () => {
  const partial = { ...baseline, thresholds: { '5k': baseline.thresholds['5k'] } };
  assert.equal(evaluatePerfRun(makeRun({ size: '1k' }), partial).code, 2);
});

// ---------------------------------------------------------------------------
// 采集纯函数（工单 14：采集逻辑与 I/O 分离的可测部分）
// ---------------------------------------------------------------------------

test('nearestRankPercentile：最近秩法（与 frame-perf.ts 同口径），空样本 → null', () => {
  assert.equal(nearestRankPercentile([], 0.95), null);
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(nearestRankPercentile(hundred, 0.95), 95);
  assert.equal(nearestRankPercentile(hundred, 0.99), 99);
  // 最近秩：ceil(0.95·4)=4 → 第 4 小；ceil(0.5·4)=2 → 第 2 小
  assert.equal(nearestRankPercentile([4, 1, 3, 2], 0.95), 4);
  assert.equal(nearestRankPercentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(nearestRankPercentile([42], 0.99), 42);
});

test('summarizeLatencySamples：count/p50/p95/p99/max 一次算齐，非有限值剔除', () => {
  const summary = summarizeLatencySamples([12, 5, 7, 20, 3]);
  assert.deepEqual(summary, { count: 5, p50Ms: 7, p95Ms: 20, p99Ms: 20, maxMs: 20 });
  const withNoise = summarizeLatencySamples([5, Number.NaN, 7]);
  assert.deepEqual(withNoise, { count: 2, p50Ms: 5, p95Ms: 7, p99Ms: 7, maxMs: 7 });
  assert.deepEqual(summarizeLatencySamples([]), {
    count: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
  });
});

test('computeClipRate：clipped/nodesDrawn；无访问或字段缺失 → null（不产 0 冒充）', () => {
  assert.equal(computeClipRate(null), null);
  assert.equal(computeClipRate({ nodesDrawn: 0, clipped: 0, textRuns: 0 }), null);
  assert.deepEqual(computeClipRate({ nodesDrawn: 800, clipped: 200, textRuns: 3 }), {
    rate: 0.25,
    nodesDrawn: 800,
    clipped: 200,
    textRuns: 3,
  });
  assert.equal(computeClipRate({ nodesDrawn: undefined, clipped: 5 }), null);
});

test('sumSamplingProfileSelfBytes：汇总 CDP HeapProfiler 采样树自用字节（忽略 samples 列）', () => {
  const profile = {
    head: {
      selfSize: 100,
      children: [
        { selfSize: 50, children: [] },
        { selfSize: 30, children: [{ selfSize: 20, children: [] }] },
      ],
    },
    samples: [{ size: 9_999, count: 1 }],
  };
  assert.equal(sumSamplingProfileSelfBytes(profile), 200);
  assert.equal(sumSamplingProfileSelfBytes(null), 0);
  assert.equal(sumSamplingProfileSelfBytes({}), 0);
  assert.equal(sumSamplingProfileSelfBytes({ head: { selfSize: 7 } }), 7);
});

test('buildPageBody：页面正文信封与 documents-client 的 encodePageBody 同形且确定', () => {
  const grid = { size: 10, visible: false, snapToGrid: false, style: 'grid' };
  const page = {
    id: 'page-1',
    name: '页面 1',
    nodes: {},
    rootIds: [],
    backgroundColor: '#F5F5F5',
    grid,
  };
  const document = { id: 'doc_x', name: '性能基准', pages: [page], tokens: {} };
  const body = buildPageBody(document);
  assert.deepEqual(body, {
    $format: 'dforge.canvas.page',
    $version: 1,
    page,
    tokens: {},
  });
  // 两次构建比特一致（正文即 daemon 收到的字节，必须可复现）
  assert.equal(JSON.stringify(buildPageBody(document)), JSON.stringify(body));
});
