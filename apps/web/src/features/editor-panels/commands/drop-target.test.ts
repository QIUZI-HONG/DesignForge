/**
 * 拖拽落点解析测试（seam：`resolveDropTarget` 的公开行为 + 与 `moveLayerCommands` 的合成结果）。
 *
 * 用真实夹具 + 真实命令栈：落点 → 命令 → 文档，端到端断言「同级重排」与「跨容器」的最终层级，
 * 并且跨容器时**世界位置不变**（图层面板拖拽的语义）。
 */
import {
  CommandStack,
  createDocument,
  createFrame,
  createGroup,
  createPage,
  createRect,
  type DesignDocument,
  getChildrenIds,
  getPage,
  insertNode,
  insertNodes,
  requireNode,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { moveLayerCommands } from './layer-commands';
import { isNoopDrop, resolveDropTarget, type DropRow } from './drop-target';

/**
 * 夹具：f1（画板 200×200，世界原点 0,0）⊃ [r1(10,10,50,50), r2(70,10,50,50), g1 ⊃ [t1(0,0,40,20)]]；
 * 顶层 [f2(400,0,100,100), t2(300,0,20,20)]。
 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 200, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
      createRect({ id: 'r2', x: 70, y: 10, width: 50, height: 50 }),
      createGroup({ id: 'g1', x: 0, y: 0, width: 40, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', x: 0, y: 0, width: 40, height: 20 }), 'g1');
  doc = insertNode(doc, 'p1', createFrame({ id: 'f2', x: 400, y: 0, width: 100, height: 100 }), null);
  doc = insertNode(doc, 'p1', createRect({ id: 't2', x: 300, y: 0, width: 20, height: 20 }), null);
  return doc;
}

/** 行高 28 的可见行序列（与面板渲染一致：展开的容器 + 子行）。 */
const ROW = 28;
function rows(): DropRow[] {
  return [
    { id: 'f1', parentId: null, depth: 0, container: true, top: 0, bottom: ROW },
    { id: 'r1', parentId: 'f1', depth: 1, container: false, top: ROW, bottom: ROW * 2 },
    { id: 'r2', parentId: 'f1', depth: 1, container: false, top: ROW * 2, bottom: ROW * 3 },
    { id: 'g1', parentId: 'f1', depth: 1, container: true, top: ROW * 3, bottom: ROW * 4 },
    { id: 't1', parentId: 'g1', depth: 2, container: false, top: ROW * 4, bottom: ROW * 5 },
    { id: 'f2', parentId: null, depth: 0, container: true, top: ROW * 5, bottom: ROW * 6 },
    { id: 't2', parentId: null, depth: 0, container: false, top: ROW * 6, bottom: ROW * 7 },
  ];
}

/** 施加落点（若解析出有效且非无操作的落点）。 */
function applyDrop(doc: DesignDocument, dragId: string, pointerY: number): DesignDocument {
  const stack = new CommandStack(doc, { freeze: true });
  const page = getPage(stack.document, 'p1');
  const target = resolveDropTarget(rows(), page, dragId, pointerY);
  if (target === null || isNoopDrop(page, dragId, target)) return stack.document;
  const commands = moveLayerCommands(page, 'p1', dragId, target.parentId, target.index);
  return commands.length === 0 ? stack.document : stack.dispatch(commands, { label: '拖拽' });
}

describe('拖拽落点解析', () => {
  it('行内上缘 → 插到该行之前（同级）', () => {
    const page = getPage(baseDoc(), 'p1');
    // g1 之前 = f1.children 摘除 g1 后 [r1, r2] 的 0 号位
    const target = resolveDropTarget(rows(), page, 'g1', ROW * 2 + 2);
    expect(target).toEqual({
      parentId: 'f1',
      index: 1,
      indicator: { rowId: 'r2', edge: 'top' },
    });
  });

  it('行内下缘 → 插到该行之后（同级）', () => {
    const page = getPage(baseDoc(), 'p1');
    const target = resolveDropTarget(rows(), page, 't1', ROW * 2 + ROW - 2);
    expect(target).toEqual({ parentId: 'f1', index: 2, indicator: { rowId: 'r2', edge: 'bottom' } });
  });

  it('容器行中段 → 放入容器内部（追加到末位 = 最上层）', () => {
    const page = getPage(baseDoc(), 'p1');
    const target = resolveDropTarget(rows(), page, 't2', ROW * 5 + ROW / 2);
    expect(target).toEqual({
      parentId: 'f2',
      index: 0,
      indicator: { rowId: 'f2', edge: 'inside' },
    });
  });

  it('自身上 → null（包括自己那行的任何分区）', () => {
    const page = getPage(baseDoc(), 'p1');
    expect(resolveDropTarget(rows(), page, 'r1', ROW + 2)).toBeNull();
    expect(resolveDropTarget(rows(), page, 'r1', ROW + ROW - 2)).toBeNull();
  });

  it('自身子树内 → null（不许把容器拖进自己的后代）', () => {
    const page = getPage(baseDoc(), 'p1');
    // f1 拖到 t1（在 g1 里，而 g1 在 f1 里）
    expect(resolveDropTarget(rows(), page, 'f1', ROW * 4 + ROW / 2)).toBeNull();
    // f1 拖到 g1 行本身（g1 是 f1 的子）
    expect(resolveDropTarget(rows(), page, 'f1', ROW * 3 + 2)).toBeNull();
  });

  it('首行之上 / 末行之下：越界指针夹到两端（顶层）', () => {
    const page = getPage(baseDoc(), 'p1');
    expect(resolveDropTarget(rows(), page, 'r1', -10)).toEqual({
      parentId: null,
      index: 0,
      indicator: { rowId: 'f1', edge: 'top' },
    });
    // 顶层顺序 [f1, f2, t2]，摘除 r1（在 f1 内，不影响顶层）→ after t2 = 3
    expect(resolveDropTarget(rows(), page, 'r1', ROW * 7 + 50)).toEqual({
      parentId: null,
      index: 3,
      indicator: { rowId: 't2', edge: 'bottom' },
    });
  });

  it('无操作落点可被识别（isNoopDrop）', () => {
    const page = getPage(baseDoc(), 'p1');
    // g1（f1.children 下标 2）拖到 r2 下缘之后：摘除 g1 后 [r1, r2]，r2 之后 = 2 = 原位 → 无操作
    const same = resolveDropTarget(rows(), page, 'g1', ROW * 2 + ROW - 2);
    expect(same).toEqual({ parentId: 'f1', index: 2, indicator: { rowId: 'r2', edge: 'bottom' } });
    expect(same && isNoopDrop(page, 'g1', same)).toBe(true);
    // 反向：拖到 r2 之前（下标 1）是真移动，不是无操作
    const moved = resolveDropTarget(rows(), page, 'g1', ROW * 2 + 2);
    expect(moved && isNoopDrop(page, 'g1', moved)).toBe(false);
  });

  it('同级重排：向下拖到末位（off-by-one 回归）', () => {
    // r1 拖到 g1 行下缘之后 → f1.children 应为 [r2, g1, r1]
    const after = applyDrop(baseDoc(), 'r1', ROW * 3 + ROW - 2);
    expect(getChildrenIds(getPage(after, 'p1'), 'f1')).toEqual(['r2', 'g1', 'r1']);
    // 世界位置不变（父级未变，坐标原样）
    expect(requireNode(getPage(after, 'p1'), 'r1').x).toBe(10);
  });

  it('跨容器：拖进另一画板，保持世界位置不变', () => {
    // r1（世界 10,10）拖入 f2（世界原点 400,0）→ f2 内局部坐标 (10-400, 10-0)
    const after = applyDrop(baseDoc(), 'r1', ROW * 5 + ROW / 2);
    const page = getPage(after, 'p1');
    expect(getChildrenIds(page, 'f2')).toEqual(['r1']);
    expect(getChildrenIds(page, 'f1')).toEqual(['r2', 'g1']);
    const moved = requireNode(page, 'r1');
    expect(moved.x).toBe(10 - 400);
    expect(moved.y).toBe(10);
  });

  it('跨容器到页面顶层：同样保持世界位置', () => {
    const after = applyDrop(baseDoc(), 't1', ROW * 6 + ROW - 2);
    const page = getPage(after, 'p1');
    expect(page.rootIds).toEqual(['f1', 'f2', 't2', 't1']);
    const moved = requireNode(page, 't1');
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
  });
});
