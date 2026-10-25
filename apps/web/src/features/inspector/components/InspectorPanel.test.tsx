// @vitest-environment jsdom
/**
 * InspectorPanel（RW-10 重写）规格。
 *
 * 组织（交付 a）：右栏双页签（设计 / 导出）+ 设计页折叠分区
 * （尺寸/填充/描边/圆角/效果/文字——默认展开，跨选中切换记忆开合）；
 * 页签 roving tabindex（Tab 序稳定）。
 *
 * 刷新（交付 a）：选中集合经 **zustand store**（`selectionStore`）订阅即时刷新，
 * 不依赖宿主重渲——store 变化 → 面板立即反映新选中。
 *
 * scrubbing（交付 b）：数值拖拽走引擎 interaction 会话语义——拖拽中零历史，
 * 松手单事务提交（撤销一步回退），全数值字段（尺寸/位置/圆角/间距/效果参数）接入。
 *
 * 效果（交付 c）：列表可见（读 effects 数据）+ 可调（增删改经 node.update 命令，
 * 一次事务一条历史）；混选诚实呈现。
 *
 * P0 口径（交付 d）：圆角仅一个字段（四角统一），UI 不撒谎。
 */

import {
  type CommandStack,
  createSelection,
  dropShadow,
  type Effect,
  type SceneNode,
  type Selection,
} from '@dforge/engine';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { COMMIT_DELAY_MS } from '../model/draft';
import { defaultEffect } from '../model/patches';
import { FIXTURE_PAGE_ID, fixtureStack, selectionOf } from '../testing/fixtures';
import { InspectorPanel } from './InspectorPanel';

/** 渲染并返回断言句柄（props 路径：selection 由宿主传入）。 */
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

/** zustand 选择态路径：selectionStore 持有选中集，宿主不传 selection。 */
function setupWithStore(initial: Selection) {
  const stack: CommandStack = fixtureStack({ freeze: true });
  const ui = createStore<{ selection: Selection }>(() => ({ selection: initial }));
  render(<InspectorPanel stack={stack} pageId={FIXTURE_PAGE_ID} selectionStore={ui} />);
  const node = (id: string): SceneNode => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失');
    const found = current.nodes[id];
    if (found === undefined) throw new Error(`节点缺失：${id}`);
    return found;
  };
  return { stack, ui, node };
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

/** 给节点预置效果（直接经命令栈，测试效果分区的读侧）。 */
function presetEffect(stack: CommandStack, nodeId: string, effect: Effect): void {
  stack.dispatch(
    {
      type: 'node.update',
      pageId: FIXTURE_PAGE_ID,
      nodeId,
      patch: { effects: [effect] },
    },
    { label: '预置' },
  );
}

describe('InspectorPanel · 组织（Tabs + 折叠分区）', () => {
  afterEach(cleanup);

  it('双页签：设计默认选中，导出面板 DOM 保留但隐藏', () => {
    setup(['r1']);
    expect(screen.getByRole('tablist', { name: '属性面板页签' })).not.toBeNull();
    const designTab = screen.getByRole('tab', { name: '设计' });
    expect(designTab.getAttribute('aria-selected')).toBe('true');
    // roving tabindex：选中页签进 Tab 序，未选中的不进（Tab 序稳定）
    expect(designTab.getAttribute('tabindex')).toBe('0');
    const exportTab = screen.getByRole('tab', { name: '导出' });
    expect(exportTab.getAttribute('tabindex')).toBe('-1');

    const exportPanel = document.getElementById(exportTab.getAttribute('aria-controls') as string);
    expect(exportPanel?.getAttribute('hidden')).not.toBeNull();
    // 导出桩仍在 DOM（页签内容不卸载）：禁用态 + 原因（F15 口径）
    const exportRow = field('export');
    expect(exportRow.getAttribute('data-df-state')).toBe('disabled');
  });

  it('点击导出页签：导出面板可见，设计面板隐藏', async () => {
    const user = userEvent.setup();
    setup(['r1']);
    await user.click(screen.getByRole('tab', { name: '导出' }));
    const exportTab = screen.getByRole('tab', { name: '导出' });
    const designTab = screen.getByRole('tab', { name: '设计' });
    const exportPanel = document.getElementById(exportTab.getAttribute('aria-controls') as string);
    const designPanel = document.getElementById(designTab.getAttribute('aria-controls') as string);
    expect(exportPanel?.getAttribute('hidden')).toBeNull();
    expect(designPanel?.getAttribute('hidden')).not.toBeNull();
  });

  it('设计页折叠分区齐备且默认展开（尺寸/填充/描边/圆角/效果；含文本时加文字）', () => {
    setup(['t1']);
    const sectionIds = ['size', 'fill', 'stroke', 'corner', 'effects', 'text'];
    for (const id of sectionIds) {
      const section = document.querySelector(`[data-df-inspector-section="${id}"]`);
      expect(section, `分区缺失：${id}`).not.toBeNull();
      const trigger = section?.querySelector('button');
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    }
    // DOM 顺序即 Tab 序：size → fill → stroke → corner → effects → text
    const rendered = [...document.querySelectorAll('[data-df-inspector-section]')].map(
      (element) => element.getAttribute('data-df-inspector-section'),
    );
    expect(rendered).toEqual(sectionIds);
  });

  it('单选矩形：不渲染文字分区', () => {
    setup(['r1']);
    expect(document.querySelector('[data-df-inspector-section="text"]')).toBeNull();
    expect(document.querySelector('[data-df-inspector-section="size"]')).not.toBeNull();
  });

  it('折叠开合跨选中切换记忆（进入分区记忆）', async () => {
    const user = userEvent.setup();
    const { ui } = setupWithStore(selectionOf(['r1']));

    const fillTrigger = document.querySelector<HTMLElement>(
      '[data-df-inspector-section="fill"] button',
    );
    if (fillTrigger === null) throw new Error('填充分区触发器缺失');
    await user.click(fillTrigger);
    expect(fillTrigger.getAttribute('aria-expanded')).toBe('false');

    // 换选中（zustand store 路径）：填充分区保持收起
    act(() => {
      ui.setState({ selection: selectionOf(['r2']) });
    });
    const triggerAfter = document.querySelector<HTMLElement>(
      '[data-df-inspector-section="fill"] button',
    );
    expect(triggerAfter?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('InspectorPanel · 选中集合即时刷新（zustand 选择态订阅）', () => {
  afterEach(cleanup);

  it('store 选中变化 → 面板立即反映新选中（不依赖宿主重渲）', () => {
    const { ui, node } = setupWithStore(selectionOf(['r1']));
    expect(inputOf('x').value).toBe('10');

    act(() => {
      ui.setState({ selection: selectionOf(['r2']) });
    });
    expect(inputOf('x').value).toBe('200');
    expect(field('x').getAttribute('data-df-state')).toBe('default');

    // 混选同样即时：x 值不同 → 「—」
    act(() => {
      ui.setState({ selection: createSelection(['r1', 'r2']) });
    });
    expect(inputOf('x').value).toBe('—');
    expect(field('x').getAttribute('data-df-state')).toBe('mixed');

    // 空选 → 画布设置（C7 路由）
    act(() => {
      ui.setState({ selection: createSelection([]) });
    });
    expect(document.querySelector('[data-df-inspector="canvas-settings"]')).not.toBeNull();
    expect(node('r1').x).toBe(10);
  });

  it('混选批量修改经 store 选中集作用于全选（一次撤销全还原）', () => {
    vi.useFakeTimers();
    try {
      const { stack, ui } = setupWithStore(createSelection(['r1', 'r2']));
      typeAndEnter('x', '25');
      act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
      expect(stack.document.pages[0]?.nodes.r1?.x).toBe(25);
      expect(stack.document.pages[0]?.nodes.r2?.x).toBe(25);
      expect(stack.history().undo).toHaveLength(1);
      expect(stack.undo()).toBe(true);
      expect(stack.document.pages[0]?.nodes.r1?.x).toBe(10);
      expect(stack.document.pages[0]?.nodes.r2?.x).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('InspectorPanel · scrubbing 会话（交付 b：拖拽零写入，松手单事务）', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('拖拽改 X：拖拽中零历史，松手一条事务，撤销一步回退', () => {
    vi.useFakeTimers();
    const { stack } = setup(['r1']);
    const handle = document.querySelector<HTMLElement>('[data-testid="numberfield-scrub-x"]');
    if (handle === null) throw new Error('scrub 把手缺失');

    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 15, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 30, pointerId: 1 });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(stack.history().undo).toHaveLength(0); // 拖拽中不写文档

    fireEvent.pointerUp(handle, { clientX: 30, pointerId: 1 });
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(40);
    expect(stack.history().undo).toHaveLength(1); // 松手单事务

    expect(stack.undo()).toBe(true);
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(10); // 撤销一步回退
  });

  it('圆角 scrub 同语义；圆角只有一个字段（P0 四角统一，UI 不撒谎）', () => {
    vi.useFakeTimers();
    const { stack } = setup(['r1']);
    expect(document.querySelectorAll('[data-df-inspector-field="cornerRadius"]')).toHaveLength(1);

    const handle = document.querySelector<HTMLElement>(
      '[data-testid="numberfield-scrub-cornerRadius"]',
    );
    if (handle === null) throw new Error('圆角 scrub 把手缺失');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 8, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 8, pointerId: 1 });
    expect(stack.document.pages[0]?.nodes.r1?.cornerRadius).toBe(8);
    expect(stack.history().undo).toHaveLength(1);
  });

  it('自动布局间距 scrub 走同一会话语义（单事务）', () => {
    vi.useFakeTimers();
    const { stack } = setup(['f1']);
    const toggle = field('autoLayoutEnabled').querySelector('button');
    if (toggle === null) throw new Error('开关缺失');
    fireEvent.click(toggle); // 开启自动布局（1 条历史）

    const spacingHandle = document.querySelector<HTMLElement>(
      '[data-testid="numberfield-scrub-autoLayoutSpacing"]',
    );
    if (spacingHandle === null) throw new Error('间距 scrub 把手缺失');
    fireEvent.pointerDown(spacingHandle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(spacingHandle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(spacingHandle, { clientX: 20, pointerId: 1 });

    expect(stack.history().undo).toHaveLength(2); // 开关 1 条 + 拖拽 1 条
    const frame = stack.document.pages[0]?.nodes.f1;
    expect(frame?.type === 'frame' && frame.autoLayout?.spacing).toBe(30);
  });
});

describe('InspectorPanel · 效果分区（交付 c：可见可调，联动画布）', () => {
  afterEach(cleanup);

  it('效果列表可见：预置投影后显示行与参数（颜色/X 偏移/Y 偏移/模糊/扩展）', () => {
    const { stack } = setup(['r1']);
    presetEffect(stack, 'r1', dropShadow('#000000', 2, 4, 10, 1));

    const row = document.querySelector('[data-df-effect="drop_shadow"]');
    expect(row).not.toBeNull();
    const paramNames = [
      'effect-0-offsetX',
      'effect-0-offsetY',
      'effect-0-blur',
      'effect-0-spread',
      'effect-0-color',
    ];
    for (const name of paramNames) {
      expect(document.querySelector(`[data-df-inspector-field="${name}"]`), name).not.toBeNull();
    }
  });

  it('层模糊只显示模糊参数（X/扩展/颜色对层模糊不适用——UI 不撒谎）', () => {
    const { stack } = setup(['r1']);
    presetEffect(stack, 'r1', defaultEffect('layer_blur'));

    const row = document.querySelector('[data-df-effect="layer_blur"]');
    expect(row).not.toBeNull();
    expect(document.querySelector('[data-df-inspector-field="effect-0-blur"]')).not.toBeNull();
    expect(document.querySelector('[data-df-inspector-field="effect-0-offsetX"]')).toBeNull();
    expect(document.querySelector('[data-df-inspector-field="effect-0-spread"]')).toBeNull();
    expect(document.querySelector('[data-df-inspector-field="effect-0-color"]')).toBeNull();
  });

  it('添加效果：node.update 落一条历史，画布文档可见', () => {
    const { stack, node } = setup(['r1']);
    const add = document.querySelector<HTMLElement>('[data-df-effect-add]');
    if (add === null) throw new Error('添加效果入口缺失');

    fireEvent.click(add);
    expect(node('r1').effects).toHaveLength(1);
    expect(node('r1').effects[0]).toMatchObject({ type: 'drop_shadow', visible: true });
    expect(stack.history().undo).toHaveLength(1);
    expect(stack.history().undo[0]).toBe('效果');
  });

  it('添加效果可选类型：选「层模糊」再添加，落的是层模糊', async () => {
    const user = userEvent.setup();
    const { node } = setup(['r1']);
    await user.selectOptions(
      document.querySelector<HTMLSelectElement>('[data-df-effect-type]')!,
      'layer_blur',
    );
    fireEvent.click(document.querySelector<HTMLElement>('[data-df-effect-add]')!);
    expect(node('r1').effects[0]).toMatchObject({ type: 'layer_blur' });
  });

  it('移除效果：按序号删除，一条历史', () => {
    const { stack, node } = setup(['r1']);
    presetEffect(stack, 'r1', dropShadow('#000000', 0, 4, 10));
    expect(node('r1').effects).toHaveLength(1);

    const remove = document.querySelector<HTMLElement>('[data-df-effect-remove="0"]');
    if (remove === null) throw new Error('移除按钮缺失');
    fireEvent.click(remove);
    expect(node('r1').effects).toHaveLength(0);
    expect(stack.history().undo).toHaveLength(2); // 预置 1 + 移除 1
  });

  it('改效果参数：node.update 单命令，一次事务一条历史（撤销还原）', () => {
    const { stack, node } = setup(['r1']);
    presetEffect(stack, 'r1', dropShadow('#000000', 0, 4, 10));

    typeAndEnter('effect-0-blur', '24');
    expect(node('r1').effects[0]).toMatchObject({ blur: 24, offsetY: 4 }); // 未涉及参数保留
    expect(stack.history().undo).toHaveLength(2);

    expect(stack.undo()).toBe(true);
    expect(node('r1').effects[0]).toMatchObject({ blur: 10 });
  });

  it('效果参数 scrub：拖拽中零写入，松手单事务', () => {
    vi.useFakeTimers();
    const { stack, node } = setup(['r1']);
    presetEffect(stack, 'r1', dropShadow('#000000', 0, 4, 10));

    const handle = document.querySelector<HTMLElement>(
      '[data-testid="numberfield-scrub-effect-0-blur"]',
    );
    if (handle === null) throw new Error('效果参数 scrub 把手缺失');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 6, pointerId: 1 });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(stack.history().undo).toHaveLength(1); // 仅预置那一条

    fireEvent.pointerUp(handle, { clientX: 6, pointerId: 1 });
    expect(node('r1').effects[0]).toMatchObject({ blur: 16 });
    expect(stack.history().undo).toHaveLength(2);
  });

  it('效果可见性开关：node.update 单命令（visible 翻转）', () => {
    const { stack, node } = setup(['r1']);
    presetEffect(stack, 'r1', dropShadow('#000000', 0, 4, 10));

    const toggle = field('effectVisible-0').querySelector('button');
    if (toggle === null) throw new Error('可见性开关缺失');
    fireEvent.click(toggle);
    expect(node('r1').effects[0]).toMatchObject({ visible: false });
    expect(stack.history().undo).toHaveLength(2);
  });

  it('混选效果：显示占位（不撒谎），添加入口仍可用（各节点追加）', () => {
    const { stack, node } = setup(['r1', 'r2']);
    presetEffect(stack, 'r1', dropShadow('#000000', 0, 4, 10));

    expect(document.querySelector('[data-df-effect-mixed]')).not.toBeNull();
    expect(document.querySelector('[data-df-effect="drop_shadow"]')).toBeNull(); // 无共有列表可渲染

    fireEvent.click(document.querySelector<HTMLElement>('[data-df-effect-add]')!);
    expect(node('r1').effects).toHaveLength(2);
    expect(node('r2').effects).toHaveLength(1);
    expect(node('r2').effects[0]).toMatchObject({ type: 'drop_shadow' });
  });
});

describe('InspectorPanel · P0 圆角与既有路径不回归', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('圆角分区给出「四角统一」说明（P0 不做四角独立）', () => {
    setup(['r1']);
    const corner = document.querySelector('[data-df-inspector-section="corner"]');
    expect(corner?.textContent ?? '').toContain('四角统一');
  });

  it('键入路径不回归：300ms 提交一条 + Esc 零历史', () => {
    const { stack } = setup(['r1']);
    fireEvent.change(inputOf('x'), { target: { value: '123' } });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS - 1));
    expect(stack.history().undo).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(123);
    expect(stack.history().undo).toHaveLength(1);

    fireEvent.change(inputOf('x'), { target: { value: '999' } });
    fireEvent.keyDown(inputOf('x'), { key: 'Escape' });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(stack.history().undo).toHaveLength(1);
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(123);
  });

  it('文字分区键入与对齐写回引擎', () => {
    const { node } = setup(['t1']);
    typeAndEnter('fontSize', '20');
    const text = node('t1');
    expect(text.type === 'text' && text.text.fontSize).toBe(20);

    fireEvent.click(screen.getByRole('radio', { name: '右对齐' }));
    const after = node('t1');
    expect(after.type === 'text' && after.text.align).toBe('right');
  });

  it('混合模式与不透明度行仍在外观顶排（字段挂点不变）', () => {
    const { node } = setup(['r1']);
    expect(field('blendMode').querySelector('select')).not.toBeNull();
    expect(field('opacity')).not.toBeNull();
    fireEvent.change(field('blendMode').querySelector('select')!, {
      target: { value: 'multiply' },
    });
    expect(node('r1').blendMode).toBe('multiply');
  });
});
