// @vitest-environment jsdom
/**
 * 面板入口 DOM 回归（修复批次 4 · 工作包 D1 · D-6/UX-10）。
 *
 * 缺陷现场：AI 抽屉受控开合无触发点；出图面板未被任何页面挂载（组件齐但用户拿不到）。
 * 本测试锁两条用户可达路径的 DOM 事实（真实浏览器路径由 `verify-ai-two-state` /
 * `verify-image-two-state` 的 UI 段承担）：
 * 1. 右栏四页签（检查/代码/导出/**出图**）：选「出图」→ `ImagePanel` 抽屉挂载
 *    （`data-df-panel="image"`）；Esc 关闭 → 页签回到「检查」；
 * 2. 工具栏 AI 入口按钮：点击开合 `AiDrawer`（`data-df-panel="ai"`），`aria-pressed` 跟随。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { resetCommandRegistry } from '@/features/editor-shell';

import { registerWorkspaceCommands } from '../register';
import { AiEntryButton, OverlaysSlot, RightPanelSlot } from './slots';
import { useWorkspaceUi } from './ui-state';
import { resetWorkspace } from './workspace-session';

afterEach(() => {
  resetWorkspace();
  resetCommandRegistry();
  useWorkspaceUi.setState({ rightPanelTab: 'inspect', aiDrawerOpen: false });
});

/** 取分段控件的某个页签（标签文本 + 隐藏的原生单选）。 */
function tabInput(value: string): HTMLInputElement | null {
  return document.querySelector(`input[type="radio"][value="${value}"]`);
}

describe('右栏页签 · 出图（D1）', () => {
  it('四页签齐；选「出图」→ ImagePanel 抽屉挂载（data-df-panel=image）', async () => {
    render(<RightPanelSlot />);
    expect(tabInput('inspect')).not.toBeNull();
    expect(tabInput('code')).not.toBeNull();
    expect(tabInput('export')).not.toBeNull();
    const image = tabInput('image');
    expect(image).not.toBeNull();
    expect(document.body.textContent).toContain('出图');
    expect(document.querySelector('[data-df-panel="image"]')).toBeNull();
    await userEvent.click(image as HTMLInputElement);
    expect(useWorkspaceUi.getState().rightPanelTab).toBe('image');
    expect(document.querySelector('[data-df-panel="image"]')).not.toBeNull();
  });

  it('关闭出图抽屉（Esc）→ 页签回到「检查」且面板卸载', async () => {
    render(<RightPanelSlot />);
    await userEvent.click(tabInput('image') as HTMLInputElement);
    expect(document.querySelector('[data-df-panel="image"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(useWorkspaceUi.getState().rightPanelTab).toBe('inspect');
    expect(document.querySelector('[data-df-panel="image"]')).toBeNull();
  });
});

describe('工具栏 AI 入口（D1）', () => {
  it('点入口按钮 → AI 抽屉打开（data-df-panel=ai）且按钮 aria-pressed；再点 → 关闭', async () => {
    // 入口按钮执行 `view.ai` 命令（生产由编辑器引导注册表执行 `mountEditorWorkspace`
    // 注册，见 app/editor/editor-bootstrap.tsx；这里按同一装配直接登记）
    registerWorkspaceCommands();
    render(
      <>
        <AiEntryButton />
        <OverlaysSlot />
      </>,
    );
    const entry = screen.getByRole('button', { name: '设界 AI' });
    expect(entry.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-df-panel="ai"]')).toBeNull();
    await userEvent.click(entry);
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(true);
    expect(document.querySelector('[data-df-panel="ai"]')).not.toBeNull();
    expect(entry.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(entry);
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(false);
    expect(document.querySelector('[data-df-panel="ai"]')).toBeNull();
  });
});
