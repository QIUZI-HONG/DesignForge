// @vitest-environment jsdom
/**
 * InspectorPanel（C5 四分区 + C6 混选/批量修改）规格。
 *
 * 断言全部经由**引擎文档**（唯一真值）与可观测 DOM：
 * 分区结构、混选「—」、300ms 后落一条命令、批量作用于全选、Esc 回滚、
 * 文字/高级分区分派到引擎字段。
 */

import type { CommandStack, SceneNode } from '@dforge/engine';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMIT_DELAY_MS } from '../model/draft';
import { FIXTURE_PAGE_ID, fixtureStack, selectionOf } from '../testing/fixtures';
import { InspectorPanel } from './InspectorPanel';

/** 渲染并返回断言句柄。 */
function setup(ids: readonly string[], activeId?: string) {
  const stack: CommandStack = fixtureStack({ freeze: true });
  const view = render(
    <InspectorPanel
      stack={stack}
      pageId={FIXTURE_PAGE_ID}
      selection={selectionOf(ids, activeId)}
    />,
  );
  const page = () => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失');
    return current;
  };
  const node = (id: string): SceneNode => {
    const found = page().nodes[id];
    if (found === undefined) throw new Error(`节点缺失：${id}`);
    return found;
  };
  return { stack, page, node, view };
}

/** 取字段控件容器。 */
function field(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-df-inspector-field="${name}"]`);
  if (found === null) throw new Error(`字段缺失：${name}`);
  return found;
}

/** 取字段输入框。 */
function inputOf(name: string): HTMLInputElement {
  const found = field(name).querySelector('input');
  if (found === null) throw new Error(`字段输入框缺失：${name}`);
  return found;
}

/** 在某字段输入文本并回车提交。 */
function typeAndEnter(name: string, text: string): void {
  fireEvent.change(inputOf(name), { target: { value: text } });
  fireEvent.keyDown(inputOf(name), { key: 'Enter' });
}

describe('InspectorPanel · 四分区（C5）', () => {
  afterEach(cleanup);

  it('单选文本：四个分区齐备（布局/外观/文字/高级）', () => {
    setup(['t1']);
    for (const id of ['layout', 'appearance', 'text', 'advanced']) {
      expect(
        document.querySelector(`[data-df-inspector-section="${id}"]`),
        `分区缺失：${id}`,
      ).not.toBeNull();
    }
  });

  it('单选矩形：不渲染文字分区（无适用节点）', () => {
    setup(['r1']);
    expect(document.querySelector('[data-df-inspector-section="text"]')).toBeNull();
    expect(document.querySelector('[data-df-inspector-section="layout"]')).not.toBeNull();
  });

  it('布局分区含几何四件套与旋转；画板额外有自动布局行', () => {
    setup(['r1']);
    for (const name of ['x', 'y', 'width', 'height', 'rotation']) {
      expect(document.querySelector(`[data-df-inspector-field="${name}"]`), name).not.toBeNull();
    }
    expect(document.querySelector('[data-df-inspector-field="autoLayoutEnabled"]')).toBeNull();

    cleanup();
    setup(['f1']);
    expect(document.querySelector('[data-df-inspector-field="autoLayoutEnabled"]')).not.toBeNull();
  });

  it('高级分区：混合模式可选；导出行是禁用桩并给出原因（F15 口径）', () => {
    setup(['r1']);
    const advanced = document.querySelector('[data-df-inspector-section="advanced"]');
    expect(advanced).not.toBeNull();
    const blend = field('blendMode');
    expect(blend.querySelector('select')).not.toBeNull();

    const exportRow = field('export');
    const exportButton = exportRow.querySelector('button');
    expect(exportButton?.disabled).toBe(true);
    expect(exportRow.getAttribute('data-df-state')).toBe('disabled');
    expect(exportRow.textContent ?? '').toContain('导出');
  });
});

describe('InspectorPanel · 混选与批量修改（C6）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('混合值显示「—」，一致值显示实值', () => {
    setup(['r1', 'r2']);
    expect(inputOf('x').value).toBe('—');
    expect(field('x').getAttribute('data-df-state')).toBe('mixed');
    expect(inputOf('width').value).toBe('100');
  });

  it('批量修改作用于全选：一次事务落一个历史条目，撤销一次全部还原', () => {
    const { stack, node } = setup(['r1', 'r2']);
    typeAndEnter('x', '25');
    expect(node('r1').x).toBe(25);
    expect(node('r2').x).toBe(25);

    expect(stack.history().undo.length).toBe(1);
    expect(stack.undo()).toBe(true);
    expect(node('r1').x).toBe(10);
    expect(node('r2').x).toBe(200);
  });

  it('多选改填充色：全选生效且各节点保留自身填充不透明度', () => {
    const { node } = setup(['r1', 'r2']);
    typeAndEnter('fillColor', '#00FF00');
    expect(node('r1').fills[0]).toMatchObject({ color: '#00FF00', opacity: 0.5 });
    expect(node('r2').fills[0]).toMatchObject({ color: '#00FF00', opacity: 1 });
  });

  it('Esc 回滚草稿：引擎不变、无历史条目、显示回到外部值', () => {
    const { stack, node } = setup(['r1']);
    fireEvent.change(inputOf('x'), { target: { value: '99' } });
    fireEvent.keyDown(inputOf('x'), { key: 'Escape' });

    expect(node('r1').x).toBe(10);
    expect(inputOf('x').value).toBe('10');
    expect(stack.history().undo.length).toBe(0);
  });

  it('输入后 300ms 才落命令（撤销粒度 = 一次修改）', () => {
    const { stack, node } = setup(['r1']);
    fireEvent.change(inputOf('x'), { target: { value: '1' } });
    fireEvent.change(inputOf('x'), { target: { value: '12' } });
    fireEvent.change(inputOf('x'), { target: { value: '123' } });
    expect(stack.history().undo.length).toBe(0);

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(node('r1').x).toBe(123);
    expect(stack.history().undo.length).toBe(1);
    expect(stack.history().undo[0]).toBe('位置');
  });
});

describe('InspectorPanel · 文字与高级字段', () => {
  afterEach(cleanup);

  it('改字号/对齐写回引擎文本内容', () => {
    const { node } = setup(['t1']);
    typeAndEnter('fontSize', '20');
    const text = node('t1');
    expect(text.type === 'text' && text.text.fontSize).toBe(20);

    fireEvent.click(screen.getByRole('radio', { name: '右对齐' }));
    const after = node('t1');
    expect(after.type === 'text' && after.text.align).toBe('right');
  });

  it('混合模式选择写回引擎', () => {
    const { node } = setup(['r1']);
    const select = field('blendMode').querySelector('select');
    if (select === null) throw new Error('混合模式下拉缺失');
    fireEvent.change(select, { target: { value: 'multiply' } });
    expect(node('r1').blendMode).toBe('multiply');
  });

  it('自动布局开关：开启后子项按引擎求解落位，关闭后配置清空', () => {
    const { node, stack } = setup(['f1']);
    const toggle = field('autoLayoutEnabled').querySelector('button');
    if (toggle === null) throw new Error('开关缺失');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    const frame = node('f1');
    expect(frame.type === 'frame' && frame.autoLayout).not.toBeNull();
    expect(node('c1').y).toBe(10);
    expect(stack.history().undo.length).toBe(1);

    fireEvent.click(field('autoLayoutEnabled').querySelector('button') as HTMLButtonElement);
    const off = node('f1');
    expect(off.type === 'frame' && off.autoLayout).toBeNull();
  });
});
