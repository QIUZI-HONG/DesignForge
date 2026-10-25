/**
 * 门禁/调试句柄（`window.__dforgeCanvas`）渲染观测读点（S2）的外部契约测试。
 *
 * 断言口径：`perf()` 是 verify:perf 的**同源只读读点**——
 * 未接帧计时的宿主必须拿到显式 `null`（门禁据此阻塞，禁把「没接」误判成「0 帧」）；
 * 接了就透传记录器快照（不复制、不加工）。session 用最小桩：句柄读点走的是
 * 会话的公开方法，桩只提供签名（本测试不测会话内部）。
 */

import { describe, expect, it } from 'vitest';
import type { FramePerfSnapshot } from '../render/frame-perf';
import type { CanvasSession } from '../state/session';
import type { CanvasRuntimeStatus } from '../ui/canvas-stage';
import { sessionDebugHandle } from './canvas-debug';

/** 最小会话桩（sessionDebugHandle 用到的公开方法签名）。 */
function fakeSession(): CanvasSession {
  return {
    viewport: () => ({ zoom: 1, panX: 0, panY: 0 }),
    selection: () => ({ ids: [] }),
    page: () => ({ id: 'p1', rootIds: [], nodes: {} }),
    document: () => ({ name: '文档', pages: [] }),
    store: {
      getState: () => ({ hud: null, editing: null, error: null }),
    },
    setSnapEnabled: () => undefined,
    setSelection: () => undefined,
    createRect: () => 'n1',
  } as unknown as CanvasSession;
}

/** 最小运行时状态桩（与画布就绪态同形）。 */
function readyStatus(): CanvasRuntimeStatus {
  return {
    canvasKit: 'ready',
    fonts: 'ready',
    firstFrame: true,
    frameCount: 1,
    dpr: 1,
    error: null,
  };
}

describe('sessionDebugHandle · perf 读点', () => {
  it('未传 perf：handle.perf() 返回显式 null（通道未接，门禁据此阻塞）', () => {
    const handle = sessionDebugHandle({
      session: fakeSession(),
      runtime: readyStatus,
      stats: () => null,
    });
    expect(handle.version).toBe(1);
    expect(handle.perf()).toBeNull();
  });

  it('传入 perf：透传快照对象（只读，不复制不加工）', () => {
    const snapshot: FramePerfSnapshot = {
      version: 1,
      frames: 2,
      windowSize: 240,
      duration: { lastMs: 12, avgMs: 11, p95Ms: 12, maxMs: 12 },
      interval: { lastMs: 16, avgMs: 16, p95Ms: 16, maxMs: 16 },
    };
    const handle = sessionDebugHandle({
      session: fakeSession(),
      runtime: readyStatus,
      stats: () => null,
      perf: () => snapshot,
    });
    expect(handle.perf()).toBe(snapshot);
  });
});
