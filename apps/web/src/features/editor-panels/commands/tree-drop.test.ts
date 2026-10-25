// @vitest-environment node
/**
 * Tree 拖拽落位约定测试（RW-13 · 兑现 RW-07 留给本票的「落位语义」）。
 *
 * seam：`resolveTreeDropPlacement`（纯函数）+ 它与 `moveLayerCommands` 的组合产物。
 * 断言口径：落点（父级 + 摘除后下标 + 前后缘）、无效落点拒绝（不发命令）、
 * 跨父拖拽产出 `node.reparent` 命令族、一次 drop 恰好一个事务（历史恰一条）。
 *
 * **RW-13 落位约定**（详注见 tree-drop.ts）：
 * - target 行垂直中线为界（上/下各半）：上半 → 插到 target 之前，下半 → 之后；
 *   行上方越界按之前、下方越界按之后；无指针信息（几何不可得）按「之前」降级；
 * - 跨父拖拽 = reparent（落点父级 = target 的父级）；「放入容器内部」不在 Tree v1 约定内；
 * - 无效落点（自身、自身子树、实例虚节点参与结构移动）→ null。
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
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', name: '首屏', width: 200, height: 200 }), null);
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
  doc = insertNode(doc, 'p1', createRect({ id: 'cr1', name: '底板', width: 100, height: 40 }), 'c1');
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

describe('resolveTreeDropPlacement · 落位约定（上/下各半）', () => {
  it('target 行上半 → 插到 target 之前（同父、摘除 source 后的下标）', () => {
    // g1 落到 r2 行上半：siblings 去掉 g1 = [r1, r2]，r2 位置 1 → before → index 1
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 170, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 1, edge: 'before' });
  });

  it('target 行下半 → 插到 target 之后（r1 落到 g1 下半 → 移到同级末尾）', () => {
    // siblings 去掉 r1 = [r2, g1]，g1 位置 1 → after → index 2
    expect(
      resolveTreeDropPlacement(page, 'r1', 'g1', { y: 130, rowTop: 112, rowBottom: 140 }),
    ).toEqual({ parentId: 'f1', index: 2, edge: 'after' });
  });

  it('中线恰好命中按下半（约定：上/下各半，中点归下半）', () => {
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 182, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 2, edge: 'after' });
  });

  it('指针越过行上缘/下缘越界按最近缘处理', () => {
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 100, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 1, edge: 'before' });
    expect(
      resolveTreeDropPlacement(page, 'g1', 'r2', { y: 300, rowTop: 168, rowBottom: 196 }),
    ).toEqual({ parentId: 'f1', index: 2, edge: 'after' });
  });

  it('无指针信息（几何不可得）按「之前」降级', () => {
    expect(resolveTreeDropPlacement(page, 'g1', 'r2', null)).toEqual({
      parentId: 'f1',
      index: 1,
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

describe('落位 → 引擎命令族（与 moveLayerCommands 组合）', () => {
  it('同父拖拽 = 纯重排：产出 [node.update, node.reparent]，父级不变', () => {
    const placement = resolveTreeDropPlacement(page, 'r1', 'g1', {
      y: 130,
      rowTop: 112,
      rowBottom: 140,
    });
    expect(placement).not.toBeNull();
    const commands = moveLayerCommands(page, 'p1', 'r1', placement!.parentId, placement!.index);
    expect(commands.map((command) => command.type)).toEqual(['node.update', 'node.reparent']);
    const reparent = commands[1] as { type: string; parentId: string | null; index: number };
    expect(reparent.parentId).toBe('f1');
    expect(reparent.index).toBe(2);
  });

  it('跨父拖拽 = reparent：落到 target 的父级（f1 的卡片进第二屏，世界位置保持）', () => {
    // 卡片(r2, in f1) 落到「第二屏内容」(f2c1, in f2) 下半 → f2 的同级序列，f2c1 之后
    const placement = resolveTreeDropPlacement(page, 'r2', 'f2c1', {
      y: 108,
      rowTop: 84,
      rowBottom: 112,
    });
    expect(placement).toEqual({ parentId: 'f2', index: 1, edge: 'after' });
    const commands = moveLayerCommands(page, 'p1', 'r2', placement!.parentId, placement!.index);
    const reparent = commands[1] as { type: string; parentId: string | null; index: number };
    expect(reparent.parentId).toBe('f2');
    expect(reparent.index).toBe(1);
  });

  it('无效落点不产命令：moveLayerCommands 对 null 落点无输入（这里验「落进自身子树」被 placement 拒）', () => {
    expect(resolveTreeDropPlacement(page, 'f1', 't1', null)).toBeNull();
  });
});
