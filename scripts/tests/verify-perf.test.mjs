/**
 * `scripts/verify-perf.mjs` 的 `evaluatePerf` 判定（S3）行为测试（挂点起步 · 三态辨别力）。
 *
 * 断言口径：门禁三态的外部契约——
 *   0 = 有快照有基线且全部达标；1 = 有快照有基线但超阈值（回退）；2 = 阻塞
 *   （无基线 / 无快照 / 结构非法 / 样本不足——判不了就是阻塞，禁假绿）。
 * M7 剔除率是记录性指标（不设通过线，见对标报告 §4.4），本测试同时锁「snapshot.stats
 * 缺失不影响判定」——将来采集器补计数时门禁语义不漂移。
 *
 * 用法：`pnpm test:scripts`。evaluatePerf 是纯函数，夹具直接用字面量。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluatePerf } from '../verify-perf.mjs';

/** 合法基线（dev 机基线轮入库后的形态；阈值取对标报告 §4.4 初始假设）。 */
const baseline = {
  schema: 'df.perf.baseline/v1',
  thresholds: { intervalP95Ms: 16.7, durationP95Ms: 16.7 },
  minFrames: 60,
};

/** 合法快照（`__dforgeCanvas.perf()` 打包落盘的形态）。 */
const snapshot = {
  version: 1,
  frames: 120,
  windowSize: 240,
  duration: { lastMs: 10, avgMs: 9, p95Ms: 12, maxMs: 14 },
  interval: { lastMs: 16, avgMs: 15, p95Ms: 16, maxMs: 17 },
};

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

test('evaluatePerf：基线结构非法（缺 thresholds 或阈值为负）→ 2', () => {
  assert.equal(evaluatePerf(snapshot, {}).code, 2);
  assert.equal(evaluatePerf(snapshot, { thresholds: {} }).code, 2);
  assert.equal(
    evaluatePerf(snapshot, { thresholds: { intervalP95Ms: -1, durationP95Ms: 16.7 } }).code,
    2,
  );
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
