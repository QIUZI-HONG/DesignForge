// @vitest-environment jsdom
/**
 * 壳层内置命令行为测试。
 *
 * 断言「命令 → UI 态」这条链路（命令面板与快捷键都只会触发 run）：
 * 工具命令切 activeTool、缩放命令改 zoom 并闪 HUD、注册/反注册成对。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canvasHud, getCanvasHudSnapshot } from '../hud/controller';
import { useEditorUi } from '../state/ui';
import { currentZoomPercent, useEditorView } from '../state/view';
import { EDITOR_TOOLS } from '../tools';
import { builtinCommands, registerBuiltinCommands } from './builtins';
import { getCommand, resetCommandRegistry } from './registry';

afterEach(() => {
  resetCommandRegistry();
  canvasHud.hide();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

describe('builtinCommands', () => {
  it('工具命令齐备：每个工具一条，带展示快捷键与分组', () => {
    const commands = builtinCommands();
    for (const tool of EDITOR_TOOLS) {
      const command = commands.find((item) => item.id === `tool.${tool.id}`);
      expect(command, `缺工具命令：${tool.id}`).toBeDefined();
      expect(command?.shortcut).toBe(tool.shortcut);
      expect(command?.group).toBe('工具');
    }
  });

  it('工具命令：切换 activeTool；已是当前工具时置灰', async () => {
    const commands = builtinCommands();
    const rect = commands.find((item) => item.id === 'tool.rect');
    expect(rect).toBeDefined();
    expect(rect?.enabled?.()).toBe(true); // 当前是 move

    await rect?.run();
    expect(useEditorView.getState().activeTool).toBe('rect');
    expect(rect?.enabled?.()).toBe(false); // 现在是 rect → 置灰
  });

  it('缩放命令：改 zoom 并闪 HUD 百分比；到档位尽头不闪', async () => {
    const commands = builtinCommands();
    const zoomIn = commands.find((item) => item.id === 'view.zoomIn');
    await zoomIn?.run();
    expect(useEditorView.getState().zoom).toBe(1.5); // 引擎档位表：1 → 1.5
    expect(getCanvasHudSnapshot().text).toBe('150%');

    canvasHud.hide();
    useEditorView.setState({ zoom: 1 });
    const zoom100 = commands.find((item) => item.id === 'view.zoom100');
    await zoom100?.run();
    expect(currentZoomPercent()).toBe(100);
    // 已在 100% → 无变化 → 不闪提示
    expect(getCanvasHudSnapshot().text).toBeNull();
  });

  it('视图命令：命令面板与快捷键说明各自开浮层', async () => {
    const commands = builtinCommands();
    await commands.find((item) => item.id === 'view.commandPalette')?.run();
    expect(useEditorUi.getState().commandPaletteOpen).toBe(true);

    await commands.find((item) => item.id === 'help.shortcuts')?.run();
    expect(useEditorUi.getState().shortcutsOpen).toBe(true);
  });

  it('不含需要画布真值的命令（zoomFit 归 FE-06；入口禁用而非假动作）', () => {
    const ids = builtinCommands().map((item) => item.id);
    expect(ids).not.toContain('view.zoomFit');
    expect(ids).not.toContain('edit.undo');
  });

  it('registerBuiltinCommands：注册全部，反注册后清空', () => {
    const unregister = registerBuiltinCommands();
    expect(getCommand('tool.move')).toBeDefined();
    expect(getCommand('view.zoomIn')).toBeDefined();
    expect(getCommand('help.shortcuts')).toBeDefined();

    unregister();
    expect(getCommand('tool.move')).toBeUndefined();
    expect(getCommand('view.zoomIn')).toBeUndefined();
  });
});
