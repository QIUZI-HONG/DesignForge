import { describe, expect, it, vi } from 'vitest';
import { type Point, worldQuad } from '../geometry/index';
import { createIdFactory } from '../model/ids';
import {
  childrenOf,
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import {
  getChildrenIds,
  getPage,
  insertNode,
  insertNodes,
  requireNode,
  validateDocument,
} from '../scene/index';
import {
  type Command,
  CommandStack,
  deleteNodesCommands,
  dissolveGroupCommands,
  frameTransformPatch,
  groupNodesCommands,
  moveNodesByWorldCommands,
  patchNodeCommands,
  reparentPreservingWorldCommands,
} from './index';

/** 基础文档：f1(画板 0,0,200,200) ⊃ [r1(10,10,50,50), r2(70,10,50,50)]；顶层 t1(300,0,20,20)。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 200, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
      createRect({ id: 'r2', x: 70, y: 10, width: 50, height: 50 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', x: 300, y: 0, width: 20, height: 20 }), null);
  return doc;
}

function stack(doc: DesignDocument = baseDoc()): CommandStack {
  return new CommandStack(doc);
}

/** 取节点坐标（断言用）。 */
function rectOf(
  doc: DesignDocument,
  id: string,
): { x: number; y: number; width: number; height: number; rotation: number } {
  const node = requireNode(getPage(doc, 'p1'), id);
  return { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
}

describe('commands · 写操作唯一入口', () => {
  it('派发命令返回新文档并通知订阅者', () => {
    const s = stack();
    const seen: DesignDocument[] = [];
    const off = s.subscribe((doc) => seen.push(doc));
    const before = s.document;
    const next = s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 33 } });
    expect(rectOf(next, 'r1').x).toBe(33);
    expect(s.document).toBe(next);
    expect(before).not.toBe(next);
    expect(seen).toHaveLength(1);
    off();
    s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 34 } });
    expect(seen).toHaveLength(1);
  });

  it('freeze 模式下产出的文档被深冻结：任何就地写入立刻抛错', () => {
    const s = new CommandStack(baseDoc(), { freeze: true });
    const doc = s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 1 } });
    expect(Object.isFrozen(doc)).toBe(true);
    expect(() => {
      (getPage(doc, 'p1').nodes.r1 as { x: number }).x = 999;
    }).toThrow(TypeError);
    // 冻结不影响后续命令（不可变路径）
    const after = s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 5 } });
    expect(rectOf(after, 'r1').x).toBe(5);
  });

  it('未注册/非法命令不改变文档，也不进历史', () => {
    const s = stack();
    const before = s.document;
    expect(() =>
      s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } }),
    ).toThrow('节点不存在');
    expect(s.document).toBe(before);
    expect(s.canUndo).toBe(false);
  });
});

describe('commands · 事务原子性', () => {
  it('事务中任一命令失败则整体回滚（不留半成品）', () => {
    const s = stack();
    const before = s.document;
    expect(() =>
      s.dispatch([
        { type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 111 } },
        { type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } },
        { type: 'node.update', pageId: 'p1', nodeId: 'r2', patch: { x: 222 } },
      ]),
    ).toThrow('节点不存在');
    expect(s.document).toBe(before);
    expect(rectOf(s.document, 'r1').x).toBe(10);
    expect(rectOf(s.document, 'r2').x).toBe(70);
    expect(s.canUndo).toBe(false);
  });

  it('多命令事务只产生一条历史', () => {
    const s = stack();
    s.dispatch([
      { type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 11 } },
      { type: 'node.update', pageId: 'p1', nodeId: 'r2', patch: { x: 12 } },
    ]);
    expect(s.history().undo).toHaveLength(1);
    s.undo();
    expect(rectOf(s.document, 'r1').x).toBe(10);
    expect(rectOf(s.document, 'r2').x).toBe(70);
  });
});

describe('commands · 撤销/重做往返恒等', () => {
  function roundTrip(commands: Command[]): { before: DesignDocument; after: DesignDocument } {
    const s = stack();
    const before = s.document;
    const after = s.dispatch(commands);
    s.undo();
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(JSON.parse(JSON.stringify(before)));
    s.redo();
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(JSON.parse(JSON.stringify(after)));
    return { before, after };
  }

  it('移动、属性、层级、改父、插入、删除都满足 undo → redo 恒等', () => {
    roundTrip([{ type: 'node.move', pageId: 'p1', nodeIds: ['r1', 'r2'], dx: 5, dy: -3 }]);
    roundTrip([
      { type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 1, width: 99, name: '改名' } },
    ]);
    roundTrip([{ type: 'node.reorder', pageId: 'p1', nodeId: 'r1', op: 'front' }]);
    roundTrip([{ type: 'node.reparent', pageId: 'p1', nodeId: 'r1', parentId: null }]);
    roundTrip([
      { type: 'node.insert', pageId: 'p1', node: createRect({ id: 'new1' }), parentId: 'f1' },
    ]);
    roundTrip([{ type: 'node.remove', pageId: 'p1', nodeId: 'f1' }]);
  });

  it('删除子树后撤销可完整还原（含后代与父级位置）', () => {
    const s = stack();
    const before = JSON.parse(JSON.stringify(s.document));
    s.dispatch({ type: 'node.remove', pageId: 'p1', nodeId: 'f1' });
    expect(getPage(s.document, 'p1').nodes.r1).toBeUndefined();
    expect(getPage(s.document, 'p1').rootIds).toEqual(['t1']);
    s.undo();
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
    expect(validateDocument(s.document)).toEqual([]);
  });

  it('撤销后新写入清空重做栈', () => {
    const s = stack();
    s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 1 } });
    s.undo();
    expect(s.canRedo).toBe(true);
    s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 2 } });
    expect(s.canRedo).toBe(false);
  });

  it('redo 可重放多步（栈语义）', () => {
    const s = stack();
    s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 1 } });
    s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 2 } });
    s.undo();
    s.undo();
    expect(rectOf(s.document, 'r1').x).toBe(10);
    expect(s.redo()).toBe(true);
    expect(rectOf(s.document, 'r1').x).toBe(1);
    expect(s.redo()).toBe(true);
    expect(rectOf(s.document, 'r1').x).toBe(2);
    expect(s.redo()).toBe(false);
  });
});

describe('commands · 微任务结算', () => {
  it('同一微任务内的多次 enqueue 合并为一条历史', async () => {
    const s = stack();
    s.enqueue(
      { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 0 },
      { label: '拖动' },
    );
    s.enqueue({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 0 });
    expect(s.pendingCount).toBe(2);
    expect(s.canUndo).toBe(false); // 尚未结算
    await Promise.resolve();
    expect(s.pendingCount).toBe(0);
    expect(rectOf(s.document, 'r1').x).toBe(12);
    expect(s.history()).toEqual({ undo: ['拖动'], redo: [] });
  });

  it('flush 可显式结算，且结算失败会抛错并保持文档不变', () => {
    const s = stack();
    s.enqueue({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 42 } });
    s.flush();
    expect(rectOf(s.document, 'r1').x).toBe(42);

    s.enqueue({ type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } });
    expect(() => s.flush()).toThrow('节点不存在');
    expect(rectOf(s.document, 'r1').x).toBe(42);
  });

  it('微任务结算失败被记录（不炸进程），并回调 onError', async () => {
    const onError = vi.fn();
    const s = new CommandStack(baseDoc(), { onError });
    s.enqueue({ type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.lastError).toBeInstanceOf(Error);
    expect(rectOf(s.document, 'r1').x).toBe(10);
  });
});

describe('commands · helpers（语义级构造）', () => {
  it('按世界增量移动：父坐标系被旋转时逐节点换算', () => {
    let doc = baseDoc();
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'rp', x: 0, y: 0, width: 100, height: 100, rotation: 90 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'child', x: 10, y: 10, width: 20, height: 20 }),
      'rp',
    );
    const s = new CommandStack(doc);
    const page = getPage(s.document, 'p1');
    s.dispatch(moveNodesByWorldCommands(page, 'p1', ['child', 't1'], { x: 0, y: 10 }));
    // child 的父被旋转 90° → 世界 +y 等于其局部 +x
    const child = rectOf(s.document, 'child');
    expect(child.x).toBeCloseTo(20);
    expect(child.y).toBeCloseTo(10);
    expect(rectOf(s.document, 't1').y).toBe(10);
  });

  it('编组：组包围盒取并集，子节点世界形状不变', () => {
    const s = stack();
    const page = getPage(s.document, 'p1');
    const commands = groupNodesCommands(page, 'p1', ['r1', 'r2'], {
      groupId: 'g1',
      ids: createIdFactory(1),
    });
    s.dispatch(commands);
    const group = requireNode(getPage(s.document, 'p1'), 'g1');
    expect(group.type).toBe('group');
    expect([group.x, group.y, group.width, group.height]).toEqual([10, 10, 110, 50]);
    expect(childrenOf(group)).toEqual(['r1', 'r2']);
    // 世界坐标不变：r1 世界 (10,10)
    expect(rectOf(s.document, 'r1')).toMatchObject({ x: 0, y: 0 });
    s.undo();
    expect(rectOf(s.document, 'r1')).toMatchObject({ x: 10, y: 10 });
    expect(
      requireNode(getPage(s.document, 'p1'), 'f1') &&
        getChildrenIds(getPage(s.document, 'p1'), 'f1'),
    ).toEqual(['r1', 'r2']);
  });

  it('编组拒绝跨父级选择', () => {
    const s = stack();
    const page = getPage(s.document, 'p1');
    expect(() => groupNodesCommands(page, 'p1', ['r1', 't1'], { groupId: 'g9' })).toThrow(
      '同一父级',
    );
  });

  it('解组：子节点回到组的父级且世界形状不变', () => {
    const s = stack();
    const page = getPage(s.document, 'p1');
    s.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const page2 = getPage(s.document, 'p1');
    s.dispatch(dissolveGroupCommands(page2, 'p1', 'g1'));
    const page3 = getPage(s.document, 'p1');
    expect(page3.nodes.g1).toBeUndefined();
    expect(getChildrenIds(page3, 'f1')).toEqual(['r1', 'r2']);
    expect(rectOf(s.document, 'r1')).toMatchObject({ x: 10, y: 10 });
    expect(rectOf(s.document, 'r2')).toMatchObject({ x: 70, y: 10 });
  });

  it('保持世界位置的改父（含旋转父级）', () => {
    let doc = baseDoc();
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'rot', x: 0, y: 0, width: 100, height: 100, rotation: 90 }),
      null,
    );
    const s = new CommandStack(doc);
    const page = getPage(s.document, 'p1');
    const before = frameTransformPatch(page, 't1', 'rot');
    expect(before).not.toBeNull();
    s.dispatch(reparentPreservingWorldCommands(page, 'p1', 't1', 'rot'));
    const after = getPage(s.document, 'p1');
    expect(rectOf(s.document, 't1').rotation).toBeCloseTo(-90);
    expect(getChildrenIds(after, 'rot')).toEqual(['t1']);
  });

  it('删除选中：父被选中时不再单独删子', () => {
    const s = stack();
    const page = getPage(s.document, 'p1');
    const commands = deleteNodesCommands(page, 'p1', ['f1', 'r1']);
    expect(commands).toHaveLength(1);
    s.dispatch(commands);
    expect(getPage(s.document, 'p1').nodes.r1).toBeUndefined();
  });

  it('虚节点属性写入路由为实例覆盖（C17）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'cr1', x: 10, y: 10, width: 20, height: 20 }),
      'c1',
    );
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 200, y: 0 }),
      null,
    );
    const s = new CommandStack(doc);
    s.dispatch(patchNodeCommands('p1', 'i1::cr1', { width: 40 }));
    const instance = requireNode(getPage(s.document, 'p1'), 'i1');
    expect(instance.type).toBe('instance');
    if (instance.type !== 'instance') return;
    expect(instance.overrides).toEqual({ cr1: { width: 40 } });
    s.undo();
    const after = requireNode(getPage(s.document, 'p1'), 'i1');
    expect(after.type === 'instance' && after.overrides).toEqual({});
  });

  it('编组/解组/改父均可撤销到完全一致', () => {
    for (const build of [
      (page: ReturnType<typeof getPage>) =>
        groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'gp' }),
    ]) {
      const s = stack();
      const before = JSON.parse(JSON.stringify(s.document));
      s.dispatch(build(getPage(s.document, 'p1')));
      s.undo();
      expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
    }
    const s2 = stack();
    const before2 = JSON.parse(JSON.stringify(s2.document));
    const page = getPage(s2.document, 'p1');
    s2.dispatch(reparentPreservingWorldCommands(page, 'p1', 'r1', null));
    s2.undo();
    expect(JSON.parse(JSON.stringify(s2.document))).toEqual(before2);
    void createGroup;
  });
});

/**
 * 票 05 · 编组坐标系换算：容器定位与子项补丁一律经父坐标系逆换算。
 * 现有夹具把父级画板全放在 (0,0)，掩盖了「世界 AABB 被直接当父相对坐标」的缺陷——
 * 本组用例特意把父级画板放在非零坐标 / 带旋转，并与解组形成对称往返断言。
 */
describe('commands · 编组坐标系（父级非零偏移/旋转）', () => {
  /** 父级非零坐标夹具：fe(100,80,200×200[,rot]) ⊃ [r1(10,10,50,50), r2(70,30,40,20[,rot])]。 */
  function offsetDoc(frameRotation = 0, childRotation = 0): DesignDocument {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'fe', x: 100, y: 80, width: 200, height: 200, rotation: frameRotation }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
        createRect({ id: 'r2', x: 70, y: 30, width: 40, height: 20, rotation: childRotation }),
      ],
      'fe',
    );
    return doc;
  }

  /** 节点世界四角快照（世界形状不变断言用）。 */
  function worldQuadsOf(doc: DesignDocument, ids: readonly string[]): Record<string, Point[]> {
    const page = getPage(doc, 'p1');
    return Object.fromEntries(ids.map((id) => [id, worldQuad(page, id) ?? []]));
  }

  /** 断言各节点世界四角与快照逐点一致（容差 1e-8，覆盖父级旋转下的矩阵逆换算浮点噪声）。 */
  function expectWorldQuadsUnchanged(doc: DesignDocument, before: Record<string, Point[]>): void {
    const page = getPage(doc, 'p1');
    for (const [id, quad] of Object.entries(before)) {
      const after = worldQuad(page, id) ?? [];
      expect(after).toHaveLength(quad.length);
      after.forEach((point, index) => {
        const expected = quad[index];
        if (!expected) return;
        expect(point.x).toBeCloseTo(expected.x, 8);
        expect(point.y).toBeCloseTo(expected.y, 8);
      });
    }
  }

  it('编组：容器落位与子项补丁经父坐标系逆换算（父级非零偏移时整组不瞬移）', () => {
    const s = new CommandStack(offsetDoc());
    const before = worldQuadsOf(s.document, ['r1', 'r2']);
    const page = getPage(s.document, 'p1');
    s.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const after = getPage(s.document, 'p1');
    const group = requireNode(after, 'g1');
    // 组 x/y 语义为相对父容器：应等于选中并集在 fe 局部坐标系的 AABB (10,10,100,50)，
    // 而非世界 AABB (110,90,100,50)——后者会把整组瞬移一个父偏移
    expect([group.x, group.y, group.width, group.height]).toEqual([10, 10, 100, 50]);
    expect(getChildrenIds(after, 'g1')).toEqual(['r1', 'r2']);
    // 子项补丁落在组局部坐标系：r1 → (0,0)、r2 → (60,20)，自转角保持
    expect(requireNode(after, 'r1')).toMatchObject({ x: 0, y: 0, rotation: 0 });
    expect(requireNode(after, 'r2')).toMatchObject({ x: 60, y: 20, rotation: 0 });
    // 各子节点世界形状逐角不变
    expectWorldQuadsUnchanged(s.document, before);
  });

  it('编组：父级带旋转时子项旋转补丁减去父系角，世界形状不变', () => {
    const s = new CommandStack(offsetDoc(30, 20));
    const initial = JSON.parse(JSON.stringify(s.document));
    const before = worldQuadsOf(s.document, ['r1', 'r2']);
    const page = getPage(s.document, 'p1');
    s.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const after = getPage(s.document, 'p1');
    // 旋转补丁 = 世界角 − 父系角：r2 应为 20（而非世界角 30+20=50）
    expect(requireNode(after, 'r1').rotation).toBe(0);
    expect(requireNode(after, 'r2').rotation).toBe(20);
    // 子项世界形状逐角不变（位置与旋转都经父坐标系逆换算）
    expectWorldQuadsUnchanged(s.document, before);
    // 撤销精确还原
    expect(s.undo()).toBe(true);
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(initial);
  });

  it('对称往返：成组→解组→成组逐字段恒等（父级非零偏移）', () => {
    const s = new CommandStack(offsetDoc());
    const page = getPage(s.document, 'p1');
    s.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const afterFirstGroup = JSON.parse(JSON.stringify(s.document));
    // 解组把子项精确送回 fe 局部原坐标（与编组互为逆运算）
    s.dispatch(dissolveGroupCommands(getPage(s.document, 'p1'), 'p1', 'g1'));
    const dissolved = getPage(s.document, 'p1');
    expect(requireNode(dissolved, 'r1')).toMatchObject({ x: 10, y: 10, rotation: 0 });
    expect(requireNode(dissolved, 'r2')).toMatchObject({ x: 70, y: 30, rotation: 0 });
    // 再成组：与第一次成组结果逐字段恒等
    s.dispatch(
      groupNodesCommands(getPage(s.document, 'p1'), 'p1', ['r1', 'r2'], { groupId: 'g1' }),
    );
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(afterFirstGroup);
  });

  it('对称往返：成组→解组→成组逐字段恒等（父级带旋转，浮点容差）', () => {
    const s = new CommandStack(offsetDoc(30, 20));
    const page = getPage(s.document, 'p1');
    s.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const afterFirstGroup = JSON.parse(JSON.stringify(s.document));
    s.dispatch(dissolveGroupCommands(getPage(s.document, 'p1'), 'p1', 'g1'));
    const dissolved = getPage(s.document, 'p1');
    // 解组把子项送回 fe 局部原坐标（旋转父系下坐标有 ~1e-13 矩阵逆换算噪声）
    expect(requireNode(dissolved, 'r1').x).toBeCloseTo(10, 8);
    expect(requireNode(dissolved, 'r1').y).toBeCloseTo(10, 8);
    expect(requireNode(dissolved, 'r2').x).toBeCloseTo(70, 8);
    expect(requireNode(dissolved, 'r2').y).toBeCloseTo(30, 8);
    // 再成组：与第一次成组逐字段恒等（旋转角精确，坐标在浮点容差内）
    s.dispatch(
      groupNodesCommands(getPage(s.document, 'p1'), 'p1', ['r1', 'r2'], { groupId: 'g1' }),
    );
    const first = getPage(afterFirstGroup, 'p1');
    const second = getPage(s.document, 'p1');
    for (const id of ['g1', 'r1', 'r2']) {
      const a = requireNode(first, id);
      const b = requireNode(second, id);
      expect(b.rotation).toBe(a.rotation);
      expect(b.x).toBeCloseTo(a.x, 8);
      expect(b.y).toBeCloseTo(a.y, 8);
      expect(b.width).toBeCloseTo(a.width, 8);
      expect(b.height).toBeCloseTo(a.height, 8);
    }
  });
});
