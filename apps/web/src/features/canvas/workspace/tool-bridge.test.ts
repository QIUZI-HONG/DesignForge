// @vitest-environment jsdom
/**
 * 工具接线（D-1 / UX-02）——「工具态以画布会话为唯一真源」的回归缝。
 *
 * 缺陷现场：`/editor` 上点工具栏按钮 / 按工具快捷键只改外壳视图态（`setActiveTool`），
 * 画布会话从未收到 `setTool` → 拖画不落节点且零反馈。
 *
 * 本测试锁三条可观测行为：
 * 1. 外壳工具 → 画布工具的映射是双射（无遗漏、无错位）；
 * 2. 执行 `tool.<id>` 命令后，**画布会话与外壳视图态都切到该工具**（唯一真源 + 高亮跟随）；
 * 3. 画布会话自行改工具（拖画后自动回选择工具）时，外壳高亮跟着回退。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  EDITOR_TOOLS,
  executeCommand,
  getCommand,
  resetCommandRegistry,
  useEditorView,
} from '@/features/editor-shell';

import {
  canvasToolForShellTool,
  connectToolSync,
  registerWorkspaceToolCommands,
  shellToolForCanvasTool,
} from './tool-bridge';
import { createEditorWorkspace, EMPTY_PRESET } from './workspace-session';

afterEach(() => {
  resetCommandRegistry();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
});

describe('工具映射（外壳 ⇄ 画布）', () => {
  it('外壳「移动工具」= 画布「选择工具」；其余同名直通', () => {
    expect(canvasToolForShellTool('move')).toBe('select');
    expect(canvasToolForShellTool('rect')).toBe('rect');
    expect(canvasToolForShellTool('ellipse')).toBe('ellipse');
    expect(canvasToolForShellTool('frame')).toBe('frame');
    expect(canvasToolForShellTool('text')).toBe('text');
    expect(canvasToolForShellTool('hand')).toBe('hand');
  });

  it('反向映射与正向互逆（每个画布工具都能回落到唯一外壳工具）', () => {
    for (const tool of EDITOR_TOOLS) {
      expect(shellToolForCanvasTool(canvasToolForShellTool(tool.id))).toBe(tool.id);
    }
  });
});

describe('tool.<id> 命令 → 画布会话（唯一真源）', () => {
  it('执行命令后画布会话与外壳视图态同时切到该工具', async () => {
    const workspace = createEditorWorkspace(EMPTY_PRESET);
    // 生产的成对装配：命令覆盖 + 外壳跟随（见 canvas/register.tsx 的 registerWorkspaceCommands）
    registerWorkspaceToolCommands(workspace);
    const dispose = connectToolSync(workspace);

    expect(workspace.canvas.store.getState().tool).toBe('select');
    expect(useEditorView.getState().activeTool).toBe('move');

    await executeCommand('tool.rect');
    expect(workspace.canvas.store.getState().tool).toBe('rect');
    expect(useEditorView.getState().activeTool).toBe('rect');

    // 已是当前工具 → 命令置灰（命令面板不可再选，与壳层默认实现同语义）
    expect(getCommand('tool.rect')?.enabled?.()).toBe(false);

    await executeCommand('tool.ellipse');
    expect(workspace.canvas.store.getState().tool).toBe('ellipse');
    expect(useEditorView.getState().activeTool).toBe('ellipse');
    dispose();
  });

  it('每个工具栏工具命令都在注册表里（与 EDITOR_TOOLS 同源，含快捷键）', () => {
    const workspace = createEditorWorkspace(EMPTY_PRESET);
    registerWorkspaceToolCommands(workspace);
    for (const tool of EDITOR_TOOLS) {
      const command = getCommand(`tool.${tool.id}`);
      expect(command, `缺工具命令：tool.${tool.id}`).toBeDefined();
      expect(command?.shortcut).toBe(tool.shortcut);
    }
  });
});

describe('画布会话 → 外壳高亮（拖画后自动回选择工具）', () => {
  it('会话侧改工具时外壳 activeTool 跟随；退订后不再跟随', () => {
    const workspace = createEditorWorkspace(EMPTY_PRESET);
    const dispose = connectToolSync(workspace);

    workspace.canvas.setTool('hand');
    expect(useEditorView.getState().activeTool).toBe('hand');

    // 拖画落节点的自然结果：会话把工具切回选择工具 → 外壳高亮必须跟着回「移动工具」
    workspace.canvas.setTool('select');
    expect(useEditorView.getState().activeTool).toBe('move');

    dispose();
    workspace.canvas.setTool('text');
    expect(useEditorView.getState().activeTool).toBe('move');
  });
});
