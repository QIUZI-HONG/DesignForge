/**
 * 帧性能记录器（渲染观测 seam · S1）的外部契约测试。
 *
 * 断言口径：`snapshot()` 是门禁经 `__dforgeCanvas.perf()` 读到的**只读快照**，
 * 这里锁它的形状与聚合语义（p95 用最近秩法、环形窗口淘汰、累计帧数不被淘汰），
 * 不测 record 的调用时机（那是 CanvasStage 帧闭包的事，浏览器门禁层负责）。
 * 时钟不进本模块：时长由调用方算好传入，因此无需假时钟。
 */

import { describe, expect, it } from 'vitest';

import { createFramePerfRecorder } from './frame-perf';

describe('createFramePerfRecorder', () => {
  it('空记录器：快照形状完整（version/windowSize/frames=0/窗口全 null）', () => {
    const snapshot = createFramePerfRecorder().snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.frames).toBe(0);
    expect(snapshot.windowSize).toBe(240);
    expect(snapshot.duration).toEqual({
      lastMs: null,
      avgMs: null,
      p95Ms: null,
      maxMs: null,
    });
    expect(snapshot.interval).toEqual({
      lastMs: null,
      avgMs: null,
      p95Ms: null,
      maxMs: null,
    });
  });

  it('首帧 interval 为 null：duration 入窗，interval 窗口保持全 null', () => {
    const recorder = createFramePerfRecorder();
    recorder.record({ durationMs: 10, intervalMs: null });
    const snapshot = recorder.snapshot();
    expect(snapshot.frames).toBe(1);
    expect(snapshot.duration).toEqual({ lastMs: 10, avgMs: 10, p95Ms: 10, maxMs: 10 });
    expect(snapshot.interval).toEqual({
      lastMs: null,
      avgMs: null,
      p95Ms: null,
      maxMs: null,
    });
  });

  it('第二帧起 interval 入窗（last/avg/p95/max 单样本同值）', () => {
    const recorder = createFramePerfRecorder();
    recorder.record({ durationMs: 10, intervalMs: null });
    recorder.record({ durationMs: 12, intervalMs: 16.5 });
    const snapshot = recorder.snapshot();
    expect(snapshot.frames).toBe(2);
    expect(snapshot.duration.lastMs).toBe(12);
    expect(snapshot.interval).toEqual({
      lastMs: 16.5,
      avgMs: 16.5,
      p95Ms: 16.5,
      maxMs: 16.5,
    });
  });

  it('p95 用最近秩法（20 样本 → 第 19 小 = 190，区别于 max=200 与线性插值）', () => {
    const recorder = createFramePerfRecorder();
    for (let index = 1; index <= 20; index += 1) {
      recorder.record({ durationMs: index * 10, intervalMs: 16 });
    }
    const duration = recorder.snapshot().duration;
    expect(duration.avgMs).toBe(105);
    expect(duration.p95Ms).toBe(190);
    expect(duration.maxMs).toBe(200);
    expect(duration.lastMs).toBe(200);
  });

  it('环形窗口淘汰：windowSize=4 记 6 帧后只按后 4 帧聚合，frames 仍累计 6', () => {
    const recorder = createFramePerfRecorder(4);
    for (let index = 1; index <= 6; index += 1) {
      recorder.record({ durationMs: index, intervalMs: 16 });
    }
    const snapshot = recorder.snapshot();
    expect(snapshot.windowSize).toBe(4);
    expect(snapshot.frames).toBe(6);
    // 窗口只含 3/4/5/6：avg=4.5，max=6，p95（最近秩：ceil(0.95*4)=4 → 第 4 小）= 6
    expect(snapshot.duration.lastMs).toBe(6);
    expect(snapshot.duration.avgMs).toBe(4.5);
    expect(snapshot.duration.maxMs).toBe(6);
    expect(snapshot.duration.p95Ms).toBe(6);
  });

  it('interval 窗口只收非 null 样本：首帧 null 不计入，lastMs 取最近数字样本', () => {
    const recorder = createFramePerfRecorder(3);
    recorder.record({ durationMs: 10, intervalMs: null });
    recorder.record({ durationMs: 10, intervalMs: 20 });
    recorder.record({ durationMs: 10, intervalMs: 30 });
    recorder.record({ durationMs: 10, intervalMs: null });
    recorder.record({ durationMs: 10, intervalMs: 40 });
    const interval = recorder.snapshot().interval;
    // 非空样本 20/30/40 都在窗口内（null 不占位）：avg=30，last=40
    expect(interval.lastMs).toBe(40);
    expect(interval.avgMs).toBe(30);
    expect(interval.maxMs).toBe(40);
  });

  it('自定义 windowSize 写进快照（门禁核对采样窗口）', () => {
    expect(createFramePerfRecorder(60).snapshot().windowSize).toBe(60);
  });
});
