// @vitest-environment jsdom
/**
 * 首页状态视图测试（FE-02 · B7 空态三态 / B8 加载骨架 / F14 错误态）。
 *
 * 验收标准 §5 的 empty / loading / error 三态在首页的直接取证挂点：
 * 每态都要有可观测的标题、说明与动作（主按钮 / 重试），并且动作能回调到父级。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  HomeEmptyState,
  HomeErrorState,
  HomeListSkeleton,
  HomeWarnings,
  SKELETON_CARD_COUNT,
} from './HomeStateViews';

describe('HomeListSkeleton（B8 加载态）', () => {
  it('骨架按 B8「卡片骨架 3–5 块」渲染，并对读屏声明载入中', () => {
    const { container } = render(<HomeListSkeleton />);
    expect(SKELETON_CARD_COUNT).toBeGreaterThanOrEqual(3);
    expect(SKELETON_CARD_COUNT).toBeLessThanOrEqual(5);
    expect(container.querySelectorAll('.dfg-skeleton__card')).toHaveLength(SKELETON_CARD_COUNT);
    expect(screen.getByRole('status', { name: '正在载入文档' })).toBeDefined();
  });
});

describe('HomeEmptyState（B7 三态空态）', () => {
  it('无文件：标题 + 说明 + 新建主按钮', async () => {
    const onCreate = vi.fn();
    render(<HomeEmptyState kind="documents" onCreate={onCreate} />);
    expect(screen.getByText('还没有设计文件')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '新建设计文件' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('搜索无果：标题 + 清除筛选动作', async () => {
    const onClearFilters = vi.fn();
    render(<HomeEmptyState kind="search" onClearFilters={onClearFilters} />);
    expect(screen.getByText('没有找到相关文件')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '清除筛选条件' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('回收站空：标题 + 返回本地文档动作', async () => {
    const onExitTrash = vi.fn();
    render(<HomeEmptyState kind="trash" onExitTrash={onExitTrash} />);
    expect(screen.getByText('回收站为空')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '返回本地文档' }));
    expect(onExitTrash).toHaveBeenCalledTimes(1);
  });
});

describe('HomeErrorState（F14 错误态）', () => {
  it('标题 + 错误码 + 重试按钮', async () => {
    const onRetry = vi.fn();
    render(
      <HomeErrorState
        code="E_DF_DAEMON_UNREACHABLE"
        description="本地服务不可达。"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('无法连接本地服务')).toBeDefined();
    expect(screen.getByText('E_DF_DAEMON_UNREACHABLE')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('重试中：按钮进入加载态（aria-busy）', () => {
    render(<HomeErrorState retrying onRetry={() => {}} retryLabel="重试" />);
    const retry = screen.getByRole('button', { name: '重试' });
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.hasAttribute('disabled')).toBe(true);
  });
});

describe('HomeWarnings（列表告警）', () => {
  it('有告警时显示条数与说明', () => {
    render(
      <HomeWarnings
        warnings={[
          { id: '损坏目录', code: 'manifest_invalid', message: 'manifest 非法' },
          { id: '另一个', code: 'manifest_unreadable', message: '读不到' },
        ]}
      />,
    );
    expect(screen.getByText('2 个目录未能读取')).toBeDefined();
  });

  it('无告警时不渲染', () => {
    const { container } = render(<HomeWarnings warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
