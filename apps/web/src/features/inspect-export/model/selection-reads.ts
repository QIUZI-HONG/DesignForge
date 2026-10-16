/**
 * C15 检查态摘要：选中节点 → 属性行（位置/尺寸/填充/描边/圆角/文字）。
 *
 * 口径：测值取自**视图节点**（实例覆盖已应用）——检查态看到的就是画布上呈现的那份；
 * 令牌解释不在这里做（那属于 F6 的「Token → CSS 变量」说明区），
 * 摘要只给文档真值，避免同一屏出现两种解释。
 */

import {
  isPaintVisible,
  type NodeId,
  resolveNode,
  type ScenePage,
  type Selection,
} from '@dforge/engine';

/** 一行属性摘要。 */
export interface InspectFieldRead {
  /** 标签的 i18n 键（文案真源在 messages）。 */
  labelKey: string;
  value: string;
}

/** 检查态摘要。 */
export interface InspectSummaryRead {
  kind: 'none' | 'single' | 'multiple';
  count: number;
  /** 单选节点 id（多选为空）。 */
  nodeId: NodeId | null;
  name: string | null;
  fields: InspectFieldRead[];
}

/** 读取检查态摘要。 */
export function readInspectSummary(page: ScenePage, selection: Selection): InspectSummaryRead {
  const count = selection.ids.length;
  if (count === 0) return { kind: 'none', count: 0, nodeId: null, name: null, fields: [] };
  if (count > 1) {
    return { kind: 'multiple', count, nodeId: null, name: null, fields: [] };
  }
  const nodeId = selection.ids[0] as NodeId;
  const node = resolveNode(page, nodeId);
  if (node === undefined) return { kind: 'none', count: 0, nodeId: null, name: null, fields: [] };

  const fields: InspectFieldRead[] = [];
  fields.push({
    labelKey: 'editor.inspect.field.position',
    value: `${format(node.x)}, ${format(node.y)}`,
  });
  fields.push({
    labelKey: 'editor.inspect.field.size',
    value: `${format(node.width)} × ${format(node.height)}`,
  });

  const fill = node.fills.find((paint) => isPaintVisible(paint));
  if (fill !== undefined) {
    fields.push({
      labelKey: 'editor.inspect.field.fill',
      value: fill.type === 'solid' ? fill.color : (fill.stops[0]?.color ?? '—'),
    });
  }

  const stroke = node.strokes[0];
  if (stroke !== undefined && isPaintVisible(stroke.paint)) {
    const color =
      stroke.paint.type === 'solid' ? stroke.paint.color : (stroke.paint.stops[0]?.color ?? '—');
    fields.push({
      labelKey: 'editor.inspect.field.stroke',
      value: `${format(stroke.width)} · ${color}`,
    });
  }

  if (node.cornerRadius > 0) {
    fields.push({
      labelKey: 'editor.inspect.field.radius',
      value: format(node.cornerRadius),
    });
  }

  if (node.type === 'text') {
    fields.push({ labelKey: 'editor.inspect.field.text', value: node.text.characters });
  }

  return { kind: 'single', count: 1, nodeId, name: node.name, fields };
}

/** 数值显示：整数原样、浮点去尾零。 */
function format(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}
