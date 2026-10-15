/**
 * C15 检查态属性摘要规格（纯逻辑）。
 *
 * 断言：单选给「位置/尺寸/填充/圆角/文字」摘要，测值取自文档真值（视图节点，覆盖已应用）。
 */

import type { ScenePage } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import {
  INSPECT_IDS,
  inspectPage,
  inspectSelection,
  TOKEN_VALUES,
  UNBOUND_FILL,
} from '../testing/fixtures';
import { readInspectSummary } from './selection-reads';

/** 取字段值（按 i18n 键）。 */
function fieldValue(page: ScenePage, ids: readonly string[], key: string): string | undefined {
  const summary = readInspectSummary(page, inspectSelection(ids));
  return summary.fields.find((field) => field.labelKey === key)?.value;
}

describe('readInspectSummary（检查态摘要）', () => {
  const page: ScenePage = inspectPage();

  it('空选：kind=none，无字段', () => {
    const summary = readInspectSummary(page, inspectSelection([]));
    expect(summary.kind).toBe('none');
    expect(summary.fields).toEqual([]);
  });

  it('单选矩形：位置/尺寸/填充/圆角齐备', () => {
    const summary = readInspectSummary(page, inspectSelection([INSPECT_IDS.card]));
    expect(summary.kind).toBe('single');
    expect(summary.name).toBe('卡片');
    expect(fieldValue(page, [INSPECT_IDS.card], 'editor.inspect.field.position')).toBe('24, 32');
    expect(fieldValue(page, [INSPECT_IDS.card], 'editor.inspect.field.size')).toBe('240 × 160');
    expect(fieldValue(page, [INSPECT_IDS.card], 'editor.inspect.field.fill')).toBe(
      TOKEN_VALUES.brand,
    );
    expect(fieldValue(page, [INSPECT_IDS.card], 'editor.inspect.field.radius')).toBe('8');
  });

  it('未绑定填充：照样给原始值（检查态不做令牌解释，令牌说明在代码区）', () => {
    expect(fieldValue(page, [INSPECT_IDS.plain], 'editor.inspect.field.fill')).toBe(UNBOUND_FILL);
  });

  it('文本节点：给出文字内容与字号相关摘要', () => {
    const summary = readInspectSummary(page, inspectSelection([INSPECT_IDS.title]));
    expect(fieldValue(page, [INSPECT_IDS.title], 'editor.inspect.field.text')).toBe(
      '设界 DesignForge',
    );
    expect(summary.fields.some((field) => field.labelKey === 'editor.inspect.field.radius')).toBe(
      false,
    );
  });

  it('多选：kind=multiple，只给数量（摘要留给单节点）', () => {
    const summary = readInspectSummary(
      page,
      inspectSelection([INSPECT_IDS.card, INSPECT_IDS.neighbor]),
    );
    expect(summary.kind).toBe('multiple');
    expect(summary.count).toBe(2);
    expect(summary.fields).toEqual([]);
  });
});
