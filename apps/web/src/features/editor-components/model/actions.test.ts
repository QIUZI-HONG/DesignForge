/**
 * C17 写操作（`model/actions`）规格。
 *
 * 断言全部落在**引擎文档真值**与命令栈历史上：写操作必须经命令栈提交
 *（标签用于撤销菜单），撤销后文档回到原状；实例内容经虚节点解析反映主组件与覆盖。
 */

import type { CommandStack, ScenePage } from '@dforge/engine';
import {
  createIdFactory,
  isComponentNode,
  isInstanceNode,
  type NodeId,
  resolveInstanceTree,
  resolveNode,
  worldBoundsOfNodes,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { FIXTURE_IDS, FIXTURE_OVERRIDE_FILL, fixtureStack, selectionOf } from '../testing/fixtures';
import {
  createComponentFromSelection,
  createInstanceOfComponent,
  resetOverrides,
  switchInstanceVariant,
} from './actions';

/** 取当前页面（夹具单页）。 */
function pageOf(stack: CommandStack): ScenePage {
  const page = stack.document.pages[0];
  if (page === undefined) throw new Error('夹具缺失页面');
  return page;
}

/** 取节点首个纯色填充的颜色（视图节点，覆盖已应用；无填充为 null）。 */
function fillOf(page: ScenePage, id: NodeId): string | null {
  const paint = resolveNode(page, id)?.fills[0];
  return paint === undefined ? null : paint.type === 'solid' ? paint.color : null;
}

/** 主组件内某路径节点的视图填充色（覆盖已应用）。 */
function resolvedFill(page: ScenePage, instanceId: NodeId, path: string): string | null {
  const lookupPath = path.split('/');
  let tree = resolveInstanceTree(page, instanceId);
  for (const segment of lookupPath) {
    tree = tree?.children.find((child) => child.realId === segment) ?? null;
  }
  const paint = tree?.node.fills[0];
  return paint === undefined ? null : paint.type === 'solid' ? paint.color : null;
}

describe('createComponentFromSelection（创建组件）', () => {
  it('把选中节点提升为主组件：包住选中并集（世界形状不变）', () => {
    const stack = fixtureStack();
    const before = pageOf(stack);
    const bounds = worldBoundsOfNodes(before, [FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]);

    const result = createComponentFromSelection(
      stack,
      'p1',
      selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]),
      { name: '新组件', ids: createIdFactory(100) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('未创建组件');
    const page = pageOf(stack);
    const component = page.nodes[result.componentId];
    expect(component !== undefined && isComponentNode(component)).toBe(true);
    if (!component || !isComponentNode(component)) throw new Error('未创建组件');
    expect(component.name).toBe('新组件');
    expect(component.children).toEqual([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]);
    // 世界形状不变：组件包围盒 = 提升前的选中并集
    expect(worldBoundsOfNodes(page, [component.id])).toEqual(bounds);
    // 撤销入口在位（命令栈是唯一写入口），历史标签用于撤销菜单
    expect(stack.canUndo).toBe(true);
    expect(stack.history().undo[0]).toBe('创建组件');
  });

  it('撤销后回到原状（组件消失、图层回到画板）', () => {
    const stack = fixtureStack();
    const result = createComponentFromSelection(
      stack,
      'p1',
      selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]),
      { ids: createIdFactory(100) },
    );
    if (!result.ok) throw new Error('未创建组件');
    stack.undo();
    const page = pageOf(stack);
    expect(page.nodes[result.componentId]).toBeUndefined();
    expect(page.rootIds).not.toContain(result.componentId);
  });

  it('前置不满足（跨父级/含组件）→ 不落任何命令', () => {
    const stack = fixtureStack();
    const crossParent = createComponentFromSelection(
      stack,
      'p1',
      selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectTop]),
      { ids: createIdFactory(100) },
    );
    expect(crossParent).toEqual({ ok: false, reason: 'multiple-parents' });
    const withComponent = createComponentFromSelection(
      stack,
      'p1',
      selectionOf([FIXTURE_IDS.component]),
      { ids: createIdFactory(100) },
    );
    expect(withComponent).toEqual({ ok: false, reason: 'contains-component' });
    expect(stack.canUndo).toBe(false);
  });
});

describe('createInstanceOfComponent（创建实例）', () => {
  it('新实例指向主组件，内容随主组件解析', () => {
    const stack = fixtureStack();
    const result = createInstanceOfComponent(stack, 'p1', FIXTURE_IDS.component, {
      ids: createIdFactory(200),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('未创建实例');
    const page = pageOf(stack);
    const instance = page.nodes[result.instanceId];
    expect(instance !== undefined && isInstanceNode(instance)).toBe(true);
    if (!instance || !isInstanceNode(instance)) throw new Error('未创建实例');
    expect(instance.componentId).toBe(FIXTURE_IDS.component);
    const tree = resolveInstanceTree(page, result.instanceId);
    expect(tree?.children.map((child) => child.realId)).toEqual([
      FIXTURE_IDS.componentRect,
      FIXTURE_IDS.componentText,
    ]);
    expect(stack.history().undo[0]).toBe('创建实例');
  });

  it('target 不是主组件 → not-a-component（不落命令）', () => {
    const stack = fixtureStack();
    expect(createInstanceOfComponent(stack, 'p1', FIXTURE_IDS.rectTop)).toEqual({
      ok: false,
      reason: 'not-a-component',
    });
    expect(stack.canUndo).toBe(false);
  });
});

describe('resetOverrides（重置覆盖）', () => {
  it('重置后值回主组件（覆盖表清空）', () => {
    const stack = fixtureStack();
    const page = pageOf(stack);
    const mainFill = fillOf(page, FIXTURE_IDS.componentRect);
    expect(resolvedFill(page, FIXTURE_IDS.instance, 'cmp1_bg')).toBe(FIXTURE_OVERRIDE_FILL);
    expect(mainFill).not.toBe(FIXTURE_OVERRIDE_FILL);

    const result = resetOverrides(stack, 'p1', FIXTURE_IDS.instance);
    expect(result).toEqual({ ok: true, cleared: 1 });
    const after = pageOf(stack);
    expect(resolvedFill(after, FIXTURE_IDS.instance, 'cmp1_bg')).toBe(mainFill);
    const instance = after.nodes[FIXTURE_IDS.instance];
    expect(instance !== undefined && isInstanceNode(instance) && instance.overrides).toEqual({});
    expect(stack.history().undo[0]).toBe('重置覆盖');
  });

  it('指定路径：只清该路径的覆盖', () => {
    const stack = fixtureStack();
    const result = resetOverrides(stack, 'p1', FIXTURE_IDS.instance, [[FIXTURE_IDS.componentRect]]);
    expect(result).toEqual({ ok: true, cleared: 1 });
    expect(resolvedFill(pageOf(stack), FIXTURE_IDS.instance, 'cmp1_bg')).toBe(
      fillOf(pageOf(stack), FIXTURE_IDS.componentRect),
    );
  });

  it('无覆盖时幂等：不落命令', () => {
    const stack = fixtureStack();
    resetOverrides(stack, 'p1', FIXTURE_IDS.instance);
    stack.clearHistory();
    expect(resetOverrides(stack, 'p1', FIXTURE_IDS.instance)).toEqual({ ok: true, cleared: 0 });
    expect(stack.canUndo).toBe(false);
  });

  it('非实例 → not-an-instance', () => {
    const stack = fixtureStack();
    expect(resetOverrides(stack, 'p1', FIXTURE_IDS.rectTop)).toEqual({
      ok: false,
      reason: 'not-an-instance',
    });
  });
});

describe('switchInstanceVariant（变体切换）', () => {
  it('实例改指新变体，内容随新主件', () => {
    const stack = fixtureStack();
    const result = switchInstanceVariant(stack, 'p1', FIXTURE_IDS.variantInstance, {
      size: 'large',
    });
    expect(result).toEqual({ ok: true, componentId: FIXTURE_IDS.variantLarge });
    const page = pageOf(stack);
    const instance = page.nodes[FIXTURE_IDS.variantInstance];
    expect(instance !== undefined && isInstanceNode(instance) && instance.componentId).toBe(
      FIXTURE_IDS.variantLarge,
    );
    const tree = resolveInstanceTree(page, FIXTURE_IDS.variantInstance);
    expect(tree?.children.map((child) => child.realId)).toEqual([FIXTURE_IDS.variantLargeRect]);
    expect(stack.history().undo[0]).toBe('切换变体');
  });

  it('部分匹配（只给一个维度）也能落到变体', () => {
    const stack = fixtureStack();
    expect(
      switchInstanceVariant(stack, 'p1', FIXTURE_IDS.variantInstance, { size: 'small' }),
    ).toEqual({ ok: true, componentId: FIXTURE_IDS.variantSmall });
  });

  it('组件集内无匹配变体 → no-variant（不落命令）', () => {
    const stack = fixtureStack();
    expect(
      switchInstanceVariant(stack, 'p1', FIXTURE_IDS.variantInstance, { size: 'huge' }),
    ).toEqual({ ok: false, reason: 'no-variant' });
    expect(stack.canUndo).toBe(false);
  });

  it('实例的主组件不在组件集内 → no-variant-set', () => {
    const stack = fixtureStack();
    expect(switchInstanceVariant(stack, 'p1', FIXTURE_IDS.instance, { size: 'large' })).toEqual({
      ok: false,
      reason: 'no-variant-set',
    });
  });

  it('非实例节点 → not-an-instance', () => {
    const stack = fixtureStack();
    expect(switchInstanceVariant(stack, 'p1', FIXTURE_IDS.rectTop, { size: 'small' })).toEqual({
      ok: false,
      reason: 'not-an-instance',
    });
  });
});
