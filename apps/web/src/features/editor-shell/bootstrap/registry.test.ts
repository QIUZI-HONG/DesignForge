/**
 * 引导注册表机制单测（工单 02：统一客户端引导 + 声明式注册表）。
 *
 * seam：`mountEditorSlotDeclarations` / `runEditorBootstrapEntries` 的对外行为——
 * 插槽声明按声明挂进插槽注册表、登记项按声明顺序执行、清理函数可整批（反序）撤销。
 * 组件侧（引导件挂载 → 插槽填充 → hydration 首帧一致）在
 * `app/editor/editor-bootstrap.test.tsx`，以 `/editor` 整页组合为 seam。
 *
 * 注：本机（Windows/WSL）无 node，测试待 dev 机执行（`pnpm --filter @dforge/web test`）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listEditorSlotItems, resetEditorSlots } from '../slots/registry';
import {
  type EditorBootstrapEntry,
  mountEditorSlotDeclarations,
  runEditorBootstrapEntries,
} from './registry';

afterEach(() => {
  resetEditorSlots();
});

describe('mountEditorSlotDeclarations · 插槽声明挂载', () => {
  it('按声明把条目挂进对应插槽（同槽多条按 order 升序）', () => {
    mountEditorSlotDeclarations([
      { slot: 'canvas', id: 'b-late', order: 10, render: () => null },
      { slot: 'canvas', id: 'a-early', order: 0, render: () => null },
      { slot: 'left-panel', id: 'c-panel', render: () => null },
    ]);

    expect(listEditorSlotItems('canvas').map((item) => item.id)).toEqual(['a-early', 'b-late']);
    expect(listEditorSlotItems('left-panel').map((item) => item.id)).toEqual(['c-panel']);
  });

  it('返回的反注册函数把本批条目整批撤下（幂等）', () => {
    const unmount = mountEditorSlotDeclarations([
      { slot: 'canvas', id: 'x', render: () => null },
      { slot: 'overlays', id: 'y', render: () => null },
    ]);

    unmount();
    unmount();

    expect(listEditorSlotItems('canvas')).toEqual([]);
    expect(listEditorSlotItems('overlays')).toEqual([]);
  });
});

describe('runEditorBootstrapEntries · 域登记项执行', () => {
  it('按声明顺序执行全部登记项', () => {
    const calls: string[] = [];
    const entries: readonly EditorBootstrapEntry[] = [
      {
        id: 'first',
        setup: () => {
          calls.push('first');
        },
      },
      {
        id: 'second',
        setup: () => {
          calls.push('second');
        },
      },
    ];

    runEditorBootstrapEntries(entries);

    expect(calls).toEqual(['first', 'second']);
  });

  it('返回的清理函数按声明反序执行（栈式撤销）；未返回清理的项跳过', () => {
    const calls: string[] = [];
    const entries: readonly EditorBootstrapEntry[] = [
      {
        id: 'first',
        setup: () => () => {
          calls.push('first-cleanup');
        },
      },
      { id: 'second', setup: () => undefined },
      {
        id: 'third',
        setup: () => () => {
          calls.push('third-cleanup');
        },
      },
    ];

    const teardown = runEditorBootstrapEntries(entries);
    teardown();

    expect(calls).toEqual(['third-cleanup', 'first-cleanup']);
  });

  it('某项 setup 抛错时后续项不再执行，错误原样上抛（不吞错）', () => {
    const boom = new Error('boom');
    const later = vi.fn();
    const entries: readonly EditorBootstrapEntry[] = [
      { id: 'ok', setup: () => undefined },
      {
        id: 'boom',
        setup: () => {
          throw boom;
        },
      },
      {
        id: 'later',
        setup: () => {
          later();
        },
      },
    ];

    expect(() => runEditorBootstrapEntries(entries)).toThrow(boom);
    expect(later).not.toHaveBeenCalled();
  });
});
