// @vitest-environment jsdom
/**
 * 资产面板组件测试（seam：分段/搜索/卡片/令牌列表与四种状态的可观测行为）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createFixtureSession, manyLayersDocument } from '../test-utils';
import { AssetsPanel } from './AssetsPanel';
import { PanelsProvider } from './panels-context';

/** 渲染资产面板（默认夹具：1 个主组件 + 3 个令牌）。 */
function renderAssets(
  options: { loading?: boolean; error?: string | null; onRetry?: () => void } = {},
) {
  const session = createFixtureSession();
  render(
    <PanelsProvider session={session}>
      <AssetsPanel {...options} />
    </PanelsProvider>,
  );
  return { session };
}

describe('资产面板', () => {
  it('默认「组件」分段：渲染组件卡（名称 + 实例数），卡片是按钮且带取样属性', () => {
    renderAssets();
    expect(screen.getByRole('radiogroup', { name: '资产分段' })).toBeTruthy();
    const card = screen.getByRole('button', { name: '按钮' });
    expect(card.getAttribute('data-df-asset-component')).toBe('c1');
    expect(screen.getByText('0 个实例')).toBeTruthy();
    expect(
      document.querySelector('[data-df-panel="assets"]')?.getAttribute('data-df-segment'),
    ).toBe('components');
  });

  it('切到「Token」分段：列出令牌（别名已解析成字面值），点回「组件」再变回来', () => {
    renderAssets();
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
    expect(document.querySelector('[data-df-asset-token="color.brand.primary"]')).not.toBeNull();
    // 别名 onPrimary 解析到 primary 的值
    const aliasRow = document.querySelector('[data-df-asset-token="color.brand.onPrimary"]');
    expect(aliasRow?.textContent).toContain('#0D99FF');
    // 非颜色令牌不带色块着色
    const dimension = document.querySelector('[data-df-asset-token="space.md"]');
    expect(dimension?.querySelector('[data-df-token-swatch="plain"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '组件' }));
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();
  });

  it('点组件卡 → 写入选择集（与画布同源）并标记 aria-pressed', () => {
    const { session } = renderAssets();
    fireEvent.click(screen.getByRole('button', { name: '按钮' }));
    expect(session.ui.getState().selection).toEqual({ ids: ['c1'], activeId: 'c1' });
    expect(screen.getByRole('button', { name: '按钮' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('搜索过滤：命中保留、无果给「没有匹配的资产」挂点；清空后恢复', () => {
    renderAssets();
    const search = screen.getByPlaceholderText('搜索资产');
    fireEvent.change(search, { target: { value: '按' } });
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();

    fireEvent.change(search, { target: { value: '不存在的东西' } });
    expect(screen.queryByRole('button', { name: '按钮' })).toBeNull();
    expect(screen.getByText('没有匹配的资产')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/no-results"]')).not.toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();
  });

  it('无组件空态：没有主组件的文档给空态文案与挂点', () => {
    const session = createFixtureSession(manyLayersDocument(3));
    render(
      <PanelsProvider session={session}>
        <AssetsPanel />
      </PanelsProvider>,
    );
    expect(screen.getByText('还没有组件')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/empty"]')).not.toBeNull();
  });

  it('无令牌空态：文档没有设计令牌时 Token 分段给专属空态', () => {
    const session = createFixtureSession(manyLayersDocument(2));
    render(
      <PanelsProvider session={session}>
        <AssetsPanel />
      </PanelsProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
    expect(screen.getByText('还没有设计令牌')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/tokens-empty"]')).not.toBeNull();
  });

  it('加载态与错误态：骨架挂点 / 错误挂点 + 重试回调', () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <PanelsProvider session={createFixtureSession()}>
        <AssetsPanel loading />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="assets/loading"]')).not.toBeNull();
    unmount();

    render(
      <PanelsProvider session={createFixtureSession()}>
        <AssetsPanel error="加载失败" onRetry={onRetry} />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="assets/error"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('组件卡颜色：缩略图用组件紫令牌（禁裸值的语义色）', () => {
    renderAssets();
    const card = screen.getByRole('button', { name: '按钮' });
    const thumb = card.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(thumb.style.color).toBe('var(--dfg-color-component)');
  });

  it('面板边界与语义：具名 region「资产」（截图门禁按面板边界取样）', () => {
    renderAssets();
    expect(screen.getByRole('region', { name: '资产' })).toBeTruthy();
  });
});
