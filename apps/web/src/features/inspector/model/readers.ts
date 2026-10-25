/**
 * 字段读取层（Inspector 的「读」侧）。
 *
 * 与引擎的分工：选中集与派生查询来自 `@dforge/engine` 的选择模型；
 * 本模块只做**字段级**归一——把「选中集 → 分区控件该显示什么」翻译成
 * `single / mixed（「—」）/ absent（分区隐藏）」三态，供控件无处不在地消费。
 *
 * 为什么单独成层：混选判定（C6）是 Inspector 全分区的公共语义，
 * 散落在各控件里会漂移；此处集中后，控件只关心「拿到 single 才显示值」。
 */

import {
  type AutoLayoutConfig,
  type BlendMode,
  type Effect,
  resolveNode,
  type SceneNode,
  type ScenePage,
  type Selection,
  selectionNodes,
  type TextContent,
} from '@dforge/engine';

/** 字段三态。 */
export type FieldValue<T> =
  /** 适用节点取值一致（含单选）。 */
  | { kind: 'single'; value: T }
  /** 多选且值不一致——界面显示「—」（C6）。 */
  | { kind: 'mixed' }
  /** 无适用节点——分区/控件隐藏。 */
  | { kind: 'absent' };

/** 逐节点取值；返回 undefined 表示该节点不适用此字段。 */
export type NodeFieldReader<T> = (node: SceneNode) => T | undefined;

/**
 * 读取字段三态：只统计适用节点；全部适用值一致 → 单值，否则 mixed。
 */
export function readField<T>(
  page: ScenePage,
  selection: Selection,
  read: NodeFieldReader<T>,
): FieldValue<T> {
  const values: T[] = [];
  for (const node of selectionNodes(page, selection)) {
    const value = read(node);
    if (value !== undefined) values.push(value);
  }
  return summarize(values);
}

/** 主选中节点的字段值（混选拖拽/步进的起始基准）；主选中不适用时回落首个适用节点。 */
export function activeFieldValue<T>(
  page: ScenePage,
  selection: Selection,
  read: NodeFieldReader<T>,
): T | undefined {
  if (selection.activeId !== null) {
    const active = resolveNode(page, selection.activeId);
    const value = active === undefined ? undefined : read(active);
    if (value !== undefined) return value;
  }
  for (const node of selectionNodes(page, selection)) {
    const value = read(node);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** 归纳取值列表为三态（内部；导出供 canvas 设置等场景复用同一语义）。 */
export function summarize<T>(values: readonly T[]): FieldValue<T> {
  if (values.length === 0) return { kind: 'absent' };
  const first = values[0] as T;
  for (const value of values.slice(1)) {
    if (value !== first) return { kind: 'mixed' };
  }
  return { kind: 'single', value: first };
}

/* ------------------------------------------------------------------------ *
 * 具体字段读取器（分区分组；控件直接引用，避免各处重写取数口径）
 * ------------------------------------------------------------------------ */

/** 几何/外观标量（父坐标系内的 x/y；opacity 为 0–1 真值）。 */
export type NumberFieldKey =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius';

/** 读标量字段。 */
export function readNumberField(page: ScenePage, selection: Selection, key: NumberFieldKey) {
  return readField<number>(page, selection, (node) => node[key]);
}

/** 读混合模式（P0 全节点通用）。 */
export function readBlendMode(page: ScenePage, selection: Selection) {
  return readField<BlendMode>(page, selection, (node) => node.blendMode);
}

/** 第一层填充为纯色时的可比色值；无填充或首层为渐变 → absent。 */
export function readFillColor(page: ScenePage, selection: Selection) {
  return readField<string>(page, selection, (node) => {
    const first = node.fills[0];
    return first !== undefined && first.type === 'solid' ? first.color : undefined;
  });
}

/** 第一层填充的不透明度（0–1）。 */
export function readFillOpacity(page: ScenePage, selection: Selection) {
  return readField<number>(page, selection, (node) => node.fills[0]?.opacity);
}

/** 第一层描边颜色。 */
export function readStrokeColor(page: ScenePage, selection: Selection) {
  return readField<string>(page, selection, (node) => {
    const paint = node.strokes[0]?.paint;
    return paint !== undefined && paint.type === 'solid' ? paint.color : undefined;
  });
}

/** 第一层描边宽度。 */
export function readStrokeWidth(page: ScenePage, selection: Selection) {
  return readField<number>(page, selection, (node) => node.strokes[0]?.width);
}

/** 效果列表是否结构一致（逐字段比较——Effect 是纯数据，引用不等不代表值不等）。 */
export function sameEffects(a: readonly Effect[], b: readonly Effect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((effect, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      effect.type === other.type &&
      effect.color === other.color &&
      effect.offsetX === other.offsetX &&
      effect.offsetY === other.offsetY &&
      effect.blur === other.blur &&
      effect.spread === other.spread &&
      effect.visible === other.visible
    );
  });
}

/**
 * 读效果列表三态（RW-10 效果分区）。
 *
 * 效果是节点基础属性（`NodeBase.effects`），对所有节点适用；**空列表也是合法单值**
 * （分区仍可见，给「添加效果」入口）——这与「无适用节点 → absent」不同。
 * 多选按结构比较：列表一致才 single，否则 mixed（界面显示「—」，只留添加入口）。
 */
export function readEffects(
  page: ScenePage,
  selection: Selection,
): FieldValue<readonly Effect[]> {
  const lists: readonly Effect[][] = [];
  for (const node of selectionNodes(page, selection)) lists.push(node.effects);
  if (lists.length === 0) return { kind: 'absent' };
  const first = lists[0] as readonly Effect[];
  for (const list of lists.slice(1)) {
    if (!sameEffects(first, list)) return { kind: 'mixed' };
  }
  return { kind: 'single', value: first };
}

/** 读文本字段（仅文本节点适用）；投影函数直接消费 `TextContent`。 */
export function readTextField<T>(
  page: ScenePage,
  selection: Selection,
  read: (text: TextContent) => T,
) {
  return readField<T>(page, selection, (node) =>
    node.type === 'text' ? read(node.text) : undefined,
  );
}

/** 读自动布局字段（仅已启用自动布局的画板适用）。 */
export function readAutoLayoutField<T>(
  page: ScenePage,
  selection: Selection,
  read: (config: AutoLayoutConfig) => T,
) {
  return readField<T>(page, selection, (node) =>
    node.type === 'frame' && node.autoLayout !== null ? read(node.autoLayout) : undefined,
  );
}

/** 读「自动布局是否启用」（画板适用；一部分启用一部分未启用 → mixed）。 */
export function readAutoLayoutEnabled(page: ScenePage, selection: Selection) {
  return readField<boolean>(page, selection, (node) =>
    node.type === 'frame' ? node.autoLayout !== null : undefined,
  );
}

/** 选择集是否含文本节点（文字分区显隐）。 */
export function selectionHasText(page: ScenePage, selection: Selection): boolean {
  return selectionNodes(page, selection).some((node) => node.type === 'text');
}

/** 选择集是否含画板（自动布局行显隐）。 */
export function selectionHasFrame(page: ScenePage, selection: Selection): boolean {
  return selectionNodes(page, selection).some((node) => node.type === 'frame');
}
