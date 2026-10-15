/**
 * `@dforge/engine/model` —— Design IR（文档模型）公开面。
 *
 * 子路径导出的意义：设计文档模型属**文档内核**，归 `@dforge/engine` 独占；
 * `@dforge/contracts` 只承载传输/API/市场/事件形状（文档载荷以 JSON opaque 承载），
 * 两端不互相依赖具体节点类型（见 briefs/_shared.md §2 裁决）。
 */

export type { DesignDocument, ScenePage } from './document';
export { createDocument, createPage } from './document';
export type { GridSettings, GridStyle } from './grid';
export { defaultGridSettings } from './grid';
export type { ComponentId, DocumentId, IdFactory, NodeId, PageId } from './ids';
export { createIdFactory, ID_PREFIX, systemIdFactory } from './ids';
export type {
  AutoLayoutConfig,
  AutoLayoutDirection,
  LayoutAlign,
  LayoutJustify,
  LayoutPadding,
  LayoutSizing,
} from './layout';
export { defaultAutoLayout, padding, paddingAlongAxis } from './layout';
export type {
  ComponentNode,
  ComponentSetNode,
  ContainerNode,
  EllipseNode,
  FrameNode,
  GroupNode,
  InstanceNode,
  NodeBase,
  NodeInit,
  NodePatch,
  PatchableKey,
  RectNode,
  SceneNode,
  SceneNodeType,
  TextNode,
} from './node';
export {
  childrenOf,
  createComponent,
  createComponentSet,
  createEllipse,
  createFrame,
  createGroup,
  createInstance,
  createRect,
  createText,
  isComponentNode,
  isContainer,
  isFrameNode,
  isGroupNode,
  isHittable,
  isInstanceNode,
  isTextNode,
  PATCHABLE_KEYS,
  pickPatch,
} from './node';
export type {
  ColorLiteral,
  Effect,
  GradientStop,
  LinearGradientPaint,
  Paint,
  SolidPaint,
  Stroke,
} from './paint';
export { dropShadow, isPaintVisible, paintKeyColor, solidPaint, strokeOf } from './paint';
export type { TextAlign, TextAutoResize, TextContent, TextSelection } from './text';
export {
  defaultTextContent,
  deleteTextRange,
  normalizeSelection,
  replaceTextRange,
} from './text';

export type { DesignToken, TokenGroup, TokenSet, TokenType, TokenValue } from './tokens';
export {
  aliasToken,
  emptyTokenSet,
  isDesignToken,
  parseAliasReference,
  token,
} from './tokens';
