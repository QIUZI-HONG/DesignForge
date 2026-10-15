/**
 * 状态族基础件与 Toast 行为测试（F11 Toast、F12 空态、F13 加载态、F14 错误态）。
 *
 * 断言角度：语义（role/aria 值）、动作可触发、自动消失与撤销动作、重试与错误码、
 * 骨架的块数与装饰性（读屏不念骨架）。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingOverlay } from './LoadingOverlay';
import { Progress } from './Progress';
import { Skeleton, SkeletonCard, SkeletonText } from './Skeleton';
import { ToastProvider, useToast } from './Toast';

describe('EmptyState（F12 空态族）', () => {
  it('标题/说明/主按钮齐备，默认插图存在', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="还没有文件"
        description="从模板开始，或新建空白设计文件。"
        action={<Button onClick={onClick}>新建文件</Button>}
      />,
    );
    expect(screen.getByText('还没有文件')).toBeTruthy();
    expect(screen.getByText('从模板开始，或新建空白设计文件。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建文件' })).toBeTruthy();
    expect(document.querySelector('.dfg-state__art svg')).not.toBeNull();
  });

  it('插图可覆盖（插画位由调用方给）', () => {
    render(<EmptyState title="空" art={<span data-testid="art">插画</span>} />);
    expect(screen.getByTestId('art')).toBeTruthy();
  });
});

describe('ErrorState（F14 错误态族）', () => {
  it('错误码与重试按钮齐备，重试可触发', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="加载失败"
        description="无法连接本地服务。"
        code="E_NET_503"
        onRetry={onRetry}
        retryLabel="重试"
      />,
    );
    expect(screen.getByText('E_NET_503')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('重试进行中：按钮进加载态并禁点', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ErrorState title="加载失败" onRetry={onRetry} retryLabel="重试" retrying />,
    );
    const button = screen.getByRole('button', { name: '重试' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    rerender(<ErrorState title="加载失败" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Skeleton（F13 加载态族）', () => {
  it('文本骨架块数与装饰性（读屏不念）', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.querySelectorAll('.dfg-skeleton').length).toBe(3);
    expect(container.querySelector('.dfg-skeleton__lines')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('卡片骨架含缩略图与行块（3–5 块）', () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelector('.dfg-skeleton__thumb')).not.toBeNull();
    expect(container.querySelectorAll('.dfg-skeleton').length).toBeGreaterThanOrEqual(2);
  });

  it('单块骨架可指定宽高（走令牌或百分比）', () => {
    const { container } = render(<Skeleton width="60%" />);
    const block = container.querySelector('.dfg-skeleton') as HTMLElement;
    expect(block.style.width).toBe('60%');
  });
});

describe('Progress（F13 页面级进度）', () => {
  it('确定值：progressbar 语义与百分比宽度', () => {
    const { container } = render(<Progress value={40} max={100} label="导出进度" />);
    const bar = screen.getByRole('progressbar', { name: '导出进度' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    const fill = container.querySelector('.dfg-progress__bar') as HTMLElement;
    expect(fill.style.width).toBe('40%');
  });

  it('不确定值：不加值属性并标注 indeterminate', () => {
    const { container } = render(<Progress label="准备中" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(container.querySelector('.dfg-progress')?.className).toContain(
      'dfg-progress--indeterminate',
    );
  });
});

describe('LoadingOverlay（F13 阻塞遮罩）', () => {
  it('阻塞遮罩带具名状态区与转圈', () => {
    const { container } = render(<LoadingOverlay label="正在导出" />);
    expect(screen.getByRole('status', { name: '正在导出' })).toBeTruthy();
    expect(container.querySelector('.dfg-spinner')).not.toBeNull();
  });
});

describe('Toast（F11：底部居中胶囊 + 内嵌撤销）', () => {
  function Host({ duration }: { duration?: number }) {
    const toast = useToast();
    return (
      <Button
        onClick={() => {
          toast.show({
            message: '已删除 3 个图层',
            tone: 'success',
            duration: duration ?? 0,
            action: { label: '撤销', onActivate: () => toast.show({ message: '已撤销' }) },
          });
        }}
      >
        触发
      </Button>
    );
  }

  it('弹出胶囊与内嵌撤销动作，动作触发后消失', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Host />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '触发' }));
    expect(screen.getByText('已删除 3 个图层')).toBeTruthy();
    const region = screen.getByRole('status');
    expect(region.className).toContain('dfg-toast-region');
    expect(screen.getByText('已删除 3 个图层').closest('.dfg-toast')?.className).toContain(
      'dfg-toast--success',
    );
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('已撤销')).toBeTruthy();
    expect(screen.queryByText('已删除 3 个图层')).toBeNull();
  });

  it('到时自动消失', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Host duration={4000} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '触发' }));
    expect(screen.getByText('已删除 3 个图层')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('已删除 3 个图层')).toBeNull();
    vi.useRealTimers();
  });

  it('错误语义用 alert 角色播报', async () => {
    const user = userEvent.setup();
    function ErrorHost() {
      const toast = useToast();
      return (
        <Button
          onClick={() => {
            toast.show({ message: '导出失败', tone: 'error', duration: 0 });
          }}
        >
          触发错误
        </Button>
      );
    }
    render(
      <ToastProvider>
        <ErrorHost />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '触发错误' }));
    expect(screen.getByRole('alert').textContent).toContain('导出失败');
  });

  it('Provider 外使用 useToast 直接报错（避免静默丢消息）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Host />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
