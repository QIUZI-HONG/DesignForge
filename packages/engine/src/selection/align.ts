/**
 * 对齐与分布（白名单第 11 类；C6「对齐工具行」）。
 *
 * 语义（Figma）：对齐把每个对象的世界包围盒边缘/中心对齐到**参考基准**——
 * 多选时基准是选择集并集；`relativeTo: 'parent'` 时基准是共同父容器。
 * 分布保持首尾对象不动、等分间隙。产出命令（不写文档），由命令栈结算。
 */

import { moveNodesByWorldCommands, parentIdOf } from '../commands/helpers';
import type { Command } from '../commands/types';
import { unionBounds } from '../geometry/bounds';
import { worldBoundsOfNode } from '../geometry/transform';
import type { Point, Rect } from '../geometry/types';
import type { NodeId, PageId, ScenePage } from '../model/index';
import { domainError } from '../scene/errors';

/** 对齐操作（六向）。 */
export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** 对齐基准。 */
export type AlignRelativeTo = 'selection' | 'parent';

/** 分布方向。 */
export type DistributeOp = 'horizontal' | 'vertical';

/** 对齐选项。 */
export interface AlignOptions {
  relativeTo?: AlignRelativeTo;
}

/** 取节点世界包围盒（缺失抛错）。 */
function requireBounds(page: ScenePage, id: NodeId): Rect {
  const bounds = worldBoundsOfNode(page, id);
  if (!bounds) throw domainError('node-not-found', `节点不存在：${id}`);
  return bounds;
}

/** 参考基准矩形。 */
export function alignReference(
  page: ScenePage,
  ids: readonly NodeId[],
  relativeTo: AlignRelativeTo,
): Rect {
  if (relativeTo === 'selection') {
    const union = unionBounds(ids.map((id) => requireBounds(page, id)));
    if (!union) throw domainError('invalid-argument', '选择集为空');
    return union;
  }
  // 共同父容器
  const parents = new Set<string | null>();
  for (const id of ids) parents.add(parentIdOf(page, id));
  if (parents.size !== 1) {
    throw domainError('invalid-argument', '对齐到父容器要求所选节点同属一个父级');
  }
  const parentId = [...parents][0] as NodeId | null;
  if (parentId === null) {
    throw domainError('invalid-argument', '顶层节点的「对齐到父容器」无基准（页面无边界）');
  }
  return requireBounds(page, parentId);
}

/** 计算某节点在给定对齐操作下的**世界位移**。 */
export function alignDelta(bounds: Rect, reference: Rect, op: AlignOp): Point {
  const centerX = (rect: Rect): number => rect.x + rect.width / 2;
  const centerY = (rect: Rect): number => rect.y + rect.height / 2;
  switch (op) {
    case 'left':
      return { x: reference.x - bounds.x, y: 0 };
    case 'hcenter':
      return { x: centerX(reference) - centerX(bounds), y: 0 };
    case 'right':
      return { x: reference.x + reference.width - (bounds.x + bounds.width), y: 0 };
    case 'top':
      return { x: 0, y: reference.y - bounds.y };
    case 'vcenter':
      return { x: 0, y: centerY(reference) - centerY(bounds) };
    case 'bottom':
      return { x: 0, y: reference.y + reference.height - (bounds.y + bounds.height) };
  }
}

/** 对齐命令（对每个节点按世界位移换算到其父坐标系）。 */
export function alignCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  op: AlignOp,
  options: AlignOptions = {},
): Command[] {
  if (ids.length === 0) return [];
  const reference = alignReference(page, ids, options.relativeTo ?? 'selection');
  const commands: Command[] = [];
  for (const id of ids) {
    const bounds = requireBounds(page, id);
    const delta = alignDelta(bounds, reference, op);
    if (delta.x === 0 && delta.y === 0) continue;
    commands.push(...moveNodesByWorldCommands(page, pageId, [id], delta));
  }
  return commands;
}

/**
 * 分布：沿轴等分**间隙**，首尾对象不动。
 * `spacing` 省略时按「等间隙」分布；给定 `spacing` 时按固定间距依次排列。
 */
export function distributeCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  op: DistributeOp,
  options: { spacing?: number } = {},
): Command[] {
  if (ids.length < 2) return [];
  const axis = op === 'horizontal' ? 'x' : 'y';
  const entries = ids.map((id) => {
    const bounds = requireBounds(page, id);
    const start = axis === 'x' ? bounds.x : bounds.y;
    const size = axis === 'x' ? bounds.width : bounds.height;
    return { id, bounds, start, size, end: start + size };
  });
  entries.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const first = entries[0] as (typeof entries)[number];
  const last = entries[entries.length - 1] as (typeof entries)[number];
  const totalSpace =
    options.spacing !== undefined
      ? options.spacing
      : (last.end - first.start - entries.reduce((sum, entry) => sum + entry.size, 0)) /
        (entries.length - 1);

  const commands: Command[] = [];
  let cursor = first.start;
  for (const entry of entries) {
    const delta = cursor - entry.start;
    if (delta !== 0) {
      commands.push(
        ...moveNodesByWorldCommands(
          page,
          pageId,
          [entry.id],
          axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta },
        ),
      );
    }
    cursor += entry.size + totalSpace;
  }
  return commands;
}

/** 对齐工具行的可用性（C6：少于 2 个对象时仅剩「对齐到父容器」有意义）。 */
export function alignAvailability(
  count: number,
  relativeTo: AlignRelativeTo = 'selection',
): boolean {
  return relativeTo === 'parent' ? count >= 1 : count >= 2;
}
