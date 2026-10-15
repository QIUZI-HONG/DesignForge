/**
 * 检查 / 导出预览预设规格（宿主协议契约）。
 *
 * 门禁与宿主页面依赖这三个状态可复现：`bound`（令牌全命中）、`unbound`（回退提示）、
 * `empty`（空态）；断言选择集能读到预期的代码输出与摘要语义。
 */

import { describe, expect, it } from 'vitest';

import { generateCss } from './model/codegen';
import { readInspectSummary } from './model/selection-reads';
import {
  createInspectPreviewDocument,
  createInspectPreviewStack,
  INSPECT_PREVIEW_STATES,
  previewSelection,
  previewTokens,
} from './preview';

/** 取预览页面。 */
function pageOf(): ReturnType<typeof createInspectPreviewDocument>['pages'][number] {
  const page = createInspectPreviewDocument().pages[0];
  if (page === undefined) throw new Error('预览缺页');
  return page;
}

describe('INSPECT_PREVIEW_STATES（宿主协议取值）', () => {
  it('三态齐备且与门禁取值同名', () => {
    expect([...INSPECT_PREVIEW_STATES]).toEqual(['bound', 'unbound', 'empty']);
  });
});

describe('检查预览各状态的看点', () => {
  it('bound：令牌全命中（代码含 var()，说明区无未绑定项）', () => {
    const page = pageOf();
    const selection = previewSelection('bound');
    const generated = generateCss(page, selection.ids[0] ?? '', { tokens: previewTokens() });
    expect(generated.code).toContain('var(--dfg-design-color-brand');
    expect(generated.unbound).toBe(0);
    expect(readInspectSummary(page, selection).fields.length).toBeGreaterThan(0);
  });

  it('unbound：填充未绑定令牌（回退提示）', () => {
    const page = pageOf();
    const selection = previewSelection('unbound');
    const generated = generateCss(page, selection.ids[0] ?? '', { tokens: previewTokens() });
    expect(generated.unbound).toBe(1);
  });

  it('empty：空选（摘要为空态）', () => {
    const page = pageOf();
    expect(readInspectSummary(page, previewSelection('empty')).kind).toBe('none');
  });

  it('预览命令栈冻结文档', () => {
    const stack = createInspectPreviewStack();
    const page = stack.document.pages[0];
    expect(() => {
      if (page !== undefined) (page as { name: string }).name = '就地改名';
    }).toThrow();
  });
});
