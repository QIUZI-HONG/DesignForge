import { describe, expect, it, vi } from 'vitest';
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
  createText,
  type DesignDocument,
  defaultAutoLayout,
  defaultTextContent,
  solidPaint,
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
  CommandError,
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

  it('小数增量移动撤销逐字段还原（浮点相对量 (x+dx)-dx ≠ x → 逆命令必须由状态推导）', () => {
    // 确定性漂移对：x=10 处 (10+6.1)-6.1 = 10.000000000000002（整数增量永测不出）
    roundTrip([{ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 6.1, dy: 6.4 }]);
  });

  it('跨父级多选小数增量移动同样满足 undo → redo 恒等', () => {
    // r1 在 f1 内、t1 在页面顶层：多选跨父级，各自按父坐标系平移
    roundTrip([{ type: 'node.move', pageId: 'p1', nodeIds: ['r1', 't1'], dx: 6.1, dy: 6.4 }]);
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

// ---------------------------------------------------------------------------
// B5（票 08 · 证据 §B5）：node.update 键适用性
//
// NodePatch 是全类型联合，类型系统挡不住「把 frame 的键发给 rect」；修前
// setNodeProps 逐键赋值会在目标节点上留下未知自有键（undo 不还原、随序列化落盘）。
// 定案：**拒绝**（invalid-argument），不用静默过滤——命令栈自称唯一写入口，
// 对非法载荷的一贯处置是显式拒绝（NaN 载荷 / not-a-container 同族），
// 且拒绝发生在写之前，「撤销到初始文档」不变式无条件成立。
// ---------------------------------------------------------------------------

/** 从命令栈捕获 CommandError 错误码（无错误时返回 null）。 */
function errorCodeOf(dispatch: () => void): string | null {
  try {
    dispatch();
  } catch (error) {
    return error instanceof CommandError ? error.code : null;
  }
  return null;
}

describe('commands · node.update 键适用性（B5）', () => {
  it('跨类型键被拒绝：对 rect 发 text 补丁 → invalid-argument，文档与历史不变', () => {
    const s = stack();
    const before = JSON.parse(JSON.stringify(s.document));
    const code = errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { text: { ...defaultTextContent(), characters: '不该落在矩形上' } } as never,
      }),
    );
    expect(code).toBe('invalid-argument');
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
    expect(s.history().undo).toHaveLength(0);
    expect(validateDocument(s.document)).toEqual([]);
  });

  it('各类型的特有键发给别的类型都被拒绝（autoLayout/clipsContent/variantProperties/text）', () => {
    // r1=rect：frame 的 autoLayout/clipsContent、component 的 variantProperties、text 的 text 全不适用
    const patches = [
      { autoLayout: defaultAutoLayout('vertical') },
      { clipsContent: false },
      { variantProperties: { size: 'large' } },
      { text: defaultTextContent() },
    ] as const;
    for (const patch of patches) {
      const s = stack();
      const before = JSON.parse(JSON.stringify(s.document));
      const code = errorCodeOf(() =>
        s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { ...patch } as never }),
      );
      expect(code, `补丁键 ${Object.keys(patch).join(',')} 应被拒绝`).toBe('invalid-argument');
      expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
    }
  });

  it('未知键被拒绝：Design IR 没有的字段不能经 node.update 落进节点', () => {
    const s = stack();
    const before = JSON.parse(JSON.stringify(s.document));
    const code = errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { 自定义字段: 1 } as never,
      }),
    );
    expect(code).toBe('invalid-argument');
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
  });

  it('结构性键被拒绝：children/componentId/overrides 走专用命令，不经 node.update 改写', () => {
    for (const key of ['children', 'componentId', 'overrides', 'id', 'type'] as const) {
      const s = stack();
      const before = JSON.parse(JSON.stringify(s.document));
      const code = errorCodeOf(() =>
        s.dispatch({
          type: 'node.update',
          pageId: 'p1',
          nodeId: 'r1',
          patch: { [key]: '篡改' } as never,
        }),
      );
      expect(code, `结构性键 ${key} 应被拒绝`).toBe('invalid-argument');
      expect(JSON.parse(JSON.stringify(s.document))).toEqual(before);
    }
  });

  it('报告键名与节点类型，便于调用方定位补丁构造错误', () => {
    const s = stack();
    let message = '';
    try {
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { autoLayout: null } as never,
      });
    } catch (error) {
      if (error instanceof CommandError) message = error.message;
    }
    expect(message).toContain('autoLayout');
    expect(message).toContain('rect');
  });

  it('证据原貌回归：对 group 发 autoLayout 补丁被拒绝（修前会留下自有键残留且 undo 不还原）', () => {
    const s = stack();
    s.dispatch(groupNodesCommands(getPage(s.document, 'p1'), 'p1', ['r1', 'r2'], {
      groupId: 'g9',
    }));
    const withGroup = JSON.parse(JSON.stringify(s.document));
    const code = errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'g9',
        patch: { autoLayout: null } as never,
      }),
    );
    expect(code).toBe('invalid-argument');
    // 拒绝路径：文档与历史零变动
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(withGroup);
    expect(s.history().undo).toHaveLength(1);

    // 对照组：同一键发给适用类型（frame）正常生效，撤销逐字段还原
    const code2 = errorCodeOf(() =>
      s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'f1', patch: { autoLayout: null } }),
    );
    expect(code2).toBeNull();
    expect(requireNode(getPage(s.document, 'p1'), 'f1')).toMatchObject({ autoLayout: null });
    s.undo();
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(withGroup);
  });

  it('跨类型键混合序列下「撤销到初始文档」不变式成立（拒绝的不进历史，适用的全还原）', () => {
    const s = stack();
    const initial = JSON.parse(JSON.stringify(s.document));
    // 混合：适用的（生效 + 进历史）与跨类型的（拒绝 + 不进历史）交错
    const outcomes = [
      { patch: { x: 11 } as never, applies: true },
      { patch: { autoLayout: null } as never, applies: false },
      { patch: { fills: [solidPaint('#112233')] } as never, applies: true },
      { patch: { text: defaultTextContent() } as never, applies: false },
      { patch: { name: '改名' } as never, applies: true },
    ];
    for (const { patch, applies } of outcomes) {
      const code = errorCodeOf(() =>
        s.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch }),
      );
      expect(code ? 'rejected' : 'applied').toBe(applies ? 'applied' : 'rejected');
    }
    expect(s.history().undo).toHaveLength(3);
    while (s.undo());
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(initial);
    expect(validateDocument(s.document)).toEqual([]);
  });

  it('类型特有键发给适用类型照常生效（text→text、variantProperties→component、autoLayout→frame）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createText({ id: 'tx', x: 0, y: 0, width: 80, height: 20 }), null);
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 100, y: 0, width: 80, height: 60 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 200, y: 0, width: 80, height: 60 }),
      null,
    );
    const s = new CommandStack(doc);
    expect(errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'tx',
        patch: { text: { ...defaultTextContent(), characters: '你好' } },
      }),
    )).toBeNull();
    expect(errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'c1',
        patch: { variantProperties: { size: 'large' } },
      }),
    )).toBeNull();
    expect(errorCodeOf(() =>
      s.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'f1',
        patch: { clipsContent: false, autoLayout: defaultAutoLayout('horizontal') },
      }),
    )).toBeNull();
    expect(requireNode(getPage(s.document, 'p1'), 'f1')).toMatchObject({
      clipsContent: false,
      autoLayout: expect.objectContaining({ direction: 'horizontal' }),
    });
    // 适用键的写入同样满足撤销恒等
    const applied = JSON.parse(JSON.stringify(s.document));
    while (s.undo());
    while (s.redo());
    expect(JSON.parse(JSON.stringify(s.document))).toEqual(applied);
  });
});
