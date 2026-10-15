// @vitest-environment jsdom
/**
 * AlignRow（C6 对齐工具行）规格：走引擎选择模型的对齐/分布命令。
 *
 * 基准口径（Figma 同构）：多选 → 以选择集并集为基准；单选 → 以父容器为基准
 * （顶层节点无父级基准 → 禁用）；分布要求 ≥3 个节点（首尾不动）。
 */

import type { CommandStack } from '@dforge/engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FIXTURE_PAGE_ID, fixtureStack, selectionOf } from '../testing/fixtures';
import { AlignRow } from './AlignRow';

/** 渲染并返回断言句柄。 */
function setup(ids: readonly string[], activeId?: string) {
  const stack: CommandStack = fixtureStack({ freeze: true });
  render(
    <AlignRow stack={stack} pageId={FIXTURE_PAGE_ID} selection={selectionOf(ids, activeId)} />,
  );
  const page = () => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失');
    return current;
  };
  const node = (id: string) => {
    const found = page().nodes[id];
    if (found === undefined) throw new Error(`节点缺失：${id}`);
    return found;
  };
  return { stack, page, node };
}

/** 取对齐按钮。 */
function button(op: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-df-align="${op}"]`);
  if (found === null) throw new Error(`对齐按钮缺失：${op}`);
  return found;
}

describe('AlignRow', () => {
  afterEach(cleanup);

  it('多选左对齐：以选择集并集为基准，撤销一次还原', () => {
    const { stack, node } = setup(['r1', 'r2']);
    expect(button('left').disabled).toBe(false);

    fireEvent.click(button('left'));
    expect(node('r2').x).toBe(10);
    expect(node('r1').x).toBe(10);

    expect(stack.undo()).toBe(true);
    expect(node('r2').x).toBe(200);
  });

  it('单选子项：以父容器为基准水平居中', () => {
    const { node } = setup(['c1']);
    expect(button('hcenter').disabled).toBe(false);

    fireEvent.click(button('hcenter'));
    // 父画板宽 300，子项宽 40 → 居中 x = (300 - 40) / 2 = 130
    expect(node('c1').x).toBe(130);
  });

  it('单选顶层节点：无父级基准 → 对齐按钮禁用', () => {
    setup(['r1']);
    for (const op of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']) {
      expect(button(op).disabled, op).toBe(true);
    }
  });

  it('三个节点：水平与垂直分布都可用（Figma 同构，与轴向无关）', () => {
    const { node } = setup(['r1', 'r2', 'r3']);
    expect(button('distribute-h').disabled).toBe(false);
    expect(button('distribute-v').disabled).toBe(false);

    fireEvent.click(button('distribute-h'));
    expect(node('r1').x).toBe(10);
    expect(node('r2').x).toBe(205);
    expect(node('r3').x).toBe(400);
  });

  it('少于 3 个节点时分布禁用（对齐仍可用）', () => {
    setup(['r1', 'r2']);
    expect(button('distribute-h').disabled).toBe(true);
    expect(button('left').disabled).toBe(false);
  });

  it('多选整体水平居中：各节点中心对齐并集中心', () => {
    const { node } = setup(['r1', 'r2']);
    fireEvent.click(button('hcenter'));
    // 并集 10..300 中心 155；r1 中心 60 → 位移 95 → x=105；r2 中心 250 → 位移 -95 → x=105
    expect(node('r1').x).toBe(105);
    expect(node('r2').x).toBe(105);
  });

  it('按钮具可访问名（aria-label 走 i18n 文案）', () => {
    setup(['r1', 'r2']);
    expect(screen.getByRole('button', { name: '左对齐' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '水平分布' })).toBeTruthy();
  });
});
