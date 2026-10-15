/**
 * 命中测试：点选 / 框选（含旋转节点）/ 选择目标推导。
 *
 * 规则（对齐 Figma 手感）：
 * - 遍历顺序：页面顶层按绘制顺序**从前往后**（后画的在上），容器内部「子先于自身」；
 * - 编组自身不参与点命中（点选穿过编组落到子节点，再由 `clickSelectionTarget` 归到最外层编组）；
 * - `clipsContent` 的画板：点落在画板外时不再深入其子树（裁剪区外的子节点不可点）；
 * - 隐藏节点默认不可命中；锁定节点可命中但由调用方决定是否可选；
 * - 实例为原子（P0 不点进实例内部）——框选同理。
 */

import type { NodeId, SceneNode, ScenePage } from '../model/index';
import { isContainer, isGroupNode, isInstanceNode } from '../model/index';
import { quadBounds, quadIntersectsRect, rectContainsRect } from './bounds';
import { nodeContainsLocalPoint, worldPointToLocal, worldQuad } from './transform';
import type { Point, Rect } from './types';

/** 命中选项。 */
export interface HitOptions {
  /** 命中隐藏节点（默认 false）。 */
  includeHidden?: boolean;
  /** 命中锁定节点（默认 false）。 */
  includeLocked?: boolean;
  /** 自定义过滤。 */
  filter?: (node: SceneNode, id: NodeId) => boolean;
}

/** 命中结果。 */
export interface HitResult {
  id: NodeId;
  node: SceneNode;
  /** 从页面顶层到该节点的 id 路径（含自身）。 */
  path: NodeId[];
}

/** 节点是否参与命中（可见性/锁定/自定义过滤）。 */
function isCandidate(node: SceneNode, options: HitOptions): boolean {
  if (!options.includeHidden && !node.visible) return false;
  if (!options.includeLocked && node.locked) return false;
  if (options.filter && !options.filter(node, node.id)) return false;
  return true;
}

/**
 * 点命中：返回所有命中的节点，**从前往后**（第一个 = 视觉最上层/最深）。
 */
export function hitTestAll(page: ScenePage, point: Point, options: HitOptions = {}): HitResult[] {
  const results: HitResult[] = [];
  const visit = (id: NodeId, path: NodeId[]): void => {
    const node = page.nodes[id];
    if (!node || !isCandidate(node, options)) return;
    const nextPath = [...path, id];
    const localPoint = worldPointToLocal(page, id, point);
    const hitSelf = localPoint !== null && nodeContainsLocalPoint(node, localPoint);

    // 画板裁剪：点不在画板内则不深入（裁剪区外的子节点不可见/不可点）
    const clipped =
      node.type === 'frame' && node.clipsContent && localPoint !== null
        ? !inLocalArea(node, localPoint)
        : localPoint === null;

    if (isContainer(node) && !clipped) {
      const children = [...node.children].reverse(); // 从前往后
      for (const childId of children) visit(childId, nextPath);
    }
    if (hitSelf) results.push({ id, node, path: nextPath });
  };

  for (const rootId of [...page.rootIds].reverse()) visit(rootId, []);
  return results;
}

/** 局部点是否在节点几何范围内（用于裁剪判定；不含编组）。 */
function inLocalArea(node: SceneNode, localPoint: Point): boolean {
  return (
    localPoint.x >= 0 &&
    localPoint.y >= 0 &&
    localPoint.x <= node.width &&
    localPoint.y <= node.height
  );
}

/** 点命中：返回视觉最上层的节点。 */
export function hitTestPoint(
  page: ScenePage,
  point: Point,
  options: HitOptions = {},
): HitResult | null {
  return hitTestAll(page, point, options)[0] ?? null;
}

/** 某节点自身形状是否包含该世界点。 */
export function hitTestNode(page: ScenePage, id: NodeId, point: Point): boolean {
  const node = page.nodes[id];
  if (!node) return false;
  const localPoint = worldPointToLocal(page, id, point);
  return localPoint !== null && nodeContainsLocalPoint(node, localPoint);
}

/**
 * 单击选择目标：
 * - 默认（浅点击）：向上穿过**编组**——编组不可命中，单击选中最外层编组；
 * - `deep: true`（双击进入）：直接取最深命中节点。
 */
export function clickSelectionTarget(
  page: ScenePage,
  point: Point,
  options: HitOptions & { deep?: boolean } = {},
): NodeId | null {
  const hit = hitTestPoint(page, point, options);
  if (!hit) return null;
  if (options.deep) return hit.id;
  let target = hit.id;
  let parent = hit.path.length >= 2 ? (hit.path[hit.path.length - 2] as NodeId) : null;
  while (parent !== null) {
    const parentNode = page.nodes[parent];
    if (!parentNode || !isGroupNode(parentNode)) break;
    target = parent;
    const path = findPath(page, parent);
    parent = path.length >= 2 ? (path[path.length - 2] as NodeId) : null;
  }
  return target;
}

/** 求节点到页面顶层的路径（含自身）。 */
export function findPath(page: ScenePage, id: NodeId): NodeId[] {
  const path: NodeId[] = [id];
  let current = id;
  for (;;) {
    const parent = findParent(page, current);
    if (parent === null) return [...path].reverse();
    path.push(parent);
    current = parent;
  }
}

/** 线性找父（命中热点路径外，少用）。 */
function findParent(page: ScenePage, id: NodeId): NodeId | null {
  if (page.rootIds.includes(id)) return null;
  for (const node of Object.values(page.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return node.id;
  }
  return null;
}

/** 框选模式。 */
export type MarqueeMode = 'intersect' | 'contain';

/** 框选选项。 */
export interface MarqueeOptions extends HitOptions {
  mode?: MarqueeMode;
  /** 需要排除的 id（如已锁定/隐藏的层级容器）。 */
  excludeIds?: readonly NodeId[];
}

/**
 * 框选：返回应被选中的 id 集合。
 *
 * 规则：命中即选，但**容器在未被完全包含时向下深入**——
 * 框选落在画板内部时选中的是画板内的子节点，只有框住整个容器才选中容器本身。
 */
export function marqueeSelect(page: ScenePage, rect: Rect, options: MarqueeOptions = {}): NodeId[] {
  const mode: MarqueeMode = options.mode ?? 'intersect';
  const exclude = new Set(options.excludeIds ?? []);
  const out: NodeId[] = [];

  const visit = (id: NodeId): void => {
    const node = page.nodes[id];
    if (!node || !isCandidate(node, options) || exclude.has(id)) return;
    const quad = worldQuad(page, id);
    if (!quad) return;
    const contained = rectContainsRect(rect, quadBounds(quad));
    const matched = matchesMarquee(quad, rect, mode);

    if (isInstanceNode(node)) {
      // 实例为原子：整体命中即选中（P0 不进入实例内部）
      if (matched) out.push(id);
      return;
    }
    if (isContainer(node) && !contained) {
      // 未被完全包含：向下深入——框选落在容器内部时命中的是容器内的子节点
      const before = out.length;
      for (const childId of node.children) visit(childId);
      if (out.length === before && matched) out.push(id); // 子层无命中 → 选容器自身
      return;
    }
    if (matched) out.push(id);
  };

  for (const rootId of page.rootIds) visit(rootId);
  return out;
}

/** 命中判定：`contain` 要求完全包含，`intersect` 允许相交。 */
function matchesMarquee(quad: readonly Point[], rect: Rect, mode: MarqueeMode): boolean {
  if (mode === 'contain') return rectContainsRect(rect, quadBounds(quad));
  return quadIntersectsRect(quad, rect);
}
