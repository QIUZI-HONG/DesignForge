/**
 * 图层行模型测试（seam：`buildLayerRows` 的公开输出）。
 *
 * 口径要点：
 * - **显示顺序 = 绘制顺序的逆序**（最上层在最前，与 Figma 一致）；
 * - 折叠只隐藏**后代**（容器行自身仍在）；
 * - 祖先的 hidden/locked 状态逐层继承给后代（用于置灰与禁用按钮）；
 * - 实例虚节点 `readOnly`（属性可覆盖，结构不可编辑）。
 */
import {
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
  getPage,
  insertNode,
  insertNodes,
  layerTree,
  virtualNodeId,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { buildLayerRows } from './layer-rows';

/**
 * 夹具：f1 ⊃ [r1, r2, g1 ⊃ [t1]]；顶层 [f1, t2]。
 * 绘制顺序：f1 在下、t2 在上；f1 内 r1 在下、g1 在上。
 */
function baseDoc(init: { f1Visible?: boolean; f1Locked?: boolean } = {}): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(
    doc,
    'p1',
    createFrame({
      id: 'f1',
      width: 200,
      height: 200,
      visible: init.f1Visible ?? true,
      locked: init.f1Locked ?? false,
    }),
    null,
  );
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', width: 50, height: 50 }),
      createRect({ id: 'r2', x: 70, width: 50, height: 50 }),
      createGroup({ id: 'g1', width: 40, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', width: 40, height: 20 }), 'g1');
  doc = insertNode(doc, 'p1', createRect({ id: 't2', x: 300, width: 20, height: 20 }), null);
  return doc;
}

const page = (doc: DesignDocument) => getPage(doc, 'p1');

/** 便捷：默认展开 + 空选择。 */
function rowsOf(
  doc: DesignDocument,
  overrides: Partial<Parameters<typeof buildLayerRows>[1]> = {},
) {
  return buildLayerRows(layerTree(page(doc)), {
    collapsedIds: new Set(),
    selection: { ids: [], activeId: null },
    ...overrides,
  });
}

describe('图层行模型', () => {
  it('默认全展开：同级逆绘制顺序（最上层在最前），子行紧随其父，深度逐级 +1', () => {
    const rows = rowsOf(baseDoc());
    expect(rows.map((row) => row.id)).toEqual(['t2', 'f1', 'g1', 't1', 'r2', 'r1']);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 2, 1, 1]);
  });

  it('容器与子节点数：画板/编组可展开，叶子没有箭头；空画板可接收拖入', () => {
    const byId = new Map(rowsOf(baseDoc()).map((row) => [row.id, row]));
    expect(byId.get('f1')?.container).toBe(true);
    expect(byId.get('f1')?.childCount).toBe(3);
    expect(byId.get('g1')?.container).toBe(true);
    expect(byId.get('r1')?.container).toBe(false);
    expect(byId.get('r1')?.collapsed).toBe(false);
    expect(byId.get('r1')?.droppable).toBe(false);
    expect(byId.get('f1')?.droppable).toBe(true);
  });

  it('空画板：没有箭头（无子节点），但可接收拖入（droppable）', () => {
    let doc = baseDoc();
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f-empty', x: 600, width: 50, height: 50 }),
      null,
    );
    const byId = new Map(rowsOf(doc).map((row) => [row.id, row]));
    expect(byId.get('f-empty')?.container).toBe(false);
    expect(byId.get('f-empty')?.droppable).toBe(true);
  });

  it('折叠容器：容器行保留且标记 collapsed，其全部后代隐藏', () => {
    const rows = rowsOf(baseDoc(), { collapsedIds: new Set(['f1']) });
    expect(rows.map((row) => row.id)).toEqual(['t2', 'f1']);
    expect(rows.find((row) => row.id === 'f1')?.collapsed).toBe(true);
  });

  it('折叠嵌套容器：只影响该容器的后代', () => {
    const rows = rowsOf(baseDoc(), { collapsedIds: new Set(['g1']) });
    expect(rows.map((row) => row.id)).toEqual(['t2', 'f1', 'g1', 'r2', 'r1']);
  });
  it('选中态：selected 全量标记，active 只标主选中', () => {
    const byId = new Map(
      rowsOf(baseDoc(), { selection: { ids: ['r1', 'r2'], activeId: 'r2' } }).map((row) => [
        row.id,
        row,
      ]),
    );
    expect(byId.get('r1')?.selected).toBe(true);
    expect(byId.get('r1')?.active).toBe(false);
    expect(byId.get('r2')?.selected).toBe(true);
    expect(byId.get('r2')?.active).toBe(true);
    expect(byId.get('t2')?.selected).toBe(false);
  });

  it('祖先状态继承：父隐藏 → 后代 hiddenByAncestor；父锁定 → 后代 lockedByAncestor', () => {
    const byId = new Map(
      rowsOf(baseDoc({ f1Visible: false, f1Locked: true })).map((row) => [row.id, row]),
    );
    expect(byId.get('r1')?.hiddenByAncestor).toBe(true);
    expect(byId.get('r1')?.lockedByAncestor).toBe(true);
    // 容器自身的 hidden/locked 由自身属性表达，不算「祖先」状态
    expect(byId.get('f1')?.hiddenByAncestor).toBe(false);
    expect(byId.get('f1')?.lockedByAncestor).toBe(false);
    expect(byId.get('t1')?.hiddenByAncestor).toBe(true);
    expect(byId.get('t2')?.hiddenByAncestor).toBe(false);
    expect(byId.get('t2')?.lockedByAncestor).toBe(false);
  });

  it('实例子树：虚节点 readOnly，被覆盖的节点带 overridden 标记', () => {
    let doc = baseDoc();
    doc = insertNode(doc, 'p1', createComponent({ id: 'c1', x: 0, y: 300 }), null);
    doc = insertNode(doc, 'p1', createRect({ id: 'cr1', width: 30, height: 30 }), 'c1');
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'inst1', componentId: 'c1', overrides: { cr1: { name: '改了' } } }),
      null,
    );

    const rows = rowsOf(doc);
    const virtualRow = rows.find((row) => row.id === virtualNodeId('inst1', ['cr1']));
    expect(virtualRow).toBeDefined();
    expect(virtualRow?.readOnly).toBe(true);
    expect(virtualRow?.overridden).toBe(true);
    // 实例行自身与真实节点都不是 readOnly
    expect(rows.find((row) => row.id === 'inst1')?.readOnly).toBe(false);
    expect(rows.find((row) => row.id === 'r1')?.readOnly).toBe(false);
    // 虚节点的显示名取视图节点（覆盖已应用）
    expect(virtualRow?.node.name).toBe('改了');
  });
});
