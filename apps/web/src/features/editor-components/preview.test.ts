/**
 * 组件预览预设规格（宿主协议契约）。
 *
 * 门禁与宿主页面都依赖这五个状态可复现：断言各状态的选择集能读到预期的面板语义
 *（可创建 / 主组件 / 覆盖 1 条 / 变体在集内 / 缺失主组件），以及文档不被就地修改的冻结语义。
 */

import { describe, expect, it } from 'vitest';
import { readOverrideEntries } from './model/overrides';
import { canCreateComponent, readSelectionComponent } from './model/reads';
import { readVariantState } from './model/variants';
import {
  COMPONENT_PREVIEW_STATES,
  COMPONENTS_PREVIEW_IDS,
  createComponentsPreviewDocument,
  createComponentsPreviewStack,
  previewSelection,
} from './preview';

/** 取状态对应的页面。 */
function pageOf(state: (typeof COMPONENT_PREVIEW_STATES)[number]) {
  const document = createComponentsPreviewDocument(state);
  const page = document.pages[0];
  if (page === undefined) throw new Error('预览缺页');
  return page;
}

describe('COMPONENT_PREVIEW_STATES（宿主协议取值）', () => {
  it('五态齐备且与门禁取值同名', () => {
    expect([...COMPONENT_PREVIEW_STATES]).toEqual([
      'plain',
      'component',
      'instance',
      'variant',
      'missing',
    ]);
  });

  it('每个状态都有可解析的选择集（节点真实存在）', () => {
    for (const state of COMPONENT_PREVIEW_STATES) {
      const page = pageOf(state);
      const selection = previewSelection(state);
      for (const id of selection.ids) {
        expect(page.nodes[id], `${state} 缺少节点 ${id}`).toBeDefined();
      }
    }
  });
});

describe('组件预览各状态的看点', () => {
  it('plain：同父级两矩形 → 可创建组件', () => {
    const page = pageOf('plain');
    expect(canCreateComponent(page, previewSelection('plain'))).toEqual({ ok: true });
  });

  it('component：主组件态（读到实例计数）', () => {
    const page = pageOf('component');
    const read = readSelectionComponent(page, previewSelection('component'));
    expect(read.kind).toBe('component');
    expect(read.instanceCount).toBe(1);
  });

  it('instance：覆盖 1 条（覆盖清单有内容）', () => {
    const page = pageOf('instance');
    const read = readSelectionComponent(page, previewSelection('instance'));
    expect(read.kind).toBe('instance');
    expect(readOverrideEntries(page, COMPONENTS_PREVIEW_IDS.instance)).toHaveLength(1);
  });

  it('variant：实例在组件集内（变体下拉有维度）', () => {
    const page = pageOf('variant');
    const state = readVariantState(page, COMPONENTS_PREVIEW_IDS.variantInstance);
    expect(state?.setId).toBe(COMPONENTS_PREVIEW_IDS.set);
    expect(state?.dimensions[0]?.values).toEqual(['large', 'small']);
  });

  it('missing：实例的主组件不在页面内（detached）', () => {
    const page = pageOf('missing');
    const read = readSelectionComponent(page, previewSelection('missing'));
    expect(read.kind).toBe('instance');
    expect(read.detached).toBe(true);
  });

  it('预览命令栈冻结文档（逮住绕过命令栈的就地写入）', () => {
    const stack = createComponentsPreviewStack('plain');
    expect(() => {
      const page = stack.document.pages[0];
      if (page !== undefined) (page as { name: string }).name = '就地改名';
    }).toThrow();
  });
});
