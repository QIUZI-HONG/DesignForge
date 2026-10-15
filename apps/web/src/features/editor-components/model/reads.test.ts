/**
 * C17 选中态读取（`model/reads`）规格。
 *
 * 断言的是**外部行为**：给定页面与选择集，面板读到的「这是什么、能不能创建组件」，
 * 与引擎文档真值一致（组件/实例/组件集的判定一律走引擎谓词，不在这里另立口径）。
 */

import { createInstance, createPage, type ScenePage } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { FIXTURE_IDS, fixturePage, selectionOf } from '../testing/fixtures';
import { canCreateComponent, readSelectionComponent } from './reads';

describe('readSelectionComponent（C17 选中态）', () => {
  const page: ScenePage = fixturePage();

  it('空选：kind=none，无主组件', () => {
    const read = readSelectionComponent(page, selectionOf([]));
    expect(read.kind).toBe('none');
    expect(read.count).toBe(0);
    expect(read.mainComponent).toBeNull();
  });

  it('普通节点：kind=plain', () => {
    const read = readSelectionComponent(page, selectionOf([FIXTURE_IDS.rectInFrame]));
    expect(read.kind).toBe('plain');
    expect(read.node?.id).toBe(FIXTURE_IDS.rectInFrame);
    expect(read.mainComponent).toBeNull();
  });

  it('同类型多选：kind=plain（仍可创建组件）', () => {
    const read = readSelectionComponent(
      page,
      selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]),
    );
    expect(read.kind).toBe('plain');
    expect(read.count).toBe(2);
  });

  it('主组件：给出实例计数与变体属性', () => {
    const read = readSelectionComponent(page, selectionOf([FIXTURE_IDS.component]));
    expect(read.kind).toBe('component');
    expect(read.mainComponent?.id).toBe(FIXTURE_IDS.component);
    expect(read.mainComponentName).toBe('按钮主件');
    expect(read.instanceCount).toBe(1);
    expect(read.variantProperties).toBeNull();
  });

  it('实例：给出主组件与覆盖条数，未分离', () => {
    const read = readSelectionComponent(page, selectionOf([FIXTURE_IDS.instance]));
    expect(read.kind).toBe('instance');
    expect(read.mainComponentName).toBe('按钮主件');
    expect(read.detached).toBe(false);
    expect(read.overrideCount).toBe(1);
  });

  it('实例：主组件缺失时标记分离（detached）', () => {
    const orphan = createInstance({
      id: 'orphan',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      componentId: 'missing_main',
    });
    const orphanPage = createPage({
      id: 'p_orphan',
      nodes: { orphan },
      rootIds: ['orphan'],
    });
    const read = readSelectionComponent(orphanPage, selectionOf(['orphan']));
    expect(read.kind).toBe('instance');
    expect(read.detached).toBe(true);
    expect(read.mainComponent).toBeNull();
  });

  it('组件集：kind=component_set，给出变体数', () => {
    const read = readSelectionComponent(page, selectionOf([FIXTURE_IDS.set]));
    expect(read.kind).toBe('component_set');
    expect(read.variantCount).toBe(2);
  });

  it('混选（普通 + 组件）：kind=mixed', () => {
    const read = readSelectionComponent(
      page,
      selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.component]),
    );
    expect(read.kind).toBe('mixed');
    expect(read.count).toBe(2);
  });

  it('变体实例：带出所属组件集与变体属性', () => {
    const read = readSelectionComponent(page, selectionOf([FIXTURE_IDS.variantInstance]));
    expect(read.kind).toBe('instance');
    expect(read.componentSetId).toBe(FIXTURE_IDS.set);
    expect(read.variantProperties).toEqual({ size: 'small' });
  });
});

describe('canCreateComponent（创建组件前置）', () => {
  const page: ScenePage = fixturePage();

  it('空选 → empty', () => {
    expect(canCreateComponent(page, selectionOf([]))).toEqual({ ok: false, reason: 'empty' });
  });

  it('同父级多选 → 可创建', () => {
    expect(
      canCreateComponent(page, selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2])),
    ).toEqual({ ok: true });
  });

  it('跨父级 → multiple-parents（与引擎同口径：创建组件要求同一父级）', () => {
    expect(
      canCreateComponent(page, selectionOf([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectTop])),
    ).toEqual({ ok: false, reason: 'multiple-parents' });
  });

  it('含组件/实例/组件集 → contains-component', () => {
    expect(canCreateComponent(page, selectionOf([FIXTURE_IDS.component]))).toEqual({
      ok: false,
      reason: 'contains-component',
    });
    expect(canCreateComponent(page, selectionOf([FIXTURE_IDS.instance]))).toEqual({
      ok: false,
      reason: 'contains-component',
    });
    expect(canCreateComponent(page, selectionOf([FIXTURE_IDS.set]))).toEqual({
      ok: false,
      reason: 'contains-component',
    });
  });

  it('实例内容（虚节点）→ instance-content', () => {
    const virtualId = `${FIXTURE_IDS.instance}::${FIXTURE_IDS.componentRect}`;
    expect(canCreateComponent(page, selectionOf([virtualId]))).toEqual({
      ok: false,
      reason: 'instance-content',
    });
  });
});
