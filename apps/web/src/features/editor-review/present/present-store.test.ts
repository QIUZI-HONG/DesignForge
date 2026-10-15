/**
 * Present UI store 测试（seam：`present-store.ts` 的对外行为）。
 *
 * 断言口径：开启/退出、翻页边界（首尾不越界）、控制条自动隐藏（活动重置计时）。
 */
import { describe, expect, it } from 'vitest';
import { AUTO_HIDE_DELAY_MS } from './controller';
import { createPresentStore } from './present-store';

/** 假时钟：测试显式推进时间，断言自动隐藏时序（不依赖真实 Date.now）。 */
function fakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function storeWithClock() {
  const clock = fakeClock();
  return { clock, store: createPresentStore({ index: 0, barVisible: true }, { now: clock.now }) };
}

describe('Present store', () => {
  it('默认关闭；开启后从第一张开始且控制条可见', () => {
    const store = createPresentStore();
    expect(store.getState().open).toBe(false);
    store.getState().openPresentation();
    expect(store.getState().open).toBe(true);
    expect(store.getState().index).toBe(0);
    expect(store.getState().barVisible).toBe(true);
  });

  it('翻页不越界（首张 ← 与末张 → 都是无操作）', () => {
    const store = createPresentStore();
    store.getState().openPresentation();
    store.getState().step(-1, 3);
    expect(store.getState().index).toBe(0);
    store.getState().step(1, 3);
    store.getState().step(1, 3);
    expect(store.getState().index).toBe(2);
    store.getState().step(1, 3);
    expect(store.getState().index).toBe(2);
  });

  it('翻页会重置自动隐藏计时（刚翻页 → 控制条可见）', () => {
    const store = createPresentStore();
    store.getState().openPresentation();
    store.getState().hideBar();
    expect(store.getState().barVisible).toBe(false);
    store.getState().step(1, 3);
    expect(store.getState().barVisible).toBe(true);
  });

  it('静止超时后控制条隐藏；鼠标活动重新显示', () => {
    const { clock, store } = storeWithClock();
    store.getState().openPresentation();
    clock.advance(AUTO_HIDE_DELAY_MS - 1);
    store.getState().tick();
    expect(store.getState().barVisible).toBe(true);
    clock.advance(2);
    store.getState().tick();
    expect(store.getState().barVisible).toBe(false);
    store.getState().markActivity();
    expect(store.getState().barVisible).toBe(true);
  });

  it('退出演示清空页码（下次开启从第一张开始）', () => {
    const store = createPresentStore();
    store.getState().openPresentation();
    store.getState().step(1, 3);
    store.getState().exitPresentation();
    expect(store.getState().open).toBe(false);
    store.getState().openPresentation();
    expect(store.getState().index).toBe(0);
  });

  it('空序列（无画板）时下标恒为 0 且仍可开启（组件走空态）', () => {
    const store = createPresentStore();
    store.getState().openPresentation();
    store.getState().step(1, 0);
    expect(store.getState().index).toBe(0);
  });
});
