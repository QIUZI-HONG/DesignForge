// @vitest-environment jsdom
/**
 * 对抗性验证 · 风险 2：选择集同源（画布选中 ↔ 图层面板高亮）
 *
 * 结论口径：两处必须是**同一份**数据（面板 UI store），任何序列都不得出现「画布选中 A / 面板高亮 B」。
 * 对抗手段：
 * - 两侧交替写入（画布 pointer 序列 → 面板点击 → 画布再写）后逐字段比对；
 * - 构造「删除选中节点」「选中父+子」等边界序列，看两侧是否仍同步、是否崩溃；
 * - 组件级：真实渲染 LayersPanel，切换画布选择后断言行 `aria-selected/data-df-state` 跟随。
 */
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  createSelection,
  type DesignDocument,
  type Selection,
} from '@dforge/engine';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '@/features/canvas/state/session';
import { panelsSelectionPort } from '@/features/canvas/workspace/workspace-session';
import { createPanelsSession, type PanelsSession } from '@/features/editor-panels';
import { LayersPanel } from '@/features/editor-panels/components/LayersPanel';
import { PanelsProvider } from '@/features/editor-panels/components/panels-context';

/** 文档：画板（内含一个矩形）+ 顶层矩形。 */
function makeDocument(): DesignDocument {
  const child = createRect({ id: 'n_child', x: 10, y: 10, width: 40, height: 40 });
  const frame = createFrame({
    id: 'n_frame',
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    children: ['n_child'],
  });
  const rect = createRect({ id: 'n_rect', x: 500, y: 60, width: 60, height: 60 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_frame', 'n_rect'],
    nodes: { n_child: child, n_frame: frame, n_rect: rect },
  });
  return createDocument({ id: 'doc_1', pages: [page] });
}

let panels: PanelsSession;
let canvas: CanvasSession;

function selectionEquals(a: Selection, b: Selection): boolean {
  return a.activeId === b.activeId && a.ids.join(',') === b.ids.join(',');
}

beforeEach(() => {
  const document = makeDocument();
  panels = createPanelsSession({ document, pageId: 'page_1' });
  canvas = createCanvasSession({
    stack: panels.stack,
    document,
    pageId: 'page_1',
    selectionPort: panelsSelectionPort(panels),
  });
});

describe('选择集同源（画布 ↔ 图层面板）', () => {
  it('画布选定 → 面板同步（同 id 同顺序同主选中）', () => {
    canvas.setSelection(['n_rect'], 'n_rect');
    expect(selectionEquals(panels.ui.getState().selection, canvas.selection())).toBe(true);
    expect(panels.ui.getState().selection.ids).toEqual(['n_rect']);
  });

  it('面板选定 → 画布同步（面板点击是另一条入口）', () => {
    panels.ui.getState().selectLayer('n_rect');
    expect(canvas.selection().ids).toEqual(['n_rect']);
  });

  it('交替写入十轮后两侧仍逐字段一致（无累积漂移）', () => {
    const sequence: Array<[string, () => void]> = [
      ['canvas', () => canvas.setSelection(['n_frame'])],
      ['panel', () => panels.ui.getState().selectLayer('n_rect')],
      ['canvas', () => canvas.setSelection(['n_rect', 'n_child'])],
      ['panel', () => panels.ui.getState().selectLayer('n_child', { shift: true })],
      ['canvas', () => canvas.clearSelection()],
      ['panel', () => panels.ui.getState().selectLayer('n_frame')],
      ['canvas', () => canvas.selectAll()],
      ['panel', () => panels.ui.getState().selectLayer(null)],
      ['canvas', () => canvas.addNodeToSelection('n_child')],
      ['panel', () => panels.ui.getState().setSelection(createSelection(['n_rect'], 'n_rect'))],
    ];
    for (const [side, run] of sequence) {
      run();
      expect(
        selectionEquals(panels.ui.getState().selection, canvas.selection()),
        `${side} 写完后两侧不一致：面板=${JSON.stringify(panels.ui.getState().selection)} 画布=${JSON.stringify(canvas.selection())}`,
      ).toBe(true);
    }
  });

  it('[缺陷] 选中节点被删除后再按方向键：不得抛未捕获异常（当前会抛 CommandError）', () => {
    canvas.setSelection(['n_rect'], 'n_rect');
    panels.run([{ type: 'node.remove', pageId: 'page_1', nodeId: 'n_rect' }], '删除');
    // 两侧仍持有已删除 id（同源一致，但都是失效 id）
    expect(panels.ui.getState().selection.ids).toEqual(['n_rect']);

    // 对抗：对失效选择做微移（方向键的真实路径）→ 不得抛出未捕获异常（UI 层会直接崩）
    expect(() => canvas.nudge(1, 0)).not.toThrow();
  });

  it('[缺陷] 真实用户序列：成组 → ⌘Z 撤销 → 方向键（选择集残留失效组 id，方向键抛错）', () => {
    // 1. 两个顶层对象成组（画布入口，与 ⌘G 同路径）
    canvas.setSelection(['n_frame', 'n_rect']);
    canvas.group();
    const groupId = canvas.selection().ids[0] as string;
    expect(canvas.page().nodes[groupId]?.type).toBe('group');

    // 2. ⌘Z 撤销（shell 或画布入口都在这里收口于 session.undo）
    canvas.undo();
    expect(canvas.page().nodes[groupId]).toBeUndefined();
    // 撤销不清理选择集：组 id 已成幽灵
    expect(canvas.selection().ids).toEqual([groupId]);

    // 3. 方向键微移（画布快捷键表 nudge → session.nudge，canvas-stage 的 keydown 无 try/catch）
    expect(() => canvas.nudge(0, 1)).not.toThrow();
  });

  it('[补充] 撤销后选择集自动收敛：幽灵 id 不参与运算、不画高亮（派生视图与文档真值一致）', () => {
    canvas.setSelection(['n_frame', 'n_rect']);
    canvas.group();
    const groupId = canvas.selection().ids[0] as string;
    canvas.undo();
    expect(canvas.page().nodes[groupId]).toBeUndefined();

    // 收敛口径：选择集里的幽灵 id 在**所有文档视角**里都消失（不画框、不算包围盒、不进渲染帧）
    expect(canvas.selectedNodes()).toEqual([]);
    expect(canvas.selectionBounds()).toBeNull();
    expect(canvas.frameInput().selection).toEqual([]);

    // 所有「按 id 移动/变换」入口对失效选择都是空操作：不抛错、不写历史、不产生错误态
    expect(() => {
      canvas.nudge(1, 0);
      canvas.nudge(0, 1);
      canvas.align('left', 'parent');
      canvas.distribute('horizontal');
      canvas.reorder('front');
      canvas.duplicate();
      canvas.copy();
      canvas.ungroup();
      canvas.deleteSelection();
      // 指针序列走**空白区**（幽灵选择集不得让框选/命中路径抛错）
      canvas.pointerDown({ world: { x: 900, y: 900 }, screen: { x: 900, y: 900 }, button: 'left' });
      canvas.pointerMove({ world: { x: 960, y: 960 }, screen: { x: 960, y: 960 } });
      canvas.pointerUp({ world: { x: 960, y: 960 }, screen: { x: 960, y: 960 } });
    }).not.toThrow();
    expect(canvas.stack.history().undo).toHaveLength(0);
    expect(canvas.store.getState().error).toBeNull();
  });

  it('选中节点被删除后：拖动/对齐/成组不得抛出未捕获异常', () => {
    canvas.setSelection(['n_rect'], 'n_rect');
    panels.run([{ type: 'node.remove', pageId: 'page_1', nodeId: 'n_rect' }], '删除');
    expect(() => {
      canvas.pointerDown({ world: { x: 520, y: 80 }, screen: { x: 520, y: 80 }, button: 'left' });
      canvas.pointerMove({ world: { x: 560, y: 100 }, screen: { x: 560, y: 100 } });
      canvas.pointerUp({ world: { x: 560, y: 100 }, screen: { x: 560, y: 100 } });
    }).not.toThrow();
    expect(() => canvas.align('left')).not.toThrow();
    expect(() => canvas.group()).not.toThrow();
  });

  it('组件级：画布改选择 → 图层行高亮跟随（真实渲染；RW-13 起 Tree 行挂点是 data-node-id）', () => {
    render(
      <PanelsProvider session={panels}>
        <LayersPanel />
      </PanelsProvider>,
    );
    const rowOf = (id: string): Element => {
      const row = document.querySelector(`[data-node-id="${id}"]`);
      if (row === null) throw new Error(`图层行不存在：${id}`);
      return row;
    };
    expect(rowOf('n_rect').getAttribute('aria-selected')).toBe('false');

    act(() => {
      canvas.setSelection(['n_rect'], 'n_rect');
    });
    expect(rowOf('n_rect').getAttribute('aria-selected')).toBe('true');
    // 选中视觉由 Tree 的修饰类承接（@dforge/ui 真源；旧版 data-df-state 挂点随 LayerRow 退役）
    expect(rowOf('n_rect').className).toContain('dfg-tree__node--selected');
    expect(rowOf('n_frame').getAttribute('aria-selected')).toBe('false');
  });

  it('组件级：点击图层行 → 画布选择同步（反向入口）', async () => {
    const user = userEvent.setup();
    render(
      <PanelsProvider session={panels}>
        <LayersPanel />
      </PanelsProvider>,
    );
    await user.click(document.querySelector('[data-node-id="n_rect"]') as Element);
    expect(canvas.selection().ids).toEqual(['n_rect']);

    await user.click(document.querySelector('[data-node-id="n_frame"]') as Element);
    expect(canvas.selection().ids).toEqual(['n_frame']);
  });
});
