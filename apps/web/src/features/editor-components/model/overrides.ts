/**
 * C17 覆盖清单读取：实例覆盖表 → 面板可渲染的条目（值 vs 主组件原值）。
 *
 * 为什么不是「拿视图节点和主组件节点做 diff」：覆盖表是文档里**唯一**的覆盖真值
 *（`InstanceNode.overrides`），diff 会把「主组件恰好与默认值相同」误判成覆盖。
 * 本模块只查覆盖表，再用主组件节点取原值做对照展示。
 */

import {
  isInstanceNode,
  type NodeId,
  type NodePatch,
  overrideAt,
  type PatchableKey,
  type ScenePage,
  virtualNodeId,
} from '@dforge/engine';

import { displayNameOf } from './reads';

/** 单条覆盖属性的展示读取。 */
export interface OverridePropertyRead {
  key: PatchableKey;
  /** 覆盖值摘要（人类可读）。 */
  value: string;
  /** 主组件原值摘要（对照展示「回了什么」）。 */
  mainValue: string;
}

/** 单条覆盖路径的展示读取。 */
export interface OverrideEntryRead {
  /** 覆盖表键（路径串，如 `cmp1_bg`）。 */
  key: string;
  /** 路径（主组件内节点 id 链）。 */
  path: NodeId[];
  /** 虚节点 id（选中/重置定位用）。 */
  virtualId: NodeId;
  /** 目标节点显示名。 */
  label: string;
  properties: OverridePropertyRead[];
}

/** 列出实例的覆盖条目（按路径键稳定排序，无覆盖为空数组）。 */
export function readOverrideEntries(page: ScenePage, instanceId: NodeId): OverrideEntryRead[] {
  const instance = page.nodes[instanceId];
  if (!instance || !isInstanceNode(instance)) return [];
  const entries: OverrideEntryRead[] = [];
  for (const key of Object.keys(instance.overrides).sort()) {
    const path = key.split('/');
    const patch = instance.overrides[key];
    if (!patch) continue;
    const realId = path[path.length - 1] as NodeId;
    const main = page.nodes[realId];
    entries.push({
      key,
      path,
      virtualId: virtualNodeId(instanceId, path),
      label: main !== undefined ? main.name : displayNameOf(page, realId),
      properties: Object.keys(patch)
        .sort()
        .map((propertyKey) => {
          const typedKey = propertyKey as PatchableKey;
          const mainSource = (main as unknown as Record<string, unknown> | undefined)?.[
            propertyKey
          ];
          return {
            key: typedKey,
            value: summarizePatchValue((patch as Record<string, unknown>)[propertyKey]),
            mainValue: summarizePatchValue(mainSource),
          };
        }),
    });
  }
  return entries;
}

/** 某实例某路径上的覆盖补丁（外部只读用途；不存在返回 undefined）。 */
export function overridePatchAt(
  page: ScenePage,
  instanceId: NodeId,
  path: readonly NodeId[],
): NodePatch | undefined {
  const instance = page.nodes[instanceId];
  if (!instance || !isInstanceNode(instance)) return undefined;
  return overrideAt(instance.overrides, path);
}

/**
 * 覆盖值摘要：面向「一眼看懂改了什么」的最小投影——
 * 填充/描边走色值，文本走字符内容，布尔走中文，其余走紧凑字面。
 */
export function summarizePatchValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const paints = value
      .map((item) => paintColorOf(item))
      .filter((color): color is string => color !== null);
    if (paints.length > 0) return paints.join('、');
    return value.length === 0 ? '无' : `${String(value.length)} 项`;
  }
  const text = textCharactersOf(value);
  if (text !== null) return text;
  const autoLayout = autoLayoutSummary(value);
  if (autoLayout !== null) return autoLayout;
  return JSON.stringify(value) ?? '—';
}

/** 取画刷的颜色（纯色/渐变首停靠点）；非画刷返回 null。 */
function paintColorOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const paint = value as Record<string, unknown>;
  if (paint.type === 'solid' && typeof paint.color === 'string') return paint.color;
  if (paint.type === 'linear_gradient' && Array.isArray(paint.stops)) {
    const first = paint.stops[0] as { color?: unknown } | undefined;
    if (typeof first?.color === 'string') return first.color;
  }
  return null;
}

/** 取文本内容（TextContent 形状的字符部分）。 */
function textCharactersOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const characters = (value as { characters?: unknown }).characters;
  return typeof characters === 'string' ? characters : null;
}

/** 自动布局摘要（`autoLayout` 覆盖的展示形态）。 */
function autoLayoutSummary(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const layout = value as { direction?: unknown; gap?: unknown };
  if (typeof layout.direction !== 'string') return null;
  const direction = layout.direction === 'horizontal' ? '横向' : '纵向';
  return typeof layout.gap === 'number'
    ? `${direction} · 间距 ${formatNumber(layout.gap)}`
    : direction;
}

/** 数值格式化：去除浮点尾零（0.50 → 0.5）。 */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}
