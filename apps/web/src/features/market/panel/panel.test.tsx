// @vitest-environment jsdom
/**
 * 编辑器内市场面板测试（接缝：`MarketPanel` 的可观测行为，D5）。
 *
 * 断言：面板列表逐项可选、选中项详情可见、试跑是 dryRun（只有说明与本地计数，没有执行结果）、
 * 采纳只累加本地计数且仅看资产被禁用、深色族取样名与「打开详情」入口齐备。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAsset } from '../__fixtures__/market';
import { MarketPanel } from './MarketPanel';

afterEach(() => {
  cleanup();
});

function setup(overrides: Partial<Parameters<typeof MarketPanel>[0]> = {}) {
  const onRun = vi.fn();
  const onAdopt = vi.fn();
  const onSelect = vi.fn();
  const onOpenDetail = vi.fn();
  const assets = [
    makeAsset({ id: 'a', displayName: { 'zh-CN': '甲资源' }, summary: { 'zh-CN': '甲的一句话' } }),
    makeAsset({
      id: 'b',
      displayName: { 'zh-CN': '乙资源' },
      summary: { 'zh-CN': '乙的一句话' },
      installGate: {
        mode: 'view-only',
        licenseGate: 'view-only',
        security: 'pass',
        reasons: [],
        ackRequired: [],
      },
    }),
  ];
  const view = render(
    <MarketPanel
      assets={assets}
      loadedIds={[]}
      feedback={[]}
      selectedId={null}
      onRun={onRun}
      onAdopt={onAdopt}
      onSelect={onSelect}
      onOpenDetail={onOpenDetail}
      {...overrides}
    />,
  );
  return { onRun, onAdopt, onSelect, onOpenDetail, container: view.container };
}

describe('MarketPanel · 列表与详情（D5）', () => {
  it('深色族与页面取样名齐备；列表逐项渲染，默认选中第一项', () => {
    const { container } = setup();
    expect(container.querySelector('[data-df-page="market-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-df-theme="dark"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-df-market="panel-row"]')).toHaveLength(2);
    expect(container.querySelector('[data-df-market="panel-row"]')?.textContent).toContain(
      '甲资源',
    );
    // 默认选中第一项：详情区显示甲的一句话
    expect(container.querySelector('[data-df-market="panel-detail"]')?.textContent).toContain(
      '甲的一句话',
    );
  });

  it('点另一行回传 onSelect', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole('button', { name: /乙资源/ }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('试跑：回传 onRun 且详情区声明 dryRun 无副作用（不显示执行结果）', async () => {
    const user = userEvent.setup();
    const { onRun, container } = setup();
    expect(screen.getByText(/试跑默认 dryRun/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '试跑（dryRun）' }));
    expect(onRun).toHaveBeenCalledWith('a');
    expect(container.textContent).not.toContain('执行完成');
  });

  it('采纳：回传 onAdopt；仅看资产按钮灰化（不可采纳）', async () => {
    const user = userEvent.setup();
    const { onAdopt, container } = setup({ selectedId: 'b' });
    const adopt = container.querySelector('[data-df-market="panel-adopt"]');
    expect(adopt?.hasAttribute('disabled')).toBe(true);
    await user.click(adopt as Element);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it('本地计数如实显示（0 也显示，不隐藏、不冒充云端聚合）', () => {
    const { container } = setup({
      feedback: [{ assetId: 'a', runs: 3, adoptions: 1, lastAt: '2026-10-15T10:00:00Z' }],
    });
    expect(container.textContent).toContain('本地计数：试跑 3 · 采纳 1');
  });

  it('装载门提示与「打开详情」入口齐备（写事务不另开旁路）', async () => {
    const user = userEvent.setup();
    const { onOpenDetail } = setup();
    expect(screen.getByText(/装载门（三态）：装载/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '打开详情' }));
    expect(onOpenDetail).toHaveBeenCalledWith('a');
  });

  it('无资源时给空态说明（不渲染空详情）', () => {
    const { container } = setup({ assets: [] });
    expect(container.querySelector('[data-df-market="panel-detail"]')).toBeNull();
    expect(screen.getByText(/当前没有可展示的资源/)).toBeTruthy();
  });
});
