// @vitest-environment jsdom
/**
 * 三态预览预设（FE-05 ⇄ 宿主页面接口）规格。
 *
 * 预设必须自洽：`previewSelection(state)` 引用的节点都存在于 `createPreviewDocument()`，
 * 且三态各自满足对照口径（默认=四分区齐备、混选=存在混合值、空选=画布设置）。
 */

import { readField as engineReadField, findPage } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { readField, readNumberField } from './model/readers';
import { createPreviewDocument, INSPECTOR_PREVIEW_STATES, previewSelection } from './preview';

describe('Inspector 三态预览预设', () => {
  it('状态枚举与门禁口径一致（default/mixed/empty）', () => {
    expect([...INSPECTOR_PREVIEW_STATES]).toEqual(['default', 'mixed', 'empty']);
  });

  it('预览文档含页面且各状态引用的节点都存在', () => {
    const document = createPreviewDocument();
    const page = findPage(document, 'p1');
    expect(page).not.toBeUndefined();
    if (page === undefined) return;

    for (const state of INSPECTOR_PREVIEW_STATES) {
      const selection = previewSelection(state);
      for (const id of selection.ids) {
        expect(page.nodes[id], `${state} → ${id}`).not.toBeUndefined();
      }
    }
  });

  it('default：单选文本节点（四个分区都可渲染）', () => {
    const page = findPage(createPreviewDocument(), 'p1');
    if (page === undefined) throw new Error('预览文档缺少页面');
    const selection = previewSelection('default');
    const kinds = selection.ids.map((id) => page.nodes[id]?.type);
    expect(kinds).toEqual(['text']);
  });

  it('mixed：多选且存在混合值（C6「—」对照面）', () => {
    const page = findPage(createPreviewDocument(), 'p1');
    if (page === undefined) throw new Error('预览文档缺少页面');
    const selection = previewSelection('mixed');
    expect(readNumberField(page, selection, 'x')).toEqual({ kind: 'mixed' });
    expect(readField(page, selection, (node) => node.width)).toEqual({
      kind: 'single',
      value: 100,
    });
  });

  it('empty：空选择（C7 画布设置对照面）', () => {
    expect(previewSelection('empty').ids).toEqual([]);
  });
});
