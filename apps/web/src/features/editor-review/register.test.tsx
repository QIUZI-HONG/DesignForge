// @vitest-environment jsdom
/**
 * FE-07 ⇄ FE-03 接线测试（seam：路由侧挂载模块的可观测效果）。
 *
 * 断言口径：`register.tsx` 一 import——
 * 1. 三个预留命令（评论模式 / 演示 / 版本历史）已注册 → 顶栏入口自动点亮（不再禁用）；
 * 2. 槽位挂载到位：`canvas`（评论层）、`right-panel`（线程面板）、`overlays`（Present/版本）；
 * 3. 走**用户路径**（点顶栏入口）能到达三块面：评论层进 active 态、版本抽屉打开、
 *    空文档时「演示」保持禁用（不伪造可点）。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CanvasHudProvider,
  EditorShell,
  getCommand,
  listEditorSlotItems,
  resetCommandRegistry,
  resetEditorSlots,
} from '@/features/editor-shell';

import './register';

afterEach(() => {
  cleanup();
});

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
    render(
      <CanvasHudProvider>
        <EditorShell />
      </CanvasHudProvider>,
    );
    const layer = document.querySelector('[data-df-comment-layer]');
    expect(layer?.getAttribute('data-df-state')).toBe('idle');
    expect(document.querySelector('[data-df-panel="comments"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '评论' }));

    expect(document.querySelector('[data-df-comment-layer]')?.getAttribute('data-df-state')).toBe(
      'active',
    );
    expect(document.querySelector('[data-df-panel="comments"]')).not.toBeNull();
  });

  it('整壳渲染：点顶栏「版本历史」→ 抽屉打开（本地快照目录）', () => {
    render(
      <CanvasHudProvider>
        <EditorShell />
      </CanvasHudProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    // 抽屉经 createPortal 挂到 body（不在 [data-df-versions-root] 子树里），因此按角色查
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('版本历史');
  });

  it('空文档时「演示」入口禁用（入口先于实现也不假动作）', () => {
    render(
      <CanvasHudProvider>
        <EditorShell />
      </CanvasHudProvider>,
    );
    const present = screen.getByRole('button', { name: '演示' });
    expect((present as HTMLButtonElement).disabled).toBe(true);
  });
});

/** 复位单例（防同文件内测试互相污染；本文件按注册即用的口径写，这里仅声明意图）。 */
function _resetSingletons(): void {
  resetCommandRegistry();
  resetEditorSlots();
}
void _resetSingletons;
