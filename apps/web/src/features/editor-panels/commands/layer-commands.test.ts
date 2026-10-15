/**
 * 行交互 → 引擎命令（seam：命令构造器的公开行为）。
 *
 * 断言口径：用引擎夹具 + 真实 `CommandStack` 施加命令，再读**文档**验证结果——
 * 面板只构造命令、从不改文档对象；无操作时返回空列表（不污染撤销栈）。
 */
import {
  childrenOf,
  CommandStack,
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
  getChildrenIds,
  getNode,
  getPage,
  insertNode,
  insertNodes,
  type NodeId,
  requireNode,
  virtualNodeId,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  bringToFrontCommands,
  deleteLayerCommands,
  groupLayersCommands,
  renameLayerCommands,
  sendToBackCommands,
  setLockedCommands,
  setVisibilityCommands,
  toggleLockCommands,
  toggleVisibilityCommands,
  ungroupLayerCommands,
} from './layer-commands';

/**
 * 夹具：f1（画板 200×200）⊃ [r1(10,10,50,50), r2(70,10,50,50), g1 ⊃ [t1(0,0,40,20)]]；
 * 顶层 [t2(300,0,20,20), f2(空的画板)]。
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
  doc = insertNode(
    doc,
    'p1',
    createRect({ id: 't1', x: 0, y: 0, width: 40, height: 20 }),
    'g1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't2', x: 300, y: 0, width: 20, height: 20 }), null);
  doc = insertNode(doc, 'p1', createFrame({ id: 'f2', x: 400, y: 0, width: 100, height: 100 }), null);
  return doc;
}

function stackOf(doc: DesignDocument = baseDoc()): CommandStack {
  return new CommandStack(doc, { freeze: true });
}

/** 施加一串命令（模拟面板的写路径）。 */
function run(stack: CommandStack, commands: Parameters<CommandStack['dispatch']>[0]): DesignDocument {
  return stack.dispatch(commands, { label: '测试操作' });
}

describe('图层行命令', () => {
  it('显隐：切换产生文档变更（visible 翻转），撤销可复原', () => {
    const stack = stackOf();
    run(stack, toggleVisibilityCommands(getPage(stack.document, 'p1'), 'p1', 'r1'));
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.visible).toBe(false);
    expect(stack.undo()).toBe(true);
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.visible).toBe(true);
  });

  it('显隐：显式设值同值 → 无操作（不写历史）', () => {
    const stack = stackOf();
    expect(setVisibilityCommands(getPage(stack.document, 'p1'), 'p1', 'r1', true)).toEqual([]);
    run(stack, setVisibilityCommands(getPage(stack.document, 'p1'), 'p1', 'r1', false));
    expect(stack.canUndo).toBe(true);
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.visible).toBe(false);
  });

  it('锁定：切换产生文档变更，撤销可复原', () => {
    const stack = stackOf();
    run(stack, toggleLockCommands(getPage(stack.document, 'p1'), 'p1', 'r2'));
    expect(getNode(getPage(stack.document, 'p1'), 'r2')?.locked).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(getNode(getPage(stack.document, 'p1'), 'r2')?.locked).toBe(false);
  });

  it('锁定：显式设值命令可批量构造（多选行共用）', () => {
    const stack = stackOf();
    const page = getPage(stack.document, 'p1');
    run(stack, [...setLockedCommands(page, 'p1', 'r1', true), ...setLockedCommands(page, 'p1', 'r2', true)]);
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.locked).toBe(true);
    expect(getNode(getPage(stack.document, 'p1'), 'r2')?.locked).toBe(true);
    // 一次事务 = 一次撤销
    expect(stack.undo()).toBe(true);
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.locked).toBe(false);
    expect(getNode(getPage(stack.document, 'p1'), 'r2')?.locked).toBe(false);
  });

  it('重命名：写入新名字；同名或纯空白 → 无操作（不写历史）', () => {
    const stack = stackOf();
    const page = getPage(stack.document, 'p1');
    run(stack, renameLayerCommands(page, 'p1', 'r1', '  卡片主体  '));
    expect(getNode(getPage(stack.document, 'p1'), 'r1')?.name).toBe('卡片主体');
    expect(stack.history().undo).toEqual(['测试操作']);

    stack.clearHistory();
    expect(renameLayerCommands(getPage(stack.document, 'p1'), 'p1', 'r1', '卡片主体')).toEqual([]);
    expect(renameLayerCommands(getPage(stack.document, 'p1'), 'p1', 'r1', '   ')).toEqual([]);
  });

  it('删除：移除子树并可从历史复原', () => {
    const stack = stackOf();
    const page = getPage(stack.document, 'p1');
    run(stack, deleteLayerCommands(page, 'p1', 'g1'));
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['r1', 'r2']);
    expect(getNode(getPage(stack.document, 'p1'), 't1')).toBeUndefined();
    stack.undo();
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['r1', 'r2', 'g1']);
    expect(getNode(getPage(stack.document, 'p1'), 't1')?.id).toBe('t1');
  });

  it('编组：≥2 个同级节点包进新编组，世界位置不变；<2 个 → 无操作', () => {
    const stack = stackOf();
    const page = getPage(stack.document, 'p1');
    run(stack, groupLayersCommands(page, 'p1', ['r1', 'r2']));
    const after = getPage(stack.document, 'p1');
    const f1 = requireNode(after, 'f1');
    // 新编组落在首个选中节点的同级位置（引擎语义），组内是 r1/r2
    const groupId = childrenOf(f1).find(
      (id) => id !== 'r1' && id !== 'r2' && id !== 'g1',
    ) as NodeId;
    expect(requireNode(after, groupId).type).toBe('group');
    expect([...childrenOf(requireNode(after, groupId))].sort()).toEqual(['r1', 'r2']);
    expect(getChildrenIds(after, 'f1')).not.toContain('r1');
    // 世界位置不变：组包围盒 = 两个矩形的并集
    expect(requireNode(after, groupId).x).toBe(10);
    expect(requireNode(after, groupId).y).toBe(10);
    expect(requireNode(after, groupId).width).toBe(110);

    expect(groupLayersCommands(after, 'p1', ['r1'])).toEqual([]);
  });

  it('解组：组的子节点回到父级且保持世界位置；非编组 → 无操作', () => {
    const stack = stackOf();
    const page = getPage(stack.document, 'p1');
    run(stack, ungroupLayerCommands(page, 'p1', 'g1'));
    const after = getPage(stack.document, 'p1');
    expect(getNode(after, 'g1')).toBeUndefined();
    expect(getChildrenIds(after, 'f1')).toEqual(['r1', 'r2', 't1']);
    // t1 原在组内 (0,0)，组在 f1 内 (0,0) → 世界位置不变
    expect(requireNode(after, 't1').x).toBe(0);

    expect(ungroupLayerCommands(after, 'p1', 'r1')).toEqual([]);
  });

  it('层级：上移到顶 / 下移到底改变同级顺序；已在端位 → 无操作', () => {
    const stack = stackOf();
    let page = getPage(stack.document, 'p1');
    run(stack, bringToFrontCommands(page, 'p1', 'r1'));
    page = getPage(stack.document, 'p1');
    expect(getChildrenIds(page, 'f1')).toEqual(['r2', 'g1', 'r1']);
    expect(bringToFrontCommands(page, 'p1', 'r1')).toEqual([]);

    run(stack, sendToBackCommands(page, 'p1', 'r1'));
    page = getPage(stack.document, 'p1');
    expect(getChildrenIds(page, 'f1')).toEqual(['r1', 'r2', 'g1']);
    expect(sendToBackCommands(page, 'p1', 'r1')).toEqual([]);
  });

  it('属性命令走引擎路由：实例虚节点 → 覆盖命令（C17）', () => {
    let doc = baseDoc();
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 0, y: 300, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(doc, 'p1', createRect({ id: 'cr1', width: 50, height: 50 }), 'c1');
    doc = insertNode(doc, 'p1', createInstance({ id: 'inst1', componentId: 'c1' }), null);

    const stack = new CommandStack(doc, { freeze: true });
    const virtualId = virtualNodeId('inst1', ['cr1']);
    expect(setVisibilityCommands(getPage(stack.document, 'p1'), 'p1', virtualId, false)[0]?.type).toBe(
      'instance.setOverride',
    );
    run(stack, setVisibilityCommands(getPage(stack.document, 'p1'), 'p1', virtualId, false));
    const inst = getPage(stack.document, 'p1').nodes['inst1'];
    expect(inst && inst.type === 'instance' ? inst.overrides['cr1'] : undefined).toEqual({
      visible: false,
    });
  });
});
