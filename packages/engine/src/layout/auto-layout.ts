/**
 * 自动布局（子集）：轴向堆叠 + 间距 + 内边距 + 主轴对齐 + 交叉轴对齐 + 尺寸模式（固定/包裹/填充）。
 *
 * 两遍求解（架构 v1.1 §4.1「测量 → 排布」）：先量出内容尺寸，再决定容器包裹尺寸与排布起点。
 * `autoLayoutCommands` 把结果翻译成命令（只产出**变化**的属性，避免无意义的历史条目）。
 *
 * 负尺寸钳制（修复批次 3 · A3）：交叉轴 `stretch` 的内容长度可能为负——容器比 padding 之和
 * 还小时（`frame.height - padding.top - padding.bottom < 0`），子项会被"拉伸"到负高度。
 * 负宽高不是合法几何（经 `autoLayoutCommands` 写进文档后会污染命中、包围盒与选择框），
 * 故一律**钳制到 ≥ 0**。为什么选择钳制而不是报错：padding（以及容器尺寸）是 Inspector 上
 * 连续调节的量，中间态报错会打断拖拽式交互；钳制结果确定且幂等（把 0 当输入再求解仍是 0），
 * 与「主轴对齐余量取 max(0)」是同一口径。注意：容器 `hug` 主尺寸在负 padding 下仍可能为负
 * （另一处已记录行为，不在本次钳制范围）。
 *
 * 主轴 fill 伸缩（工单 11 · ADR-0005 预声明例外：能力补齐、架构结构不动）：
 * 声明了 `mainSizing: 'fill'` 的子项按主轴剩余空间分配尺寸（替换内禀尺寸，可增可减），
 * 语义对齐 Figma——
 * - 可分配量 = 主轴内容盒 − 固定子项主尺寸之和 − 间距总量；fill 子项先得均份；
 * - `mainMin`/`mainMax` 是水位上下界：触界者按界值退出均摊，余量在其余 fill 子项间
 *   重分配（水位法，见 `distributeFill`）；fill 全部封顶后剩下的余量走主轴对齐
 *   （`primaryAxisAlign`），与「无 fill 时对齐吃掉全部余量」是同一条路径；
 * - 容器主轴为包裹（hug）时 fill **不可用**（Figma 同轴 hug 下 fill 选项不可选）：
 *   子项保持内禀尺寸参与包裹计算；
 * - 可分配量为负：无 `mainMin` 者钳到 0（上面同一条负尺寸契约），有 `mainMin` 者保 min
 *   （min 是硬下界，容器溢出——沿用主轴溢出不裁剪的既有语义）；
 * - 文档侧声明来源：Design IR 没有独立的 per-child 尺寸字段（格式不变、`$version` 不动），
 *   子项是画板且自身 `autoLayout` 沿**父主轴**声明了 fill（`widthSizing`/`heightSizing`）
 *   即视为 fill——`layoutInputs` 负责派生；纯求解调用方可直接在 `LayoutChild` 上声明
 *   （未来 Inspector 的手动 fill 与 min/max 走这条路）。
 */

import type { Command } from '../commands/types';
import type { Point, Size } from '../geometry/types';
import type { AutoLayoutConfig, NodeId, SceneNode, ScenePage } from '../model/index';
import { childrenOf, isContainer } from '../model/index';

/** 参与排布的子项（尺寸来自节点现状；`mainSizing: 'fill'` 声明主轴伸缩，见模块头）。 */
export interface LayoutChild {
  id: NodeId;
  width: number;
  height: number;
  /**
   * 子项沿容器主轴的尺寸模式：缺省按 'fixed'（主尺寸取内禀 width/height）；
   * 'fill' 时主尺寸由剩余空间分配决定（替换内禀尺寸，可增可减）。
   * 交叉轴不受此字段影响——交叉轴拉伸仍由容器 `counterAxisAlign: 'stretch'` 统一驱动。
   */
  mainSizing?: 'fixed' | 'fill';
  /** 主轴伸缩下限（fill 分配的水位下界；缺省 0，负值按 0 处理）。 */
  mainMin?: number;
  /** 主轴伸缩上限（fill 分配的水位上界；缺省无上限）。 */
  mainMax?: number;
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

/** fill 参与者：子项下标 + 归一后的水位上下界（min ≥ 0、max ≥ min，非法区间 min 胜出）。 */
interface FillParticipant {
  index: number;
  min: number;
  max: number;
}

/** 提取主轴 fill 参与者（其余子项按内禀尺寸参与排布）。 */
function fillParticipants(children: readonly LayoutChild[]): FillParticipant[] {
  const participants: FillParticipant[] = [];
  for (const [index, child] of children.entries()) {
    if (child.mainSizing !== 'fill') continue;
    const min = Math.max(0, child.mainMin ?? 0);
    const max = Math.max(min, child.mainMax ?? Number.POSITIVE_INFINITY);
    participants.push({ index, min, max });
  }
  return participants;
}

/**
 * 主轴剩余空间的水位分配（对齐 Figma fill 语义，见模块头）。
 *
 * 每个参与者先得均份；触到 min/max 者按界值退出，余量在其余参与者间再均摊，直至稳定。
 * 可分配量为负：无 min 者得 0（负尺寸契约），有 min 者保 min（min 硬下界，容器溢出）。
 * 返回「子项下标 → 分配尺寸」（每个参与者必有条目）。
 * 终止性：每轮至少剔除一个触界者，轮数 ≤ 参与者数。NaN 入参按既有口径透传
 * （比较全为 false → 均份 NaN 直接分配，与 `mainContentLength` 的 NaN 行为一致）。
 */
function distributeFill(
  pool: number,
  participants: readonly FillParticipant[],
): Map<number, number> {
  const shares = new Map<number, number>();
  const active = [...participants];
  let remaining = pool;
  while (active.length > 0) {
    const share = remaining / active.length;
    const clamped = active.filter((p) => share < p.min || share > p.max);
    if (clamped.length === 0) {
      for (const p of active) shares.set(p.index, share);
      break;
    }
    for (const p of clamped) {
      const bounded = share < p.min ? p.min : p.max;
      shares.set(p.index, bounded);
      remaining -= bounded;
    }
    // 触界者退出均摊（clamped 的元素就是 active 的成员，按引用剔除）
    for (const p of clamped) {
      const at = active.indexOf(p);
      if (at >= 0) active.splice(at, 1);
    }
  }
  return shares;
}

/**
 * 求解自动布局。
 * 尺寸模式：`hug` 时容器按内容收/放；`fixed` 时容器尺寸不变；子项的 `fill`（等同 stretch）
 * 在交叉轴上拉满；子项 `mainSizing: 'fill'` 沿主轴分摊剩余空间（见模块头）。
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

  // 主轴 fill 伸缩（工单 11）：容器主轴为包裹时 fill 不可用（对齐 Figma），保持内禀尺寸；
  // 否则 fill 子项分摊「内容盒 − 固定项 − 间距」，分配值替换内禀值。
  const participants = hugMain ? [] : fillParticipants(children);
  const fillIndexes = new Set(participants.map((p) => p.index));
  const gapTotal = config.spacing * (children.length - 1);
  let fixedTotal = 0;
  for (const [index, child] of children.entries()) {
    if (!fillIndexes.has(index)) fixedTotal += horizontal ? child.width : child.height;
  }
  const fillShares =
    participants.length === 0
      ? new Map<number, number>()
      : distributeFill(
          (horizontal ? resolvedContent.width : resolvedContent.height) - fixedTotal - gapTotal,
          participants,
        );
  let fillTotal = 0;
  for (const share of fillShares.values()) fillTotal += share;

  // 主轴起点：主轴对齐（仅当容器比内容大时有意义）。
  // 有 fill 时按分配后的内容长度算余量——正常分配恰好吃满（余量 0），
  // fill 被 max 封顶时剩下的余量仍走对齐（对齐 Figma）。
  // 无 fill 时直接用 mainContentLength 的原式，保证既有路径逐位一致（回归护栏）。
  const solvedMainContent =
    participants.length === 0 ? mainContent : fixedTotal + fillTotal + gapTotal;
  const leftover = Math.max(
    0,
    (horizontal ? resolvedContent.width : resolvedContent.height) - solvedMainContent,
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

  for (const [index, child] of children.entries()) {
    const intrinsicMain = horizontal ? child.width : child.height;
    const childMain = fillShares.get(index) ?? intrinsicMain;
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

    // 交叉轴内容为负（容器小于 padding）→ 钳制到 0（见模块头：负尺寸不是合法几何）
    const stretchedCross =
      stretches && childCross !== counterContent ? Math.max(0, counterContent) : null;
    // sizes 只在「分配值 ≠ 内禀」或「交叉轴拉伸」时给出（与既有 sizes 口径一致：只写变化）
    if (childMain !== intrinsicMain || stretchedCross !== null) {
      sizes[child.id] = horizontal
        ? { width: childMain, height: stretchedCross ?? child.height }
        : { width: stretchedCross ?? child.width, height: childMain };
    }
    cursor += childMain + config.spacing;
  }

  return { positions, sizes, frameSize };
}

/**
 * 从子节点派生主轴 fill 声明（无声明返回 null）。
 *
 * Design IR 没有独立的 per-child 尺寸字段（格式不变、`$version` 不动），Figma 里
 * 「子项 Fill」的承载落在**子画板自身**的 `autoLayout` sizing 上：沿父主轴声明了
 * fill（父水平看 `widthSizing`、父垂直看 `heightSizing`）即视为 fill。
 * 非画板子项 / 未开启自动布局的画板 → fixed。沿父**交叉轴**声明的 fill 不在此派生
 * （交叉轴拉伸仍由容器 `counterAxisAlign: 'stretch'` 统一驱动，P0 不做逐项交叉 fill）。
 */
function fillDeclarationOf(
  node: SceneNode,
  parentHorizontal: boolean,
): { mainSizing: 'fill' } | null {
  if (node.type !== 'frame' || node.autoLayout === null) return null;
  const fills = parentHorizontal
    ? node.autoLayout.widthSizing === 'fill'
    : node.autoLayout.heightSizing === 'fill';
  return fills ? { mainSizing: 'fill' } : null;
}

/** 容器节点与其子项（只取真实节点）。 */
export function layoutInputs(
  page: ScenePage,
  frameId: NodeId,
): { config: AutoLayoutConfig; frame: SceneNode; children: LayoutChild[] } | null {
  const frame = page.nodes[frameId];
  if (!frame || !isContainer(frame)) return null;
  if (frame.type !== 'frame' || frame.autoLayout === null) return null;
  const horizontal = frame.autoLayout.direction === 'horizontal';
  const children: LayoutChild[] = [];
  for (const childId of childrenOf(frame)) {
    const child = page.nodes[childId];
    if (!child?.visible) continue;
    children.push({
      id: child.id,
      width: child.width,
      height: child.height,
      ...fillDeclarationOf(child, horizontal),
    });
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
