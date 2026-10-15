/**
 * 自动布局（子集）：轴向堆叠 + 间距 + 内边距 + 主轴对齐 + 交叉轴对齐 + 尺寸模式（固定/包裹/填充）。
 *
 * 两遍求解（架构 v1.1 §4.1「测量 → 排布」）：先量出内容尺寸，再决定容器包裹尺寸与排布起点。
 * `autoLayoutCommands` 把结果翻译成命令（只产出**变化**的属性，避免无意义的历史条目）。
 */

import type { Command } from '../commands/types';
import type { Point, Size } from '../geometry/types';
import type { AutoLayoutConfig, NodeId, SceneNode, ScenePage } from '../model/index';
import { childrenOf, isContainer } from '../model/index';

/** 参与排布的子项（尺寸来自节点现状；主轴 fill 的伸缩在 P0 不实现）。 */
export interface LayoutChild {
  id: NodeId;
  width: number;
  height: number;
}

/** 排布结果。 */
export interface LayoutResult {
  /** 子项新位置（相对容器左上角，即容器局部坐标）。 */
  positions: Record<NodeId, Point>;
  /** 子项新尺寸（仅填充/拉伸时给出）。 */
  sizes: Record<NodeId, Size>;
  /** 容器新尺寸（包裹模式时收窄/撑开）。 */
  frameSize: Size;
}

/** 容器的内容盒尺寸。 */
function contentSize(config: AutoLayoutConfig, frame: Size): Size {
  return {
    width: frame.width - config.padding.left - config.padding.right,
    height: frame.height - config.padding.top - config.padding.bottom,
  };
}

/** 主轴内容长度（子项 + 间距）。 */
function mainContentLength(config: AutoLayoutConfig, children: readonly LayoutChild[]): number {
  if (children.length === 0) return 0;
  const total = children.reduce(
    (sum, child) => sum + (config.direction === 'horizontal' ? child.width : child.height),
    0,
  );
  return total + config.spacing * (children.length - 1);
}

/** 交叉轴内容长度（子项最大值）。 */
function crossContentLength(config: AutoLayoutConfig, children: readonly LayoutChild[]): number {
  let max = 0;
  for (const child of children) {
    const value = config.direction === 'horizontal' ? child.height : child.width;
    if (value > max) max = value;
  }
  return max;
}

/**
 * 求解自动布局。
 * 尺寸模式：`hug` 时容器按内容收/放；`fixed` 时容器尺寸不变；子项的 `fill`（等同 stretch）
 * 在交叉轴上拉满。
 */
export function solveAutoLayout(
  config: AutoLayoutConfig,
  frame: Size,
  children: readonly LayoutChild[],
): LayoutResult {
  const horizontal = config.direction === 'horizontal';
  const _content = contentSize(config, frame);
  const mainContent = mainContentLength(config, children);
  const crossContent = crossContentLength(config, children);

  // 容器主/交叉尺寸：包裹模式按内容，固定模式保持
  const hugMain = horizontal ? config.widthSizing === 'hug' : config.heightSizing === 'hug';
  const hugCross = horizontal ? config.heightSizing === 'hug' : config.widthSizing === 'hug';
  const mainSize = hugMain
    ? mainContent +
      (horizontal
        ? config.padding.left + config.padding.right
        : config.padding.top + config.padding.bottom)
    : horizontal
      ? frame.width
      : frame.height;
  const crossSize = hugCross
    ? crossContent +
      (horizontal
        ? config.padding.top + config.padding.bottom
        : config.padding.left + config.padding.right)
    : horizontal
      ? frame.height
      : frame.width;

  const frameSize: Size = horizontal
    ? { width: mainSize, height: crossSize }
    : { width: crossSize, height: mainSize };
  const resolvedContent = contentSize(config, frameSize);

  // 主轴起点：主轴对齐（仅当容器比内容大时有意义）
  const leftover = Math.max(
    0,
    (horizontal ? resolvedContent.width : resolvedContent.height) - mainContent,
  );
  const alignOffset =
    config.primaryAxisAlign === 'center'
      ? leftover / 2
      : config.primaryAxisAlign === 'end'
        ? leftover
        : 0;

  const positions: Record<NodeId, Point> = {};
  const sizes: Record<NodeId, Size> = {};
  let cursor = (horizontal ? config.padding.left : config.padding.top) + alignOffset;

  for (const child of children) {
    const childMain = horizontal ? child.width : child.height;
    const counterContent = horizontal ? resolvedContent.height : resolvedContent.width;
    const childCross = horizontal ? child.height : child.width;
    const stretches = config.counterAxisAlign === 'stretch';

    let crossOffset = horizontal ? config.padding.top : config.padding.left;
    if (!stretches) {
      const slack = Math.max(0, counterContent - childCross);
      if (config.counterAxisAlign === 'center') crossOffset += slack / 2;
      if (config.counterAxisAlign === 'end') crossOffset += slack;
    }

    positions[child.id] = horizontal
      ? { x: cursor, y: crossOffset }
      : { x: crossOffset, y: cursor };

    if (config.counterAxisAlign === 'stretch' && childCross !== counterContent) {
      sizes[child.id] = horizontal
        ? { width: child.width, height: counterContent }
        : { width: counterContent, height: child.height };
    }
    cursor += childMain + config.spacing;
  }

  return { positions, sizes, frameSize };
}

/** 容器节点与其子项（只取真实节点）。 */
export function layoutInputs(
  page: ScenePage,
  frameId: NodeId,
): { config: AutoLayoutConfig; frame: SceneNode; children: LayoutChild[] } | null {
  const frame = page.nodes[frameId];
  if (!frame || !isContainer(frame)) return null;
  if (frame.type !== 'frame' || frame.autoLayout === null) return null;
  const children: LayoutChild[] = [];
  for (const childId of childrenOf(frame)) {
    const child = page.nodes[childId];
    if (!child?.visible) continue;
    children.push({ id: child.id, width: child.width, height: child.height });
  }
  return { config: frame.autoLayout, frame, children };
}

/** 自动布局命令：把求解结果落成属性写入（含容器包裹尺寸）。 */
export function autoLayoutCommands(
  page: ScenePage,
  pageId: import('../model/index').PageId,
  frameId: NodeId,
): Command[] {
  const inputs = layoutInputs(page, frameId);
  if (!inputs) return [];
  const { config, frame, children } = inputs;
  const result = solveAutoLayout(config, { width: frame.width, height: frame.height }, children);

  const commands: Command[] = [];
  for (const child of children) {
    const position = result.positions[child.id];
    const size = result.sizes[child.id];
    const node = page.nodes[child.id] as SceneNode;
    const patch: Record<string, number> = {};
    if (
      position &&
      (Math.abs(position.x - node.x) > 1e-6 || Math.abs(position.y - node.y) > 1e-6)
    ) {
      patch.x = position.x;
      patch.y = position.y;
    }
    if (
      size &&
      (Math.abs(size.width - node.width) > 1e-6 || Math.abs(size.height - node.height) > 1e-6)
    ) {
      patch.width = size.width;
      patch.height = size.height;
    }
    if (Object.keys(patch).length > 0) {
      commands.push({ type: 'node.update', pageId, nodeId: child.id, patch });
    }
  }

  if (
    Math.abs(result.frameSize.width - frame.width) > 1e-6 ||
    Math.abs(result.frameSize.height - frame.height) > 1e-6
  ) {
    commands.push({
      type: 'node.update',
      pageId,
      nodeId: frameId,
      patch: { width: result.frameSize.width, height: result.frameSize.height },
    });
  }
  return commands;
}

/** 包裹方向（Inspector 显示 hug 图标用）。 */
export function hugDirections(config: AutoLayoutConfig): { width: boolean; height: boolean } {
  return { width: config.widthSizing === 'hug', height: config.heightSizing === 'hug' };
}

/** 开启自动布局时的默认容器尺寸（包裹）。 */
export function initialLayoutSize(
  config: AutoLayoutConfig,
  children: readonly LayoutChild[],
): Size {
  const result = solveAutoLayout(config, { width: 0, height: 0 }, children);
  return result.frameSize;
}

/** 校验容器可参与自动布局（Inspector 用）。 */
export function canAutoLayout(page: ScenePage, frameId: NodeId): boolean {
  const node = page.nodes[frameId];
  return node !== undefined && node.type === 'frame';
}

/** 便捷：取容器当前自动布局配置（无则 null）。 */
export function autoLayoutOf(page: ScenePage, frameId: NodeId): AutoLayoutConfig | null {
  const node = page.nodes[frameId];
  if (node?.type !== 'frame') return null;
  return node.autoLayout;
}
