// @vitest-environment jsdom
/**
 * ComponentPanel（C17 组件创建 / 管理）规格。
 *
 * 断言可观测行为：面板提示（主 ↔ 实例）、按钮可用性与禁用原因（F15 灰化 + 原因提示）、
 * 创建组件对话框的提交、覆盖清单的重置、变体下拉的切换；真值一律落回引擎文档。
 */

import type { CommandStack, ScenePage } from '@dforge/engine';
import { createIdFactory, isInstanceNode } from '@dforge/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_IDS, fixtureStack, selectionOf } from '../testing/fixtures';
import { ComponentPanel } from './ComponentPanel';

/** 渲染面板并返回断言句柄。 */
function setup(ids: readonly string[], activeId?: string) {
  const stack: CommandStack = fixtureStack();
  const view = render(
    <ComponentPanel
      stack={stack}
      pageId="p1"
      selection={selectionOf(ids, activeId)}
      ids={createIdFactory(500)}
    />,
  );
  const page = (): ScenePage => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失页面');
    return current;
  };
  return { stack, page, view };
}

/** 取面板根。 */
function panel(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-df-component="panel"]');
  if (root === null) throw new Error('面板未渲染');
  return root;
}

/** 取带 data-df-component 标记的元素。 */
function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-df-component="${name}"]`);
}

/** 悬停禁用控件，等禁用原因提示（F15：灰化 + tooltip 原因）。 */
async function reasonOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button.parentElement ?? button);
  const tooltip = await screen.findByRole('tooltip');
  return tooltip.textContent ?? '';
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark';
});

afterEach(() => {
  cleanup();
});

describe('ComponentPanel · 空选与普通节点（创建组件入口）', () => {
  it('空选：显示未选内容空态，「创建组件」禁用且给出原因', async () => {
    setup([]);
    expect(screen.getByText('未选择内容')).toBeDefined();
    const create = screen.getByRole('button', { name: /创建组件/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(await reasonOf(create)).toBe('先选择至少一个图层');
  });

  it('同父级多选：对话框命名后创建主组件，命令进历史', () => {
    const { stack, page } = setup([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectInFrame2]);
    const create = screen.getByRole('button', { name: /创建组件/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);

    // 对话框（F1 模态族）：标题 + 名称输入 + 确认/取消
    const dialog = screen.getByRole('dialog');
    const nameInput = within(dialog).getByLabelText('组件名') as HTMLInputElement;
    expect(nameInput.value).toBe('组件'); // 默认名
    fireEvent.change(nameInput, { target: { value: '卡片' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    const created = Object.values(page().nodes).find(
      (node) => node.type === 'component' && node.name === '卡片',
    );
    expect(created).toBeDefined();
    expect(stack.history().undo[0]).toBe('创建组件');
    // 提交后对话框关闭
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('跨父级：创建入口禁用并给出「同一父级」原因', async () => {
    setup([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.rectTop]);
    const create = screen.getByRole('button', { name: /创建组件/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(await reasonOf(create)).toBe('所选图层需位于同一父级');
  });

  it('选中已含组件：创建入口禁用并给出「已含组件」原因', async () => {
    setup([FIXTURE_IDS.rectInFrame, FIXTURE_IDS.component]);
    const create = screen.getByRole('button', { name: /创建组件/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(await reasonOf(create)).toBe('所选内容已含组件或实例');
  });

  it('对话框取消：不落任何命令', () => {
    const { stack } = setup([FIXTURE_IDS.rectInFrame]);
    fireEvent.click(screen.getByRole('button', { name: /创建组件/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(stack.canUndo).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ComponentPanel · 主组件（主 ↔ 实例提示）', () => {
  it('显示主组件徽标与实例计数，并可创建实例（文档实例数 +1）', () => {
    const { stack, page } = setup([FIXTURE_IDS.component]);
    expect(part('badge')?.getAttribute('data-df-kind')).toBe('component');
    expect(part('badge')?.textContent).toBe('主组件');
    expect(panel().textContent).toContain('1 个实例');

    fireEvent.click(screen.getByRole('button', { name: /创建实例/ }));
    const instances = Object.values(page().nodes).filter((node) => node.type === 'instance');
    // 夹具原有 2 个实例（inst1 / inst2）；新建 1 个
    expect(instances).toHaveLength(3);
    expect(instances.some((node) => node.id === 'inst_500')).toBe(true);
    expect(stack.history().undo[0]).toBe('创建实例');
  });

  it('组件集：显示变体数（不提供创建实例入口）', () => {
    const { page } = setup([FIXTURE_IDS.set]);
    expect(part('badge')?.getAttribute('data-df-kind')).toBe('component-set');
    expect(page().nodes[FIXTURE_IDS.set]?.type).toBe('component_set');
    expect(panel().textContent).toContain('2 个变体');
    expect(part('create-instance')).toBeNull();
  });
});

describe('ComponentPanel · 实例（覆盖清单与重置）', () => {
  it('显示实例徽标与主组件名，覆盖清单列出被覆盖属性（覆盖值 + 主组件原值）', () => {
    setup([FIXTURE_IDS.instance]);
    expect(part('badge')?.getAttribute('data-df-kind')).toBe('instance');
    expect(part('badge')?.textContent).toBe('实例');
    expect(panel().textContent).toContain('主组件：按钮主件');

    const rows = document.querySelectorAll('[data-df-component="override-row"]');
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(row.getAttribute('data-df-override-path')).toBe('cmp1_bg');
    expect(row.textContent).toContain('按钮底');
    expect(row.textContent).toContain('填充');
    expect(row.textContent).toContain('#ff0000');
    expect(row.textContent).toContain('主组件值');
  });

  it('重置单行覆盖：覆盖清空、清单转空态，文档值回主', () => {
    const { stack, page } = setup([FIXTURE_IDS.instance]);
    fireEvent.click(screen.getByRole('button', { name: '重置「按钮底」的覆盖' }));
    const instance = page().nodes[FIXTURE_IDS.instance];
    expect(instance !== undefined && isInstanceNode(instance) && instance.overrides).toEqual({});
    expect(document.querySelectorAll('[data-df-component="override-row"]')).toHaveLength(0);
    expect(panel().textContent).toContain('无覆盖');
    expect(stack.history().undo[0]).toBe('重置覆盖');
  });

  it('「重置覆盖」总按钮：一次清空全部覆盖', () => {
    const { stack, page } = setup([FIXTURE_IDS.instance]);
    fireEvent.click(screen.getByRole('button', { name: '重置覆盖' }));
    const instance = page().nodes[FIXTURE_IDS.instance];
    expect(instance !== undefined && isInstanceNode(instance) && instance.overrides).toEqual({});
    expect(stack.history().undo[0]).toBe('重置覆盖');
  });

  it('缺失主组件的实例：徽标转为「缺失主组件」并给出提示', () => {
    const stack = fixtureStack();
    // 借命令栈删掉主组件：实例随后失去主件（真实路径，不手改文档）
    stack.dispatch([{ type: 'node.remove', pageId: 'p1', nodeId: FIXTURE_IDS.component }]);
    render(
      <ComponentPanel stack={stack} pageId="p1" selection={selectionOf([FIXTURE_IDS.instance])} />,
    );
    expect(part('badge')?.getAttribute('data-df-kind')).toBe('missing');
    expect(part('badge')?.textContent).toBe('缺失主组件');
    expect(part('main-missing')).not.toBeNull();
  });
});

describe('ComponentPanel · 变体切换', () => {
  it('变体实例：下拉显示当前取值，切换后实例改指新变体', () => {
    const { stack, page } = setup([FIXTURE_IDS.variantInstance]);
    const select = document.querySelector<HTMLSelectElement>(
      '[data-df-component="variant-select"]',
    );
    expect(select).not.toBeNull();
    if (select === null) throw new Error('变体下拉缺失');
    expect(select.value).toBe('small');

    fireEvent.change(select, { target: { value: 'large' } });
    const instance = page().nodes[FIXTURE_IDS.variantInstance];
    expect(instance !== undefined && isInstanceNode(instance) && instance.componentId).toBe(
      FIXTURE_IDS.variantLarge,
    );
    expect(stack.history().undo[0]).toBe('切换变体');
  });

  it('非变体实例：不渲染变体下拉', () => {
    setup([FIXTURE_IDS.instance]);
    expect(document.querySelector('[data-df-component="variant-select"]')).toBeNull();
  });
});
