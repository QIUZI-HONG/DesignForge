// @vitest-environment jsdom
/**
 * 编辑器壳层集成测试（briefs/fe-03.md §4 的 vitest 清单）：
 * 顶栏插槽渲染 · 工具栏工具与 active · 缩放菜单（C16）· 快捷键说明派生（E8）·
 * HUD show/hide（冻结接口 ② 的接入面）。
 *
 * 命令面板（工单 08 起归 `features/command-palette` 域，⌘/ 呼出）的行为断言随域迁移，
 * 本文件只保留壳层自身的结构与派生断言。
 *
 * 断言走**可观测行为**（角色、文案、aria 状态、store 结果），不碰内部结构。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCommand, registerCommand, resetCommandRegistry } from '../commands/registry';
import { CanvasHudProvider, useCanvasHud } from '../hud/context';
import { canvasHud, getCanvasHudSnapshot } from '../hud/controller';
import { registerEditorSlotItem, resetEditorSlots } from '../slots/registry';
import { useEditorUi } from '../state/ui';
import { useEditorView } from '../state/view';
import { RESERVED_COMMAND_IDS } from '../tools';
import { EditorShell } from './editor-shell';

/** 画布槽探针：FE-06 的调用位（只调 show/hide）。 */
let hudProbe: ReturnType<typeof useCanvasHud> | null = null;

function CanvasProbe() {
  hudProbe = useCanvasHud();
  return <div data-testid="canvas-probe">画布</div>;
}

/** 空面板探针（验证左/右面板插槽）。 */
function PanelProbe() {
  return <div data-testid="panel-probe">面板</div>;
}

/** 挂整壳（Provider 与路由布局同构）。 */
function renderShell() {
  return render(
    <CanvasHudProvider>
      <EditorShell />
    </CanvasHudProvider>,
  );
}

beforeEach(() => {
  resetCommandRegistry();
  resetEditorSlots();
  canvasHud.hide();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  hudProbe = null;
});

afterEach(() => {
  cleanup();
  resetCommandRegistry();
  resetEditorSlots();
  useEditorView.setState({ zoom: 1, activeTool: 'move' });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
});

describe('壳层骨架（C1 / C2 / C16）', () => {
  it('顶栏三区与工具栏齐备：文件名、分享、工具、缩放 100%', () => {
    renderShell();
    expect(screen.getByText('未命名设计文件')).toBeDefined();
    expect(screen.getByText('分享')).toBeDefined();
    expect(screen.getByRole('toolbar', { name: '工具' })).toBeDefined();
    for (const tool of ['移动工具', '画板工具', '矩形工具', '文本工具', '抓手工具']) {
      expect(screen.getByRole('button', { name: tool })).toBeDefined();
    }
    expect(screen.getByText('100%')).toBeDefined();
  });

  it('内置命令在挂载后可用（命令面板/快捷键表的前提）', () => {
    expect(getCommand('view.zoomIn')).toBeUndefined();
    renderShell();
    expect(getCommand('view.zoomIn')?.shortcut).toBe('⌘+');
    // 工单 08：说明表不再占 ⌘/（该键归命令面板，见 features/command-palette/register）
    expect(getCommand('help.shortcuts')?.shortcut).toBeUndefined();
  });

  it('工具按钮点击切换当前工具（active 底随 aria-pressed 表达）', () => {
    renderShell();
    const rect = screen.getByRole('button', { name: '矩形工具' });
    expect(rect.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(rect);
    expect(useEditorView.getState().activeTool).toBe('rect');
    expect(screen.getByRole('button', { name: '矩形工具' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // 已经是当前工具 → 命令置灰（命令面板里不可选），但工具条按钮仍是选中态可点（与 Figma 一致）
    expect(getCommand('tool.rect')?.enabled?.()).toBe(false);
  });

  it('未注册命令的入口渲染为禁用（不渲染假按钮）：分享/演示/评论/版本', () => {
    renderShell();
    for (const label of ['分享', '演示', '评论', '版本历史']) {
      const entry = screen.getByRole('button', { name: label });
      expect(entry.hasAttribute('disabled'), `${label} 应为禁用`).toBe(true);
    }
  });

  it('后续票注册命令后入口自动可点（FE-07 对接形态）', () => {
    renderShell();
    const present = screen.getByRole('button', { name: '演示' });
    expect(present.hasAttribute('disabled')).toBe(true);

    act(() => {
      registerCommand({
        id: RESERVED_COMMAND_IDS.present,
        title: '演示',
        group: '视图',
        shortcut: '⌥⌘P',
        run: () => undefined,
      });
    });
    const enabled = screen.getByRole('button', { name: '演示' });
    expect(enabled.hasAttribute('disabled')).toBe(false);

    // 注册的命令同时进入快捷键说明表（同一真源；经工具条「?」入口打开）
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('⌥⌘P')).toBeDefined();
  });

  it('画布槽空态与挂载后的替换（FE-06 对接形态）', () => {
    const { rerender } = renderShell();
    expect(screen.getByText('画布待接入')).toBeDefined();

    act(() => {
      registerEditorSlotItem('canvas', { id: 'probe', render: () => <CanvasProbe /> });
    });
    rerender(
      <CanvasHudProvider>
        <EditorShell />
      </CanvasHudProvider>,
    );
    expect(screen.getByTestId('canvas-probe')).toBeDefined();
    expect(screen.queryByText('画布待接入')).toBeNull();
  });

  it('面板插槽：注册后替换空态文案', () => {
    renderShell();
    expect(screen.getByText('图层面板待接入')).toBeDefined();
    expect(screen.getByText('Inspector待接入')).toBeDefined();

    act(() => {
      registerEditorSlotItem('left-panel', { id: 'fe-04', render: () => <PanelProbe /> });
    });
    expect(screen.getByTestId('panel-probe')).toBeDefined();
    expect(screen.queryByText('图层面板待接入')).toBeNull();
  });
});

describe('缩放菜单（C16）', () => {
  it('菜单含百分比档位与适应/100%；未注册「适应」时禁用并给原因', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '缩放' }));
    const menu = screen.getByRole('menu');

    expect(within(menu).getByText('50%')).toBeDefined();
    expect(within(menu).getByText('200%')).toBeDefined();
    expect(within(menu).getByText('缩放至 100%')).toBeDefined();

    const fit = within(menu).getByText('缩放至适合');
    expect(fit.closest('button')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('选择档位改缩放并在 HUD 闪出百分比', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '缩放' }));
    fireEvent.click(screen.getByText('200%'));

    await waitFor(() => {
      expect(useEditorView.getState().zoom).toBe(2);
    });
    expect(getCanvasHudSnapshot().text).toBe('200%');
  });
});

describe('命令面板（工单 08 迁移说明）', () => {
  it('壳层不再自带面板：面板组件与行为断言归 features/command-palette 域', () => {
    renderShell();
    // ⌘K 是壳层内置的默认实现（键位会被面板域的 ⌘/ 接管）；此处只断言命令已注册
    expect(getCommand('view.commandPalette')).toBeDefined();
    // 面板 UI 不在壳层里挂（editor-bootstrap 经 overlays 插槽挂新域组件）
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('快捷键说明（E8）', () => {
  it('两栏对照表内容由命令表派生（经工具条「?」入口打开；⌘/ 已归命令面板）', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('columnheader', { name: '命令' })).toBeDefined();
    expect(within(dialog).getByRole('columnheader', { name: '快捷键' })).toBeDefined();

    const table = within(dialog).getByRole('table');
    // 工具行：移动工具 ↔ V；视图行：命令面板（内置默认实现仍标 ⌘K，被面板域 ⌘/ 接管后随注册表更新）
    expect(within(table).getByText('移动工具')).toBeDefined();
    expect(within(table).getByText('V')).toBeDefined();
    expect(within(table).getByText('命令面板')).toBeDefined();
  });

  it('工具条「?」入口也能打开（入口与命令同一实现）', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('table')).toBeDefined();
  });
});

describe('HUD（冻结接口 ②）在壳层内的接入面', () => {
  it('画布槽组件通过 useCanvasHud().show/hide 驱动反白小条', async () => {
    act(() => {
      registerEditorSlotItem('canvas', { id: 'probe', render: () => <CanvasProbe /> });
    });
    renderShell();

    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      hudProbe?.show('1200 × 800');
    });
    expect(screen.getByRole('status').textContent).toBe('1200 × 800');

    act(() => {
      hudProbe?.hide();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('HUD 出现在画布列内（不遮顶栏/工具栏）', () => {
    renderShell();
    act(() => {
      canvasHud.show('150%');
    });
    const bar = screen.getByRole('status');
    const canvas = screen.getByRole('main');
    expect(canvas.contains(bar)).toBe(true);
  });
});
