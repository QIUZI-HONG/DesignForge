// @vitest-environment jsdom
/**
 * FE-07 ⇄ FE-03 接线测试（seam：路由侧接线模块的可观测效果）。
 *
 * 断言口径（工单 02 起挂载时机统一收口到编辑器引导件）：命令经 `registerEditorReview()`
 * 登记、插槽经统一引导注册表的 FE-07 声明（`EDITOR_SLOT_DECLARATIONS`）挂载——
 * 1. 三个预留命令（评论模式 / 演示 / 版本历史）已注册 → 顶栏入口自动点亮（不再禁用）；
 * 2. 槽位挂载到位：`canvas`（评论层）、`right-panel`（线程面板）、`overlays`（Present/版本）；
 * 3. 走**用户路径**（点顶栏入口）能到达三块面：评论层进 active 态、版本抽屉打开、
 *    空文档时「演示」保持禁用（不伪造可点）；
 * 4. 工作包 C 修复项：顶栏「评论」入口的 `aria-pressed` 开启态与入口名切换；
 *    演示入口**与画布文档同源**——画布上出现画板后入口自动可点（不刷新、不重挂）。
 */

import { EDITOR_SLOT_DECLARATIONS } from '@/app/editor/editor-bootstrap';
import { ToastProvider } from '@dforge/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkspace, resetWorkspace } from '@/features/canvas';
import {
  CanvasHudProvider,
  EditorShell,
  getCommand,
  listEditorSlotItems,
  mountEditorSlotDeclarations,
  resetCommandRegistry,
  resetEditorSlots,
} from '@/features/editor-shell';

import { registerEditorReview, resetReviewSessionForTest } from './register';

beforeEach(() => {
  // 单例复位后按**新装配**重挂：命令经本模块登记函数，插槽经统一引导注册表的 FE-07 声明
  // （命令的 subscribe 闭包据此绑定新会话；生产由编辑器引导件挂载后统一执行）
  resetWorkspace();
  resetReviewSessionForTest();
  resetCommandRegistry();
  resetEditorSlots();
  registerEditorReview();
  mountEditorSlotDeclarations(
    EDITOR_SLOT_DECLARATIONS.filter((declaration) => declaration.id.startsWith('fe-07-')),
  );
});

afterEach(() => {
  cleanup();
  resetCommandRegistry();
  resetEditorSlots();
});

/** 整壳渲染（应用根部形态：ToastProvider 在壳外，见 app/layout.tsx）。 */
function renderShell(): void {
  render(
    <ToastProvider>
      <CanvasHudProvider>
        <EditorShell />
      </CanvasHudProvider>
    </ToastProvider>,
  );
}

describe('FE-07 路由侧接线 · 命令注册', () => {
  it('三个预留命令都注册了（顶栏入口据此点亮）', () => {
    for (const id of ['review.comment.toggle', 'review.present.start', 'review.versions.open']) {
      const command = getCommand(id);
      expect(command, `${id} 未注册`).toBeDefined();
      expect(command?.title.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('评论模式命令带 C 快捷键（Figma 同款）', () => {
    expect(getCommand('review.comment.toggle')?.shortcut).toBe('C');
  });

  it('演示命令在空文档时置灰（没有画板就不假装能演示）', () => {
    expect(getCommand('review.present.start')?.enabled?.()).toBe(false);
  });
});

describe('FE-07 路由侧接线 · 插槽挂载', () => {
  it('canvas / right-panel / overlays 三个槽都有本票条目', () => {
    const canvas = listEditorSlotItems('canvas').filter((item) => item.id.startsWith('fe-07-'));
    const rightPanel = listEditorSlotItems('right-panel').filter((item) =>
      item.id.startsWith('fe-07-'),
    );
    const overlays = listEditorSlotItems('overlays').filter((item) => item.id.startsWith('fe-07-'));
    expect(canvas.map((item) => item.id)).toEqual(['fe-07-comment-layer']);
    expect(rightPanel.map((item) => item.id)).toEqual(['fe-07-comments-panel']);
    expect(overlays.map((item) => item.id).sort()).toEqual(['fe-07-presenter', 'fe-07-versions']);
  });
});

describe('FE-07 路由侧接线 · 用户路径', () => {
  it('整壳渲染：点顶栏「评论」→ 评论层进 active 态、线程面板出现在右栏', () => {
    renderShell();
    const layer = document.querySelector('[data-df-comment-layer]');
    expect(layer?.getAttribute('data-df-state')).toBe('idle');
    expect(document.querySelector('[data-df-panel="comments"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '评论' }));

    expect(document.querySelector('[data-df-comment-layer]')?.getAttribute('data-df-state')).toBe(
      'active',
    );
    expect(document.querySelector('[data-df-panel="comments"]')).not.toBeNull();
  });

  it('顶栏「评论」入口有开启态：aria-pressed 翻转 + 入口名切「退出评论模式」（UX-12）', () => {
    renderShell();
    const before = screen.getByRole('button', { name: '评论' }) as HTMLButtonElement;
    expect(before.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(before);

    const after = screen.getByRole('button', { name: '退出评论模式' }) as HTMLButtonElement;
    expect(after.getAttribute('aria-pressed')).toBe('true');

    // 再点 = 退出（回到未开启态）
    fireEvent.click(after);
    expect(
      (screen.getByRole('button', { name: '评论' }) as HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
  });

  it('整壳渲染：点顶栏「版本历史」→ 抽屉打开（本地快照目录）', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    // 抽屉经 createPortal 挂到 body（不在 [data-df-versions-root] 子树里），因此按角色查
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('版本历史');
  });

  it('空文档时「演示」入口禁用（入口先于实现也不假动作）', () => {
    renderShell();
    const present = screen.getByRole('button', { name: '演示' });
    expect((present as HTMLButtonElement).disabled).toBe(true);
  });

  it('画布上出现画板后「演示」入口自动可点（文档同源 + 入口订阅刷新，C3/UX-07）', () => {
    renderShell();
    const present = screen.getByRole('button', { name: '演示' }) as HTMLButtonElement;
    expect(present.disabled).toBe(true);

    // 走画布会话的真实写路径（唯一写入口：命令栈）——与用户在画布上拉出一个画板等价
    const workspace = getWorkspace();
    act(() => {
      workspace.canvas.createFrameAt({ x: 0, y: 0, width: 320, height: 240 });
    });

    const after = screen.getByRole('button', { name: '演示' }) as HTMLButtonElement;
    expect(after.disabled).toBe(false);
    // 状态也随文档变化（命令的 enabled 读的是同一份快照）
    expect(getCommand('review.present.start')?.enabled?.()).toBe(true);
  });

  it('删掉画板后「演示」入口回到禁用（同一订阅链路的反向断言）', () => {
    renderShell();
    const workspace = getWorkspace();
    let frameId = '';
    act(() => {
      frameId = workspace.canvas.createFrameAt({ x: 0, y: 0, width: 320, height: 240 });
    });
    expect((screen.getByRole('button', { name: '演示' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    act(() => {
      workspace.canvas.setSelection([frameId]);
      workspace.canvas.deleteSelection();
    });
    expect((screen.getByRole('button', { name: '演示' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
