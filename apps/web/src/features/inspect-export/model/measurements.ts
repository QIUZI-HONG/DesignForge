/**
 * C15 测量标注读取：选中对象与相邻对象的间距（复用画布侧数据）。
 *
 * 为什么复用引擎：拖动时画布上画的红色间距标注来自 `@dforge/engine` 的
 * `computeMeasurements`（含 `snapTargetsFromPage` 的参考对象口径）；检查态若另算一套，
 * 面板数字与画布标注就会出现两个真相。本模块只做「对象 id → 显示名」的投影。
 */

import {
  computeMeasurements,
  type NodeId,
  resolveNode,
  type ScenePage,
  type Selection,
  type SnapTarget,
  snapTargetsFromPage,
  worldBoundsOfNodes,
} from '@dforge/engine';

/** 单条测量标注（面板渲染用）。 */
export interface MeasureAnnotationRead {
  /** 稳定 id（`${axis}-${refId}`，UI key 与测试断言共用）。 */
  id: string;
  axis: 'x' | 'y';
  /** 间距值（世界单位）。 */
  value: number;
  /** 标注线所在位置（另一轴，世界坐标）。 */
  at: number;
  /** 区间起止（沿 axis，世界坐标）。 */
  from: number;
  to: number;
  /** 参照对象 id / 显示名。 */
  refId: string;
  refName: string;
}

/** 读取选中对象与相邻对象的间距（先横向后纵向，各自按参照名稳定排序）。 */
export function readMeasurements(page: ScenePage, selection: Selection): MeasureAnnotationRead[] {
  if (selection.ids.length === 0) return [];
  const bounds = worldBoundsOfNodes(page, selection.ids);
  if (bounds === null) return [];
  const targets: SnapTarget[] = snapTargetsFromPage(page, selection.ids);
  const raw = computeMeasurements(bounds, targets, { maxDistance: 1000 });
  return raw
    .map((measurement) => {
      const refId = measurement.refs[0] ?? '';
      return {
        id: `${measurement.axis}-${refId}`,
        axis: measurement.axis,
        value: measurement.value,
        at: measurement.at,
        from: measurement.from,
        to: measurement.to,
        refId,
        refName: nameOf(page, refId),
      };
    })
    .sort(
      (a, b) =>
        a.axis.localeCompare(b.axis) ||
        a.refName.localeCompare(b.refName) ||
        a.id.localeCompare(b.id),
    );
}

/** 参照对象显示名（解析不到时退回 id，不吞掉信息）。 */
function nameOf(page: ScenePage, id: NodeId): string {
  return resolveNode(page, id)?.name ?? id;
}

/** 间距数值显示：整数原样、浮点去尾零。 */
export function formatMeasureValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}
