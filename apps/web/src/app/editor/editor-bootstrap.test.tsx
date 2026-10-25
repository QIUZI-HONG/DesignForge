// @vitest-environment jsdom
/**
 * 编辑器统一客户端引导测试（工单 02：hydration 首帧一致性 + 声明式注册表）。
 *
 * seam：`/editor` 页面组合（`EditorPage` = 壳层 + **唯一**客户端引导件）的可观测行为——
 * 1. 服务端首帧 = 空槽形态：壳层兜底渲染、域挂载产物不出现、**渲染期零注册**
 *    （这是「服务端空槽形态 = 客户端首帧形态」的两侧前提）；
 * 2. 客户端 hydrate 服务端 HTML 无 mismatch（引导只在挂载后注册 → 首帧一致，
 *    不再出现「服务端空槽 / 客户端有槽」把整树停在空槽形态的回归）；
 * 3. 挂载后插槽按声明表填充（id/order 与 `editor-bootstrap.tsx` 的声明一一对应）、
 *    命令注册到位（FE-06 接管 + FE-07 预留入口点亮）；
 * 4. 重复渲染（SPA 离开再回来）幂等：同 id 覆盖，插槽与命令都不叠加。
 *
 * CanvasKit（Skia WASM/WebGL）不在 jsdom 里：把加载器换成**永不完成**的 Promise，
 * 画布槽停在 loading 态（`canvas-stage` 既有 boot 流程的天然降级，不碰其内部）。
 *
 * 注：本机（Windows/WSL）无 node，测试待 dev 机执行（`pnpm --filter @dforge/web test`）；
 * hydration 时序的真值断言另由 e2e:smoke（真 daemon + 生产构建 + 真 Chromium）承担，
 * 本文件守住的是「渲染期零注册 + 挂载后填充」的结构契约。
 */

import { ToastProvider } from '@dforge/ui';
import { act, render } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWorkspace } from '@/features/canvas';
import { resetReviewSessionForTest } from '@/features/editor-review/register';
import {
  getCommand,
  getCommandsSnapshot,
  listEditorSlotItems,
  resetCommandRegistry,
  resetEditorSlots,
} from '@/features/editor-shell';

import EditorPage from './page';

vi.mock('@/features/canvas/runtime/canvaskit-loader', () => ({
  // 永不完成：画布舞台停在 loading 态（jsdom 无 Skia 运行时，见文件头注释）
  loadCanvasKit: () => new Promise<never>(() => {}),
}));

beforeEach(() => {
  resetCommandRegistry();
  resetEditorSlots();
  resetWorkspace();
  resetReviewSessionForTest();
});

describe('/editor · 服务端首帧（空槽形态）', () => {
  it('服务端渲染 = 空槽兜底形态，渲染期不注册任何插槽与命令', () => {
    const html = renderToStaticMarkup(<EditorPage />);

    expect(html).toContain('data-df-page="editor"');
    expect(html).toContain('data-df-slot="canvas"');
    expect(html).toContain('data-df-slot="left-panel"');
    expect(html).toContain('data-df-slot="right-panel"');
    // 空槽形态：画布 + 左右面板共三处壳层兜底
    expect(html.match(/data-df-state="empty"/g)?.length).toBe(3);
    // 域挂载产物不出现（引导只在挂载后注册）
    expect(html).not.toContain('data-df-canvas-shell');
    // 渲染期零注册——服务端/客户端首帧一致的共同前提
    expect(listEditorSlotItems('canvas')).toEqual([]);
    expect(listEditorSlotItems('left-panel')).toEqual([]);
    expect(listEditorSlotItems('right-panel')).toEqual([]);
    expect(getCommand('view.zoomFit')).toBeUndefined();
  });
});

describe('/editor · hydration 首帧一致 + 挂载后填充', () => {
  it('hydrate 服务端 HTML 无 mismatch；挂载后插槽按声明表填充、命令注册到位', () => {
    // SSR 与水合同树形（ToastProvider 渲染一层 div：两侧都带，否则按节点比对必错位）
    const serverHtml = renderToStaticMarkup(
      <ToastProvider>
        <EditorPage />
      </ToastProvider>,
    );
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const errors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    let root: Root | null = null;
    try {
      act(() => {
        root = hydrateRoot(
          container,
          <ToastProvider>
            <EditorPage />
          </ToastProvider>,
        );
      });

      // —— hydration 一致性：任何 hydration 告警都算失败（首帧不一致即整树停空槽） ——
      const hydrationWarnings = errors.filter((args) =>
        /hydrat|not match|server html/i.test(String(args[0])),
      );
      expect(hydrationWarnings).toEqual([]);

      // —— 挂载后：声明表里的插槽条目全部就位（order 升序，同 order 按声明顺序） ——
      expect(listEditorSlotItems('topbar-center').map((item) => item.id)).toEqual([
        'fe-06-document-save',
      ]);
      expect(listEditorSlotItems('canvas').map((item) => item.id)).toEqual([
        'fe-06-canvas',
        'fe-07-comment-layer',
      ]);
      expect(listEditorSlotItems('left-panel').map((item) => item.id)).toEqual(['fe-04-panels']);
      expect(listEditorSlotItems('right-panel').map((item) => item.id)).toEqual([
        'fe-06-right',
        'fe-07-comments-panel',
      ]);
      expect(listEditorSlotItems('toolbar').map((item) => item.id)).toEqual(['fe-10-ai-entry']);
      expect(listEditorSlotItems('overlays').map((item) => item.id)).toEqual([
        'fe-10-overlays',
        'fe-07-presenter',
        'fe-07-versions',
        'rw-08-command-palette',
        'rw-08-shortcut-cheatsheet',
      ]);

      // —— FE-04~FE-10 挂载产物可见：画布壳（FE-06）出现，空槽兜底全部退场 ——
      expect(document.querySelector('[data-df-canvas-shell]')).not.toBeNull();
      expect(document.querySelectorAll('[data-df-state="empty"]').length).toBe(0);

      // —— 命令注册到位：FE-06 接管 + FE-07 顶栏预留入口点亮 ——
      expect(getCommand('view.zoomFit')).toBeDefined();
      expect(getCommand('view.ai')).toBeDefined();
      expect(getCommand('review.comment.toggle')).toBeDefined();
      expect(getCommand('review.present.start')).toBeDefined();
      expect(getCommand('review.versions.open')).toBeDefined();
      expect(getCommand('file.new')).toBeDefined();
      expect(getCommand('file.export')).toBeDefined();
    } finally {
      errorSpy.mockRestore();
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it('重复渲染（SPA 离开再回来）幂等：同 id 覆盖，插槽与命令都不叠加', () => {
    const first = render(
      <ToastProvider>
        <EditorPage />
      </ToastProvider>,
    );
    const slotCount = listEditorSlotItems('overlays').length;
    const commandCount = getCommandsSnapshot().length;
    expect(slotCount).toBe(5); // fe-10-overlays + fe-07-presenter/versions + rw-08 面板/速查卡
    first.unmount();

    render(
      <ToastProvider>
        <EditorPage />
      </ToastProvider>,
    );

    // 同 id 覆盖（last wins）：条目数不变，顺序与首次一致
    expect(listEditorSlotItems('overlays').map((item) => item.id)).toEqual([
      'fe-10-overlays',
      'fe-07-presenter',
      'fe-07-versions',
      'rw-08-command-palette',
      'rw-08-shortcut-cheatsheet',
    ]);
    expect(listEditorSlotItems('canvas').map((item) => item.id)).toEqual([
      'fe-06-canvas',
      'fe-07-comment-layer',
    ]);
    expect(getCommandsSnapshot().length).toBe(commandCount);
  });
});
