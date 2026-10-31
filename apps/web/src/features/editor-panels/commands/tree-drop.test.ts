// @vitest-environment node
/**
 * Tree 拖拽落位约定测试（RW-13 · 兑现 RW-07 留给本票的「落位语义」；票 11 修正显示序映射）。
 *
 * seam：`resolveTreeDropPlacement`（纯函数）+ 它与 `moveLayerCommands` 的组合产物。
 * 断言口径：落点（父级 + 摘除后下标 + 前后缘）、无效落点拒绝（不发命令）、
 * 跨父拖拽产出 `node.reparent` 命令族、一次 drop 恰好一个事务（历史恰一条）——
 * **最终顺序断言走真 CommandStack 施加后读文档**（用户可见的绘制顺序），不只断中间下标
 * （巡检教训：旧断言只验下标，映射反了照样绿）。
 *
 * **RW-13 落位约定**（详注见 tree-drop.ts；票 11 修正）：
 * - 面板显示 = 绘制顺序的**逆序**（最上层显示在最前）。target 行垂直中线为界（上/下各半）：
 *   上半 → 插到 target 的**面板上方**（= 绘制序 target 之后），下半 → 面板下方
 *   （= 绘制序 target 之前）；无指针信息（几何不可得）按「上半」降级；
 * - 跨父拖拽 = reparent（落点父级 = target 的父级）；「放入容器内部」不在 Tree v1 约定内；
 * - 无效落点（自身、自身子树、实例虚节点参与结构移动）→ null；
 * - 拖拽重排是**可撤销事务**：一次 drop 一条历史，undo 后顺序还原（票 11 验收）。
 */
import {
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
  getPage,
  insertNode,
  insertNodes,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { moveLayerCommands } from './layer-commands';
import { resolveTreeDropPlacement } from './tree-drop';

/**
 * 夹具（绘制顺序）：f1 ⊃ [r1, r2, g1 ⊃ [t1]]，f2 ⊃ [f2c1]，c1 组件 ⊃ [cr1]，i1 实例（指 c1）。
 * 与图层面板夹具同族，另给 f2 一个子行（Tree v1 落位无 inside，跨父进容器要靠子行落点）。
 */
function fixture(): DesignDocument {
  let doc = createDocument({ id: 'doc-drop', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f1', name: '首屏', width: 200, height: 200 }),
    null,
  );
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', name: '背景块', width: 50, height: 50 }),
      createRect({ id: 'r2', name: '卡片', x: 70, width: 50, height: 50 }),
      createGroup({ id: 'g1', name: '标题组', width: 40, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', name: '标题', width: 40, height: 20 }), 'g1');
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f2', name: '第二屏', x: 400, width: 100, height: 100 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createRect({ id: 'f2c1', name: '第二屏内容', x: 400, width: 20, height: 20 }),
    'f2',
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', name: '按钮', x: 0, y: 300, width: 100, height: 40 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createRect({ id: 'cr1', name: '底板', width: 100, height: 40 }),
    'c1',
  );
  doc = insertNode(
    doc,
    'p1',
    createInstance({ id: 'i1', name: '按钮实例', componentId: 'c1', x: 0, y: 400 }),
    null,
  );
  return doc;
}

const doc = fixture();
const page = getPage(doc, 'p1');

/**
 * 面板显示序（f1 内，上→下）：标题组(g1)、卡片(r2)、背景块(r1)——children 的逆序。
 * 「before」= 面板中 target 上方（绘制序 target 之后）；「after」= 面板下方（绘制序之前）。
 */
describe('resolveTreeDropPlacement · 落位约定（上/下各半，显示序语义）', () => {
  it('target 行上半 → 面板中插到 target 上方（绘制序 = target 之后）', () => {
    // g1 落到 r2 行上半：g1 在面板里已在 r2 上方 → 原位（下标 2 = 绘制序末尾）
    // siblings 去掉 g1 = [r1, r2]，r2 位置 1 → before → index 2
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 170, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 2, edge: 'before' });
  });

  it('target 行下半 → 面板中插到 target 下方（绘制序 = target 之前）', () => {
    // 背景块(r1，面板最下)落到标题组(g1，面板最上)下半 → 紧贴标题组下方、卡片上方
    // siblings 去掉 r1 = [r2, g1]，g1 位置 1 → after → index 1
    expect(
      resolveTreeDropPlacement(page, 'r1', 'g1', { y: 130, rowTop: 112, rowBottom: 140 }),
    ).toEqual({ parentId: 'f1', index: 1, edge: 'after' });
  });

  it('中线恰好命中按下半（约定：上/下各半，中点归下半）', () => {
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 182, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 1, edge: 'after' });
  });

  it('指针越过行上缘/下缘越界按最近缘处理', () => {
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 100, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 2, edge: 'before' });
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 300, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 1, edge: 'after' });
  });

  it('无指针信息（几何不可得）按「上半（before）」降级', () => {
    expect(resolveTreeDropPlacement(page, 'g1', 'r2', null)).toEqual({
      parentId: 'f1',
      index: 2,
      edge: 'before',
    });
  });
});

describe('resolveTreeDropPlacement · 无效落点拒绝', () => {
  it('source 落到自身 → null', () => {
    expect(
      resolveTreeDropPlacement(page, 'r1', 'r1', { y: 0, rowTop: 0, rowBottom: 28 }),
    ).toBeNull();
  });

  it('target 在 source 子树内（会成环）→ null', () => {
    expect(
      resolveTreeDropPlacement(page, 'f1', 't1', { y: 0, rowTop: 0, rowBottom: 28 }),
    ).toBeNull();
  });

  it('实例虚节点参与结构移动 → null（source 或 target 皆拒）', () => {
    // 实例的子行是虚 id（经主组件解析），结构不可移动
    const virtualChild = getChildrenIds(page, 'i1')[0] as string;
    expect(virtualChild).toBeTruthy();
    expect(resolveTreeDropPlacement(page, 'r1', virtualChild, null)).toBeNull();
    expect(resolveTreeDropPlacement(page, virtualChild, 'r2', null)).toBeNull();
  });

  it('节点不存在 → null', () => {
    expect(resolveTreeDropPlacement(page, 'ghost', 'r2', null)).toBeNull();
    expect(resolveTreeDropPlacement(page, 'r1', 'ghost', null)).toBeNull();
  });
});

describe('落位 → 引擎命令族（与 moveLayerCommands 组合；最终顺序走真 CommandStack 断言）', () => {
  /** 面板显示序（children 逆序的可读形式）：按绘制序数组反推面板自上而下的 id 序列。 */
  const displayOrder = (childrenIds: readonly string[]): string[] => [...childrenIds].reverse();

  it('同父拖拽 = 纯重排：产出 [node.update, node.reparent]，父级不变', () => {
    const placement = resolveTreeDropPlacement(page, 'r1', 'g1', {
      y: 130,
      rowTop: 112,
      rowBottom: 140,
    });
    expect(placement).not.toBeNull();
    const spot = placement as NonNullable<typeof placement>;
    const commands = moveLayerCommands(page, 'p1', 'r1', spot.parentId, spot.index);
    expect(commands.map((command) => command.type)).toEqual(['node.update', 'node.reparent']);
    const reparent = commands[1] as { type: string; parentId: string | null; index: number };
    expect(reparent.parentId).toBe('f1');
    expect(reparent.index).toBe(1);
  });

  it('拖拽重排真实生效：落点行序按面板语义变化，且为可撤销事务（undo 还原顺序）', () => {
    const stack = new CommandStack(fixture(), { freeze: true });
    const childrenNow = () => getChildrenIds(getPage(stack.document, 'p1'), 'f1');
    // 初始面板序（上→下）：标题组、卡片、背景块
    expect(displayOrder(childrenNow())).toEqual(['g1', 'r2', 'r1']);

    // 背景块拖到标题组行下半 → 面板里紧贴标题组下方（卡片上方）
    const placement = resolveTreeDropPlacement(
      getPage(stack.document, 'p1'),
      'r1',
      'g1',
      { y: 130, rowTop: 112, rowBottom: 140 },
    );
    expect(placement).toEqual({ parentId: 'f1', index: 1, edge: 'after' });
    const spot = placement as NonNullable<typeof placement>;
    stack.dispatch(
      moveLayerCommands(getPage(stack.document, 'p1'), 'p1', 'r1', spot.parentId, spot.index),
      { label: '移动图层' },
    );
    expect(displayOrder(childrenNow())).toEqual(['g1', 'r1', 'r2']);
    // 单事务：一次 drop 恰好一条历史
    expect(stack.history().undo).toEqual(['移动图层']);

    // 可撤销：undo 后顺序还原
    expect(stack.undo()).toBe(true);
    expect(displayOrder(childrenNow())).toEqual(['g1', 'r2', 'r1']);
    expect(stack.canRedo).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(displayOrder(childrenNow())).toEqual(['g1', 'r1', 'r2']);
  });

  it('上移到面板最上：背景块落到标题组行上半 → 面板顶（绘制序末尾）', () => {
    const stack = new CommandStack(fixture(), { freeze: true });
    const placement = resolveTreeDropPlacement(
      getPage(stack.document, 'p1'),
      'r1',
      'g1',
      { y: 114, rowTop: 112, rowBottom: 140 },
    );
    expect(placement).toEqual({ parentId: 'f1', index: 2, edge: 'before' });
    const spot = placement as NonNullable<typeof placement>;
    stack.dispatch(
      moveLayerCommands(getPage(stack.document, 'p1'), 'p1', 'r1', spot.parentId, spot.index),
      { label: '移动图层' },
    );
    expect(displayOrder(getChildrenIds(getPage(stack.document, 'p1'), 'f1'))).toEqual([
      'r1',
      'g1',
      'r2',
    ]);
  });

  it('已就位的落点 = 无操作：不发命令、不写历史（CommandStack 不被空事务污染）', () => {
    const stack = new CommandStack(fixture(), { freeze: true });
    // 背景块落到卡片行下半：面板里已在卡片下方 → 原位
    const placement = resolveTreeDropPlacement(
      getPage(stack.document, 'p1'),
      'r1',
      'r2',
      { y: 186, rowTop: 168, rowBottom: 196 },
    );
    expect(placement).toEqual({ parentId: 'f1', index: 0, edge: 'after' });
    const spot = placement as NonNullable<typeof placement>;
    const commands = moveLayerCommands(
      getPage(stack.document, 'p1'),
      'p1',
      'r1',
      spot.parentId,
      spot.index,
    );
    expect(commands).toEqual([]);
    stack.dispatch(commands, { label: '移动图层' });
    expect(stack.history().undo).toHaveLength(0);
    expect(displayOrder(getChildrenIds(getPage(stack.document, 'p1'), 'f1'))).toEqual([
      'g1',
      'r2',
      'r1',
    ]);
  });

  it('跨父拖拽 = reparent：落到 target 的父级（f1 的卡片进第二屏，世界位置保持）', () => {
    // 卡片(r2, in f1) 落到「第二屏内容」(f2c1, in f2) 下半 → f2 同级序列、面板里在 f2c1 下方
    const placement = resolveTreeDropPlacement(page, 'r2', 'f2c1', {
      y: 108,
      rowTop: 84,
      rowBottom: 112,
    });
    expect(placement).toEqual({ parentId: 'f2', index: 0, edge: 'after' });
    const spot = placement as NonNullable<typeof placement>;
    const commands = moveLayerCommands(page, 'p1', 'r2', spot.parentId, spot.index);
    const reparent = commands[1] as { type: string; parentId: string | null; index: number };
    expect(reparent.parentId).toBe('f2');
    expect(reparent.index).toBe(0);
  });

  it('无效落点不产命令：moveLayerCommands 对 null 落点无输入（这里验「落进自身子树」被 placement 拒）', () => {
    expect(resolveTreeDropPlacement(page, 'f1', 't1', null)).toBeNull();
  });
});
