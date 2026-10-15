/**
 * 场景节点类型（Design IR 的核心）。
 *
 * 设计取舍（对应架构 v1.1 §4.1「扁平化存储」）：
 * - 节点是**纯数据**（无类、无方法、无父指针），便于 JSON 往返与结构共享式不可变更新；
 * - 父子关系只由容器的 `children: NodeId[]` 表达，父指针由 `scene/` 索引查询得到；
 * - 坐标 (x, y) 一律相对**父容器**（顶层节点相对页面原点），`rotation` 为绕自身中心的角度（度）；
 * - 实例（instance）**不复制子树**：它只持有 `componentId` + 覆盖表，
 *   其「子节点」是解析出来的虚节点（见 `scene/instance.ts`）。
 */

import type { ComponentId, NodeId } from './ids';
import type { AutoLayoutConfig } from './layout';
import type { Effect, Paint, Stroke } from './paint';
import { solidPaint } from './paint';
import type { TextContent } from './text';
import { defaultTextContent } from './text';

/** 节点类型判别符。 */
export type SceneNodeType =
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'frame'
  | 'group'
  | 'component'
  | 'component_set'
  | 'instance';

/** 所有节点共有的几何与外观属性。 */
export interface NodeBase {
  id: NodeId;
  name: string;
  /** 相对父容器的左上角 X（未旋转坐标系）。 */
  x: number;
  /** 相对父容器的左上角 Y（未旋转坐标系）。 */
  y: number;
  width: number;
  height: number;
  /** 绕自身中心旋转的角度（度，顺时针为正）。 */
  rotation: number;
  visible: boolean;
  locked: boolean;
  /** 0–1。 */
  opacity: number;
  fills: readonly Paint[];
  strokes: readonly Stroke[];
  effects: readonly Effect[];
  /** 四角统一圆角；P0 不做四角独立。 */
  cornerRadius: number;
}

/** 矩形。 */
export interface RectNode extends NodeBase {
  type: 'rect';
}

/** 椭圆（width/height 即包围盒）。 */
export interface EllipseNode extends NodeBase {
  type: 'ellipse';
}

/** 文本。 */
export interface TextNode extends NodeBase {
  type: 'text';
  text: TextContent;
}

/** 画板（可裁剪，可挂自动布局）。 */
export interface FrameNode extends NodeBase {
  type: 'frame';
  children: NodeId[];
  clipsContent: boolean;
  autoLayout: AutoLayoutConfig | null;
}

/** 编组（编组本身不可见、不可命中，命中落在其子节点上）。 */
export interface GroupNode extends NodeBase {
  type: 'group';
  children: NodeId[];
}

/** 主组件（C17：主 ↔ 实例）。 */
export interface ComponentNode extends NodeBase {
  type: 'component';
  children: NodeId[];
  /** 变体属性（如 `{ size: 'large', state: 'hover' }`）；非变体组件为 null。 */
  variantProperties: Record<string, string> | null;
  /** 所属组件集（变体集）；独立主组件为 null。 */
  componentSetId: ComponentId | null;
}

/** 组件集（其 children 为若干变体主组件）。 */
export interface ComponentSetNode extends NodeBase {
  type: 'component_set';
  children: NodeId[];
}

/**
 * 实例。子节点由主组件解析得到（虚节点），不落盘：
 * 覆盖表键 = 从实例向下的**路径**（主组件内节点 id 用 `/` 连接）。
 */
export interface InstanceNode extends NodeBase {
  type: 'instance';
  componentId: ComponentId;
  overrides: Record<string, NodePatch>;
}

/** 场景节点联合。 */
export type SceneNode =
  | RectNode
  | EllipseNode
  | TextNode
  | FrameNode
  | GroupNode
  | ComponentNode
  | ComponentSetNode
  | InstanceNode;

/** 拥有真实子节点列表的容器（实例除外——它的子是虚节点）。 */
export type ContainerNode = FrameNode | GroupNode | ComponentNode | ComponentSetNode;

/**
 * 节点属性补丁（命令栈 `node.update` 的载荷 / 实例覆盖表的载荷）。
 * 仅收录可写的标量属性；结构性属性（type/children/componentId）走专用命令。
 */
export interface NodePatch {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  fills?: readonly Paint[];
  strokes?: readonly Stroke[];
  effects?: readonly Effect[];
  cornerRadius?: number;
  text?: TextContent;
  clipsContent?: boolean;
  autoLayout?: AutoLayoutConfig | null;
  variantProperties?: Record<string, string> | null;
}

/** 构造节点时的通用入参（未给的一律取默认值）。 */
export interface NodeInit {
  id: NodeId;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  fills?: readonly Paint[];
  strokes?: readonly Stroke[];
  effects?: readonly Effect[];
  cornerRadius?: number;
}

/**
 * 默认节点名。
 * 注意：节点名是**文档数据**（用户可改、随文档保存），不是界面文案——
 * 界面文案一律走 i18n（zh-CN 唯一暴露），此处取与产品语言一致的中文默认名。
 */
const DEFAULT_NAMES: Record<SceneNodeType, string> = {
  rect: '矩形',
  ellipse: '椭圆',
  text: '文本',
  frame: '画板',
  group: '编组',
  component: '组件',
  component_set: '组件集',
  instance: '实例',
};

/** 默认填充（对齐 Figma 基础形状默认值）。 */
function defaultFillFor(type: SceneNodeType): readonly Paint[] {
  switch (type) {
    case 'frame':
      return [solidPaint('#FFFFFF')];
    case 'group':
    case 'component_set':
      return [];
    case 'text':
      return [solidPaint('#000000')];
    default:
      return [solidPaint('#D9D9D9')];
  }
}

/** 由通用入参装配 NodeBase（其余节点构造函数复用）。 */
function baseNode(type: SceneNodeType, init: NodeInit): NodeBase {
  return {
    id: init.id,
    name: init.name ?? DEFAULT_NAMES[type],
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? 100,
    height: init.height ?? 100,
    rotation: init.rotation ?? 0,
    visible: init.visible ?? true,
    locked: init.locked ?? false,
    opacity: init.opacity ?? 1,
    fills: init.fills ?? defaultFillFor(type),
    strokes: init.strokes ?? [],
    effects: init.effects ?? [],
    cornerRadius: init.cornerRadius ?? 0,
  };
}

/** 构造矩形。 */
export function createRect(init: NodeInit): RectNode {
  return { ...baseNode('rect', init), type: 'rect' };
}

/** 构造椭圆。 */
export function createEllipse(init: NodeInit): EllipseNode {
  return { ...baseNode('ellipse', init), type: 'ellipse' };
}

/** 构造文本（未给内容时用空串 + 默认排版）。 */
export function createText(init: NodeInit & { text?: TextContent }): TextNode {
  return {
    ...baseNode('text', init),
    type: 'text',
    text: init.text ?? defaultTextContent(),
  };
}

/** 构造画板。 */
export function createFrame(
  init: NodeInit & {
    children?: NodeId[];
    clipsContent?: boolean;
    autoLayout?: AutoLayoutConfig | null;
  },
): FrameNode {
  return {
    ...baseNode('frame', init),
    type: 'frame',
    children: init.children ?? [],
    clipsContent: init.clipsContent ?? true,
    autoLayout: init.autoLayout ?? null,
  };
}

/** 构造编组。 */
export function createGroup(init: NodeInit & { children?: NodeId[] }): GroupNode {
  return { ...baseNode('group', init), type: 'group', children: init.children ?? [] };
}

/** 构造主组件。 */
export function createComponent(
  init: NodeInit & {
    children?: NodeId[];
    variantProperties?: Record<string, string> | null;
    componentSetId?: ComponentId | null;
  },
): ComponentNode {
  return {
    ...baseNode('component', init),
    type: 'component',
    children: init.children ?? [],
    variantProperties: init.variantProperties ?? null,
    componentSetId: init.componentSetId ?? null,
  };
}

/** 构造组件集。 */
export function createComponentSet(init: NodeInit & { children?: NodeId[] }): ComponentSetNode {
  return {
    ...baseNode('component_set', init),
    type: 'component_set',
    children: init.children ?? [],
  };
}

/** 构造实例。 */
export function createInstance(
  init: NodeInit & { componentId: ComponentId; overrides?: Record<string, NodePatch> },
): InstanceNode {
  return {
    ...baseNode('instance', init),
    type: 'instance',
    componentId: init.componentId,
    overrides: init.overrides ?? {},
  };
}

/** 是否容器（有真实 children）。 */
export function isContainer(node: SceneNode): node is ContainerNode {
  return (
    node.type === 'frame' ||
    node.type === 'group' ||
    node.type === 'component' ||
    node.type === 'component_set'
  );
}

/** 是否实例。 */
export function isInstanceNode(node: SceneNode): node is InstanceNode {
  return node.type === 'instance';
}

/** 是否主组件。 */
export function isComponentNode(node: SceneNode): node is ComponentNode {
  return node.type === 'component';
}

/** 是否文本。 */
export function isTextNode(node: SceneNode): node is TextNode {
  return node.type === 'text';
}

/** 是否画板。 */
export function isFrameNode(node: SceneNode): node is FrameNode {
  return node.type === 'frame';
}

/** 是否编组。 */
export function isGroupNode(node: SceneNode): node is GroupNode {
  return node.type === 'group';
}

/** 是否可命中（编组本身不参与命中）。 */
export function isHittable(node: SceneNode): boolean {
  return node.type !== 'group';
}

/** 取节点所有可写属性键（用于差异比较与补丁提取）。 */
export const PATCHABLE_KEYS = [
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'visible',
  'locked',
  'opacity',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'text',
  'clipsContent',
  'autoLayout',
  'variantProperties',
] as const satisfies readonly (keyof NodePatch)[];

/** 补丁属性键类型。 */
export type PatchableKey = (typeof PATCHABLE_KEYS)[number];

/** 从节点提取指定键的补丁（撤销用：先取旧值，再写新值）。 */
export function pickPatch(node: SceneNode, keys: readonly PatchableKey[]): NodePatch {
  const patch: Record<string, unknown> = {};
  const source = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (Object.hasOwn(node, key)) {
      patch[key] = source[key];
    }
  }
  return patch as NodePatch;
}
