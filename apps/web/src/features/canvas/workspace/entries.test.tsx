// @vitest-environment jsdom
/**
 * 入口接线（修复批次 4 · 工作包 D1/D3）——命令层可观测行为回归。
 *
 * 缺陷现场：
 * - D-6 / UX-10：AI 抽屉受控开合无触发点（无按钮、命令面板搜「AI」无匹配）；
 *   出图/诊断面板零挂载；
 * - D-7：编辑器文件菜单 `file.new` / `file.export` 无注册者 → 永久禁用（死入口）。
 *
 * 本测试锁命令层契约（DOM 与真实浏览器路径由 `slots.test.tsx` 与
 * `verify-ai-two-state` / `verify-image-two-state` 的 UI 段承担）：
 * 1. `view.ai` 已注册且开合状态可被命令写（toggle + `pressed()` 跟随）；
 * 2. `file.export` 执行后右栏切到「导出」页签；
 * 3. `file.new` 落点为首页新建入口（`?create=1`），且经单点续写 daemon 端点参数。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { executeCommand, getCommand, resetCommandRegistry } from '@/features/editor-shell';

import { newFileEntryHref, registerWorkspaceCommands } from '../register';
import { useWorkspaceUi } from './ui-state';

afterEach(() => {
  resetCommandRegistry();
  useWorkspaceUi.setState({ rightPanelTab: 'inspect', aiDrawerOpen: false });
  window.history.replaceState(null, '', '/editor');
});

describe('view.ai · AI 抽屉入口（D-6 / UX-10）', () => {
  it('命令已注册；执行一次打开、再执行一次关闭（开合状态可被命令写）', async () => {
    registerWorkspaceCommands();
    expect(getCommand('view.ai')).toBeDefined();
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(false);
    await executeCommand('view.ai');
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(true);
    await executeCommand('view.ai');
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(false);
  });

  it('pressed() 跟随开合状态（入口 aria-pressed 的依据）', async () => {
    registerWorkspaceCommands();
    expect(getCommand('view.ai')?.pressed?.()).toBe(false);
    await executeCommand('view.ai');
    expect(getCommand('view.ai')?.pressed?.()).toBe(true);
  });
});

describe('file.export · 导出入口（D-7）', () => {
  it('命令已注册（AppMenu 条目据此点亮），执行后右栏切到「导出」页签', async () => {
    registerWorkspaceCommands();
    expect(getCommand('file.export')).toBeDefined();
    await executeCommand('file.export');
    expect(useWorkspaceUi.getState().rightPanelTab).toBe('export');
  });
});

describe('file.new · 新建入口（D-7）', () => {
  it('命令已注册且可用；落点为首页新建入口（?create=1 自动打开新建对话框）', () => {
    registerWorkspaceCommands();
    expect(getCommand('file.new')).toBeDefined();
    expect(getCommand('file.new')?.enabled?.() ?? true).toBe(true);
    expect(newFileEntryHref()).toBe('/?create=1');
  });

  it('当前页带 ?daemon= 时落点续写端点参数（与 B 包同一保参口径）', () => {
    const endpoint = 'http://127.0.0.1:4999';
    window.history.replaceState(null, '', `/editor?daemon=${encodeURIComponent(endpoint)}`);
    expect(newFileEntryHref()).toBe(`/?create=1&daemon=${encodeURIComponent(endpoint)}`);
  });
});
