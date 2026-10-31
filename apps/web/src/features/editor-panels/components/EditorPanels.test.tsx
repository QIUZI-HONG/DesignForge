// @vitest-environment jsdom
/**
 * 左栏组合测试（seam：页签在「图层 / 资产」间切换，两面板共存于同一会话；
 * 扩展页签走槽位注册表 `left-panel-tabs`——票 16「编辑器内市场面板入口」的挂载缝）。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerEditorSlotItem, resetEditorSlots } from '@/features/editor-shell';

import { createFixtureSession } from '../test-utils';
import { EditorPanels } from './EditorPanels';
import { PanelsProvider } from './panels-context';

afterEach(() => {
  resetEditorSlots();
});

describe('编辑器左栏（图层 / 资产双页签）', () => {
  it('默认「图层」页签；切到「资产」再切回，两个面板共用同一会话', () => {
    const session = createFixtureSession();
    render(
      <PanelsProvider session={session}>
        <EditorPanels />
      </PanelsProvider>,
    );

    expect(document.querySelector('[data-df-panel-group="editor-panels"]')).not.toBeNull();
    expect(document.querySelector('[data-df-panel="layers"]')).not.toBeNull();
    expect(document.querySelector('[data-df-panel="assets"]')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '资产' }));
    expect(document.querySelector('[data-df-panel="layers"]')).toBeNull();
    expect(document.querySelector('[data-df-panel="assets"]')).not.toBeNull();
    // 组合态隐藏了面板自带标题（页签即标题）
    expect(screen.getAllByText('资产')).toHaveLength(1);

    // 跨页签的 UI 态保留：资产搜索词在切回图层后再切回来仍在
    fireEvent.change(screen.getByPlaceholderText('搜索资产'), { target: { value: '按钮' } });
    fireEvent.click(screen.getByRole('radio', { name: '图层' }));
    expect(document.querySelector('[data-df-panel="layers"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '资产' }));
    expect((screen.getByPlaceholderText('搜索资产') as HTMLInputElement).value).toBe('按钮');
  });

  it('loading/error 态透传给当前页签的面板', () => {
    render(
      <PanelsProvider session={createFixtureSession()}>
        <EditorPanels loading />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="layers/loading"]')).not.toBeNull();
  });
});

describe('编辑器左栏 · 扩展页签（槽位注册，票 16）', () => {
  /** 挂一个「市场」扩展页签（label/render 由注册项提供；render 用 spy 便于断言惰性渲染）。 */
  function mountWithMarketExtension() {
    const renderPanel = vi.fn(() => <section data-df-test="extension-body">市场面板体</section>);
    const unregister = registerEditorSlotItem('left-panel-tabs', {
      id: 'p2-market',
      order: 0,
      label: () => '市场',
      render: renderPanel,
    });
    const session = createFixtureSession();
    render(
      <PanelsProvider session={session}>
        <EditorPanels />
      </PanelsProvider>,
    );
    return { session, renderPanel, unregister };
  }

  it('扩展页签进页签族（排在内置页签之后）；未选中时不渲染面板体', () => {
    const { renderPanel } = mountWithMarketExtension();
    expect(screen.getByRole('radio', { name: '图层' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '资产' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '市场' })).toBeTruthy();
    // 内置页签之后是扩展页签（图层、资产、市场的 DOM 顺序）
    const radios = screen.getAllByRole('radio');
    expect(radios.map((node) => node.value)).toEqual(['layers', 'assets', 'p2-market']);
    // 默认图层页签：市场面板体不渲染（render 未被调用）
    expect(renderPanel).not.toHaveBeenCalled();
    expect(document.querySelector('[data-df-test="extension-body"]')).toBeNull();
  });

  it('点「市场」打开市场面板体；关闭后回到打开前的原页签（资产），无状态残留', () => {
    const { session, renderPanel } = mountWithMarketExtension();
    // 原页签 = 资产
    fireEvent.click(screen.getByRole('radio', { name: '资产' }));
    expect(document.querySelector('[data-df-panel="assets"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '市场' }));
    // 打开：面板体渲染，内置面板卸载，出现「关闭」入口
    expect(renderPanel).toHaveBeenCalled();
    expect(document.querySelector('[data-df-panel="assets"]')).toBeNull();
    expect(document.querySelector('[data-df-test="extension-body"]')).not.toBeNull();
    const close = document.querySelector('[data-df-panel-action="close-extension"]');
    expect(close).not.toBeNull();

    fireEvent.click(close as Element);
    // 关闭：回到打开前的「资产」页签，扩展面板体卸载
    expect(document.querySelector('[data-df-panel="assets"]')).not.toBeNull();
    expect(document.querySelector('[data-df-test="extension-body"]')).toBeNull();
    expect(session.ui.getState().leftTab).toBe('assets');
    expect(session.ui.getState().leftExtensionTab).toBeNull();
  });

  it('扩展页签打开时点内置页签 = 切页签并关闭扩展（无需先关闭）', () => {
    const { session } = mountWithMarketExtension();
    fireEvent.click(screen.getByRole('radio', { name: '市场' }));
    fireEvent.click(screen.getByRole('radio', { name: '图层' }));
    expect(document.querySelector('[data-df-panel="layers"]')).not.toBeNull();
    expect(session.ui.getState().leftExtensionTab).toBeNull();
  });

  it('扩展页签的打开态不影响跨页签 UI 态（原页签下的资产搜索词原样保留）', () => {
    const { session } = mountWithMarketExtension();
    fireEvent.click(screen.getByRole('radio', { name: '资产' }));
    fireEvent.change(screen.getByPlaceholderText('搜索资产'), { target: { value: '按钮' } });
    fireEvent.click(screen.getByRole('radio', { name: '市场' }));
    fireEvent.click(screen.getByRole('radio', { name: '资产' }));
    expect((screen.getByPlaceholderText('搜索资产') as HTMLInputElement).value).toBe('按钮');
    expect(session.ui.getState().leftExtensionTab).toBeNull();
  });

  it('扩展页签未注册（如热重载后）：打开态自愈回内置页签，不渲染任何面板体', () => {
    const session = createFixtureSession();
    act(() => {
      session.ui.getState().openLeftExtensionTab('p2-market');
    });
    render(
      <PanelsProvider session={session}>
        <EditorPanels />
      </PanelsProvider>,
    );
    // 找不到注册项 → 回退内置「图层」页签体
    expect(document.querySelector('[data-df-panel="layers"]')).not.toBeNull();
    expect(session.ui.getState().leftExtensionTab).toBe('p2-market');
  });
});
