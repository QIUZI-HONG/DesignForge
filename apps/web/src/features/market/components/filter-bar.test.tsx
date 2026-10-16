// @vitest-environment jsdom
/**
 * 筛选栏测试（接缝：`FilterBar` 受控行为）。
 *
 * 断言：搜索输入、一级标签、二级（市场|已装载）、排序/类别/泳道/许可档下拉、
 * 场景 chips、仅已装载开关、清空筛选与结果计数——每一项都把 patch 回传给页面。
 * 不测下拉内部实现（用真实交互：点触发 → 点条目）。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_MARKET_FILTERS, type MarketFilters } from '../filters';
import { FilterBar } from './FilterBar';

afterEach(() => {
  cleanup();
});

function setup(overrides: Partial<MarketFilters> = {}) {
  const onChange = vi.fn();
  const onInstalledViewChange = vi.fn();
  const onClear = vi.fn();
  const filters: MarketFilters = { ...INITIAL_MARKET_FILTERS, ...overrides };
  render(
    <FilterBar
      filters={filters}
      scenes={['ppt-design', 'web-app']}
      installedView={false}
      total={12}
      globalTotal={12}
      loadableCount={9}
      generatedAt="2026-10-15T22:40:00Z"
      onChange={onChange}
      onInstalledViewChange={onInstalledViewChange}
      onClear={onClear}
    />,
  );
  return { onChange, onInstalledViewChange, onClear };
}

describe('FilterBar · 搜索与一级标签（D1/D3）', () => {
  it('搜索输入回传 query（受控）', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.type(screen.getByLabelText('搜索市场资源'), '闪');
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ query: '闪' });
  });

  it('一级标签切换回传 kind，且当前项 aria-pressed', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: '设计系统' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'design-system' });
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('二级标签切到「已装载」', async () => {
    const user = userEvent.setup();
    const { onInstalledViewChange } = setup();
    await user.click(screen.getByRole('radio', { name: '已装载' }));
    expect(onInstalledViewChange).toHaveBeenCalledWith(true);
  });
});

describe('FilterBar · 下拉与客户端过滤项', () => {
  it('排序下拉回传 sort', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: '排序：综合评分' }));
    await user.click(screen.getByRole('menuitem', { name: '最近更新' }));
    expect(onChange).toHaveBeenCalledWith({ sort: 'updated' });
  });

  it('许可档下拉回传 licenseGate（仅看）', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: '许可档：全部' }));
    await user.click(screen.getByRole('menuitem', { name: '仅看' }));
    expect(onChange).toHaveBeenCalledWith({ licenseGate: 'view-only' });
  });

  it('来源仓库输入回传 repo；仅已装载开关回传 loadedOnly', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.type(screen.getByLabelText('来源仓库'), 'a');
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ repo: 'a' });
    await user.click(screen.getByRole('button', { name: '仅已装载' }));
    expect(onChange).toHaveBeenCalledWith({ loadedOnly: true });
  });

  it('场景 chips 点击回传 scene，再点取消（null）', async () => {
    const user = userEvent.setup();
    const first = setup();
    await user.click(screen.getByRole('button', { name: 'ppt-design' }));
    expect(first.onChange).toHaveBeenCalledWith({ scene: 'ppt-design' });
    cleanup();
    const second = setup({ scene: 'ppt-design' });
    await user.click(screen.getByRole('button', { name: 'ppt-design' }));
    expect(second.onChange).toHaveBeenCalledWith({ scene: null });
  });
});

describe('FilterBar · 清空与计数', () => {
  it('无筛选时不显示清空按钮', () => {
    setup();
    expect(screen.queryByRole('button', { name: '清空筛选' })).toBeNull();
  });

  it('有筛选时显示清空按钮与计数，点击回传 onClear', async () => {
    const user = userEvent.setup();
    const { onClear } = setup({ query: 'pdf', kind: 'skill' });
    expect(screen.getByText('已选 2 项筛选')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('总数与可装载数展示；索引缺失（total=null）时显示加载态而不是「0 个资源」', () => {
    setup();
    expect(screen.getByText('共 12 个资源 · 可装载 9 个')).toBeTruthy();
    cleanup();
    render(
      <FilterBar
        filters={INITIAL_MARKET_FILTERS}
        scenes={[]}
        installedView={false}
        total={null}
        globalTotal={null}
        loadableCount={null}
        generatedAt={null}
        onChange={vi.fn()}
        onInstalledViewChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('正在加载市场索引…')).toBeTruthy();
  });

  it('daemon 不可达（countUnavailable）时统计显示「—」，不显示 0、也不说「正在加载」（UX-19）', () => {
    render(
      <FilterBar
        filters={INITIAL_MARKET_FILTERS}
        scenes={[]}
        installedView={false}
        total={null}
        globalTotal={null}
        loadableCount={null}
        generatedAt={null}
        countUnavailable
        onChange={vi.fn()}
        onInstalledViewChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('正在加载市场索引…')).toBeNull();
  });

  it('筛选后统计行区分「全局 N / 当前结果 M」（0 不冒充全量口径）', () => {
    render(
      <FilterBar
        filters={{ ...INITIAL_MARKET_FILTERS, category: '设计系统' }}
        scenes={[]}
        installedView={false}
        total={0}
        globalTotal={344}
        loadableCount={298}
        generatedAt={null}
        onChange={vi.fn()}
        onInstalledViewChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('全局 344 个资源（可装载 298 个）· 当前结果 0 个')).toBeTruthy();
    // 不再混说成「共 0 个资源 · 可装载 298 个」
    expect(screen.queryByText('共 0 个资源 · 可装载 298 个')).toBeNull();
  });
});
