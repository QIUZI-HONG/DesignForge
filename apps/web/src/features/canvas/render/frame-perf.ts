/**
 * 帧性能记录器（渲染观测 seam 的内存聚合件）。
 *
 * 定位（规格 §渲染观测 seam）：帧时长属「渲染循环已有的观测量」的可编程暴露——
 * 本模块只做**纯内存环形窗口聚合**：`record()` 由 CanvasStage 帧闭包喂样本，
 * `snapshot()` 由门禁经 `__dforgeCanvas.perf()`（见 debug/canvas-debug.ts）按需读取。
 * 不新造协议、不逐帧上行、无任何写盘/网络副作用（daemon 遥测仅接收汇总，沿用 JSONL）。
 *
 * SSR 安全：纯 TS、模块顶层不碰 `window` / `performance`（时长由调用方测好传入，
 * 本模块不需要时钟，测试也无需假时钟）。
 *
 * 绘制计数（nodes/clipped/textRuns）不经此模块：它们已在 `SceneRenderStats`，
 * 门禁走既有 `stats()` 读点（M7 剔除率 = clipped / nodes 自行计算）。
 */

/** 单帧计时样本（CanvasStage 帧闭包测量）。 */
export interface FrameTiming {
  /** 本帧耗时（帧回调开始 → 绘制完成，毫秒）。 */
  durationMs: number;
  /** 与上一帧帧回调开始的时间间隔（毫秒；首帧无上一帧 → null）。M2「rAF 间隔分布」口径。 */
  intervalMs: number | null;
}

/** 单指标的环形窗口汇总（窗口空 → 全 null：门禁据此判「无样本」而非 0）。 */
export interface FramePerfWindow {
  /** 窗口内最近一个样本值。 */
  lastMs: number | null;
  /** 窗口内算术平均。 */
  avgMs: number | null;
  /** 窗口内 p95（最近秩法：升序第 ceil(0.95·n) 小，不插值——门禁复核口径确定）。 */
  p95Ms: number | null;
  /** 窗口内最大值。 */
  maxMs: number | null;
}

/** 帧性能只读快照（`__dforgeCanvas.perf()` 返回形态）。 */
export interface FramePerfSnapshot {
  version: 1;
  /** 记录器创建以来累计帧数（含已被窗口淘汰的；「通道活着」的证据）。 */
  frames: number;
  /** 环形窗口容量（帧；门禁核对采样窗口）。 */
  windowSize: number;
  /** 本帧耗时窗口（M1/M4 口径）。 */
  duration: FramePerfWindow;
  /** rAF 间隔窗口（M2 交互帧率口径）。 */
  interval: FramePerfWindow;
}

/** 帧性能记录器（宿主持有；只写 record、只读 snapshot）。 */
export interface FramePerfRecorder {
  record(timing: FrameTiming): void;
  snapshot(): FramePerfSnapshot;
}

/** 缺省窗口容量（240 帧 ≈ 60fps 下 4 秒样本；门禁 p95 判定足够且内存可忽略）。 */
const DEFAULT_WINDOW_SIZE = 240;

/** p95 分位（最近秩法：升序第 ceil(0.95·n) 小，1 基）。 */
function percentile95(sorted: readonly number[]): number {
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

/** 单指标窗口聚合（样本即已滤除非数值项后的数组；空 → 全 null）。 */
function summarize(samples: readonly number[]): FramePerfWindow {
  if (samples.length === 0) {
    return { lastMs: null, avgMs: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    lastMs: samples[samples.length - 1] as number,
    avgMs: total / samples.length,
    p95Ms: percentile95(sorted),
    maxMs: sorted[sorted.length - 1] as number,
  };
}

/** 创建帧性能记录器。 */
export function createFramePerfRecorder(
  windowSize: number = DEFAULT_WINDOW_SIZE,
): FramePerfRecorder {
  const capacity = Math.max(1, Math.floor(windowSize));
  const durations: number[] = [];
  const intervals: number[] = [];
  let frames = 0;

  return {
    record(timing): void {
      frames += 1;
      durations.push(timing.durationMs);
      if (durations.length > capacity) durations.shift();
      // interval 只收数字样本（首帧 null 不占窗口位；窗口末元素即最近数字样本）
      if (typeof timing.intervalMs === 'number') {
        intervals.push(timing.intervalMs);
        if (intervals.length > capacity) intervals.shift();
      }
    },
    snapshot(): FramePerfSnapshot {
      return {
        version: 1,
        frames,
        windowSize: capacity,
        duration: summarize(durations),
        interval: summarize(intervals),
      };
    },
  };
}
