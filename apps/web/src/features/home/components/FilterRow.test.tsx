// @vitest-environment jsdom
/**
 * 筛选行测试（FE-02 · B4）。
 *
 * 断言可观测行为：两个下拉（时间范围 / 排序）带当前值与无障碍名、选择后回调、
 * 视图切换是单选组（radiogroup）且切换回调、结果计数如实展示。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FilterRow } from './FilterRow';

function renderFilterRow(overrides: Partial<Parameters<typeof FilterRow>[0]> = {}) {
  const props = {
    range: 'all' as const,
    onRangeChange: vi.fn(),
    sort: 'updated-desc' as const,
    onSortChange: vi.fn(),
    viewMode: 'grid' as const,
    onViewModeChange: vi.fn(),
    resultCount: 3,
    ...overrides,
  };
  render(<FilterRow {...props} />);
  return props;
}

describe('FilterRow', () => {
  it('下拉触发器带当前值（时间范围：全部 / 排序：最近更新）', () => {
    renderFilterRow();
    expect(screen.getByRole('button', { name: '时间范围：全部' })).toBeDefined();
    expect(screen.getByRole('button', { name: '排序：最近更新' })).toBeDefined();
  });

  it('选择时间范围 → 回调对应取值', async () => {
    const props = renderFilterRow();
    await userEvent.click(screen.getByRole('button', { name: '时间范围：全部' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '最近 7 天' }));
    expect(props.onRangeChange).toHaveBeenCalledWith('week');
  });

  it('选择排序 → 回调对应取值', async () => {
    const props = renderFilterRow({ sort: 'updated-desc' });
    await userEvent.click(screen.getByRole('button', { name: '排序：最近更新' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '名称' }));
    expect(props.onSortChange).toHaveBeenCalledWith('name-asc');
  });

  it('视图切换是单选组，切到列表 → 回调 list', async () => {
    const props = renderFilterRow();
    expect(screen.getByRole('radiogroup', { name: '视图' })).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: '列表' }));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('结果计数如实展示', () => {
    renderFilterRow({ resultCount: 7 });
    expect(screen.getByText('7 个文档')).toBeDefined();
  });
});
