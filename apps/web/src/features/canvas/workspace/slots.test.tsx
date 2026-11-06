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
 *
 * 另锁画布槽的导入 IR 接线（audit-d03 · D-03）：句柄 `importIr` 不再走「未接入导入」
 * 兜底桩——合法 IR 灌进共享命令栈、坏 IR 走错误信封（真实浏览器往返由 J5 旅程承担）。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canvasHud, getCanvasHudSnapshot, resetCommandRegistry } from '@/features/editor-shell';

// AI 抽屉槽（票 06）经 `useRouter` 接「去诊断」跳设置页；本测试只锁 DOM 与状态接线，
// 跳转本身是 next/navigation 的行为——桩掉 router，避免要求 App Router 上下文。
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

// CanvasKit（Skia WASM/WebGL）不在 jsdom 里：加载器换成永不完成的 Promise，
// 画布槽停在 loading 态（与 app/editor/editor-bootstrap.test.tsx 同口径）。
vi.mock('@/features/canvas/runtime/canvaskit-loader', () => ({
  loadCanvasKit: () => new Promise<never>(() => {}),
}));

import {
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  serializeDocument,
} from '@dforge/engine';

import { readCanvasDebugHandle } from '../debug/canvas-debug';
import { registerWorkspaceCommands } from '../register';
import { AiEntryButton, CanvasSlot, OverlaysSlot, RightPanelSlot } from './slots';
import { useWorkspaceUi } from './ui-state';
import { resetWorkspace } from './workspace-session';

afterEach(() => {
  resetWorkspace();
  resetCommandRegistry();
  canvasHud.hide();
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

describe('画布槽 · 导入 IR 接线（audit-d03 · D-03）', () => {
  /** 一份含单个矩形的真实 IR（引擎构造 + 序列化，与 J5 导出同源）。 */
  function rectIr(name: string): string {
    const ids = createIdFactory(1);
    const rect = createRect({
      id: ids.next('n'),
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      name: '矩形 1',
    });
    const page = createPage({
      id: 'page-1',
      rootIds: [rect.id],
      nodes: { [rect.id]: rect },
    });
    return serializeDocument(createDocument({ id: 'doc-wire', name, pages: [page] }));
  }

  it('句柄 importIr：合法 IR 灌进共享命令栈（清落盘身份）+ HUD 成功提示', () => {
    render(<CanvasSlot />);
    const handle = readCanvasDebugHandle();
    expect(handle).not.toBeNull();

    const result = handle?.importIr(rectIr('接线夹具'));
    expect(result?.ok).toBe(true);
    expect(handle?.nodeCount()).toBe(1);
    expect(handle?.documentName()).toBe('接线夹具');
    // 本地替换清落盘身份：导入内容不写回上一份文档
    expect(handle?.documentId()).toBeNull();
    // 人话提示走画布 HUD（i18n：editor.import.imported）
    expect(getCanvasHudSnapshot().text).toContain('已导入 IR');
  });

  it('句柄 importIr：坏 IR 走错误信封（引擎原文）+ HUD 失败提示，会话保持原样', () => {
    render(<CanvasSlot />);
    const handle = readCanvasDebugHandle();
    // 先导入一份合法内容，验证坏 IR 不会破坏它
    expect(handle?.importIr(rectIr('先落一份')).ok).toBe(true);
    expect(handle?.nodeCount()).toBe(1);

    const bad = handle?.importIr('{not json');
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toBe('文档内容不是合法 JSON');
    // 会话未被破坏：节点还是上一份导入的内容
    expect(handle?.nodeCount()).toBe(1);
    // 失败提示走 HUD（i18n：editor.import.failed 包引擎原文）
    expect(getCanvasHudSnapshot().text).toContain('导入失败');
    expect(getCanvasHudSnapshot().text).toContain('文档内容不是合法 JSON');
  });
});
