// @vitest-environment jsdom
/**
 * 左栏组合测试（seam：页签在「图层 / 资产」间切换，两面板共存于同一会话）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFixtureSession } from '../test-utils';
import { EditorPanels } from './EditorPanels';
import { PanelsProvider } from './panels-context';

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
