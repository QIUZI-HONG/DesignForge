// @vitest-environment jsdom
/**
 * 画布 HUD（冻结接口 ②）行为测试。
 *
 * 断言的是**对外可观测行为**：
 * 1. 状态机：show/hide、自动淡出、重复 show 重置计时、空写 no-op（不惊动订阅者）；
 * 2. React 侧：`useCanvasHud()` 在 Provider 内外都能驱动 HUD 条（FE-06 只调用 show/hide）；
 * 3. a11y：反白小条是 `role="status"`（测量值播报不打断）。
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasHud, CanvasHudProvider, useCanvasHud } from './context';
import { canvasHud, getCanvasHudSnapshot, subscribeCanvasHud } from './controller';

/** 探针：把 HUD 接口暴露给用例（模拟 FE-06 的调用位）。 */
let hud: ReturnType<typeof useCanvasHud> | null = null;

function HudCaller() {
  hud = useCanvasHud();
  return null;
}

/** 装配：调用位 + HUD 条（同一棵树，模拟编辑器壳）。 */
function Harness({ withProvider = true }: { withProvider?: boolean }) {
  const tree = (
    <>
      <HudCaller />
      <CanvasHud />
    </>
  );
  return withProvider ? <CanvasHudProvider>{tree}</CanvasHudProvider> : tree;
}

afterEach(() => {
  cleanup();
  canvasHud.hide();
  hud = null;
});

describe('HUD 状态机（canvasHud）', () => {
  it('show 后可见，hide 后不可见', () => {
    expect(getCanvasHudSnapshot().text).toBeNull();
    canvasHud.show('1200 × 800');
    expect(getCanvasHudSnapshot().text).toBe('1200 × 800');
    canvasHud.hide();
    expect(getCanvasHudSnapshot().text).toBeNull();
  });

  it('snapshot 引用稳定：内容不变时 show 不换对象、不通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasHud(listener);
    canvasHud.show('100%');
    const first = getCanvasHudSnapshot();
    canvasHud.show('100%');
    expect(getCanvasHudSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('hide 在不可见时是 no-op（不通知订阅者）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasHud(listener);
    canvasHud.hide();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('autoHideMs 到期自动消失，重复 show 重置计时', () => {
    vi.useFakeTimers();
    try {
      canvasHud.show('150%', { autoHideMs: 1000 });
      vi.advanceTimersByTime(700);
      canvasHud.show('200%', { autoHideMs: 1000 });
      vi.advanceTimersByTime(700);
      // 第一次的计时已被重置：此刻仍在显示
      expect(getCanvasHudSnapshot().text).toBe('200%');
      vi.advanceTimersByTime(400);
      expect(getCanvasHudSnapshot().text).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('拖动这类持续状态用缺省（常驻），不会自行消失', () => {
    vi.useFakeTimers();
    try {
      canvasHud.show('测量中…');
      vi.advanceTimersByTime(60_000);
      expect(getCanvasHudSnapshot().text).toBe('测量中…');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useCanvasHud + CanvasHud 组件', () => {
  it('Provider 内：show 显示 11px 反白小条，hide 移除', () => {
    render(<Harness />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      hud?.show('1200 × 800');
    });
    const bar = screen.getByRole('status');
    expect(bar.textContent).toBe('1200 × 800');
    expect(bar.getAttribute('aria-live')).toBe('polite');
    expect(bar.getAttribute('data-df-preview')).toBe('editor/hud');

    act(() => {
      hud?.hide();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('无 Provider 时 useCanvasHud 优雅退回全局控制器（画布不该因 HUD 缺席而崩）', () => {
    render(<Harness withProvider={false} />);
    act(() => {
      hud?.show('100%');
    });
    expect(screen.getByRole('status').textContent).toBe('100%');
    act(() => {
      hud?.hide();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('命令式路径（非 React 调用方）与 React 侧共享同一状态', () => {
    render(<Harness />);
    act(() => {
      canvasHud.show('50%');
    });
    expect(screen.getByRole('status').textContent).toBe('50%');
  });
});
