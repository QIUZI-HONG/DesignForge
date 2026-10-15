// @vitest-environment jsdom
/**
 * InspectPanel（C15 检查 / 导出态）规格。
 *
 * 断言：三区齐备（属性摘要 / 测量标注 / 代码与导出，与 F6 **同源**）、
 * 测量标注复用画布侧数据（值 = 引擎 `computeMeasurements` 的结果）、
 * 空选给空态、多选按主选中对象展开且提示已选数量。
 */

import type { CommandStack, ScenePage } from '@dforge/engine';
import { ToastProvider } from '@dforge/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { INSPECT_IDS, inspectSelection, inspectStack, MEASURED_GAP } from '../testing/fixtures';
import { InspectPanel } from './InspectPanel';

/** 渲染检查面板并返回断言句柄。 */
function setup(ids: readonly string[], activeId?: string) {
  const stack: CommandStack = inspectStack();
  render(
    <ToastProvider>
      <InspectPanel
        stack={stack}
        pageId="p1"
        selection={inspectSelection(ids, activeId)}
        documentId="doc_inspect"
      />
    </ToastProvider>,
  );
  const page = (): ScenePage => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失页面');
    return current;
  };
  return { stack, page };
}

/** 取带 data-df-inspect 标记的元素。 */
function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-df-inspect="${name}"]`);
}

afterEach(() => {
  cleanup();
});

describe('InspectPanel · 空选', () => {
  it('空选：给「选择一个图层查看检查信息」空态，不渲染测量与代码', () => {
    setup([]);
    expect(screen.getByText('选择一个图层查看检查信息')).toBeDefined();
    expect(part('measurements')).toBeNull();
    expect(part('code-export')).toBeNull();
    expect(part('export-panel')).toBeNull();
  });
});

describe('InspectPanel · 三区齐备（C15 = 属性 + 测量 + 代码/导出）', () => {
  it('单选卡片：属性摘要 + 测量标注 + 代码区（CSS/React）+ 导出三档', () => {
    setup([INSPECT_IDS.card]);
    expect(part('panel')).not.toBeNull();

    // 属性摘要（节点名在标题行）
    expect(part('selection-count')?.textContent).toBe('卡片');
    const props = part('properties');
    expect(props?.textContent).toContain('24, 32');
    expect(props?.textContent).toContain('240 × 160');

    // 测量标注（复用画布侧数据）
    const measurements = document.querySelectorAll('[data-df-inspect="measurement"]');
    expect(measurements).toHaveLength(2);
    const horizontal = measurements[0] as HTMLElement;
    expect(horizontal.getAttribute('data-df-axis')).toBe('x');
    expect(horizontal.getAttribute('data-df-value')).toBe(String(MEASURED_GAP));
    expect(horizontal.textContent).toContain('横向');
    expect(horizontal.textContent).toContain('相邻块');

    // 代码区（同源）与导出面板
    expect(part('code')?.textContent).toContain('.df-node-card {');
    expect(part('code-export')).not.toBeNull();
    expect(part('export-panel')).not.toBeNull();
    for (const format of ['png', 'svg', 'pdf']) {
      expect(part(`export-${format}`)).not.toBeNull();
    }
  });

  it('无相邻对象的孤立节点：测量区给空态提示（不虚构间距）', () => {
    setup([INSPECT_IDS.frame]);
    expect(screen.getByText('与相邻对象暂无间距')).toBeDefined();
    expect(document.querySelectorAll('[data-df-inspect="measurement"]')).toHaveLength(0);
  });

  it('多选：按主选中对象展开，并提示已选数量', () => {
    setup([INSPECT_IDS.neighbor, INSPECT_IDS.card], INSPECT_IDS.card);
    expect(screen.getByText('已选 2 个图层')).toBeDefined();
    // 代码与属性跟随主选中（card）
    expect(part('code')?.textContent).toContain('.df-node-card {');
    expect(part('properties')?.textContent).toContain('240 × 160');
  });
});
