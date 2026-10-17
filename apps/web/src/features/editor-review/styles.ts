'use client';

/**
 * 评论 / Present / 版本共享样式（内联样式对象，全部取 `@dforge/ui` 令牌变量）。
 *
 * 与 FE-04 面板同一口径（`editor-panels/components/styles.ts`）：样式对象随组件走，
 * 令牌引用在 TS 里可见（`guard-tokens` 的禁裸值检查逐行兜住），jsdom 测试能直接读 `style`。
 * 几何计算（钉点屏幕位置 = 世界坐标 × zoom + pan）显式写出，单位仍来自令牌/计算值。
 *
 * 主题：全部走**深色编辑器族**令牌（画布/面板/描边）；Present 的舞台底是克制的近黑，
 * 用 `color.canvas` 的深色值并叠一层不透明的暗化由 Present 自己声明（见 `present/`）。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const border = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 文本/面板通用。 */
export const reviewStyles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: cssVar('size.sidebar'),
    height: '100%',
    minHeight: 0,
    background: cssVar('color.surface'),
    borderInline: border,
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
  } as CSSProperties,
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    borderBottom: border,
  } as CSSProperties,
  panelTitle: {
    fontSize: cssVar('font-size-13'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  } as CSSProperties,
  body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } as CSSProperties,
  meta: {
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  } as CSSProperties,
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-6')} ${cssVar('space-3')}`,
    textAlign: 'center',
  } as CSSProperties,
  emptyTitle: {
    fontSize: cssVar('font-size-13'),
    color: cssVar('color.text.primary'),
  } as CSSProperties,
  emptyDesc: {
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.secondary'),
  } as CSSProperties,
  /** 文本域（评论/回复共用；深度 4 行高由 token 最小高度给出）。 */
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: cssVar('size.textarea-min-height'),
    resize: 'none',
    padding: cssVar('space-2'),
    borderRadius: cssVar('radius-md'),
    border,
    background: cssVar('color.surfaceSubtle'),
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
  } as CSSProperties,
  buttonRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: cssVar('space-2'),
  } as CSSProperties,
  error: { color: cssVar('color.danger'), fontSize: cssVar('font-size-11') } as CSSProperties,
  /** 列表重置（ul/li 不显标记与缩进）——评论/版本列表共用。 */
  listReset: { listStyle: 'none', margin: 0, padding: 0 } as CSSProperties,
} satisfies Record<string, CSSProperties>;

/** 评论层与钉点。 */
export const commentStyles = {
  /** 覆盖层：铺满画布视口，默认不吃指针事件（只有钉点/草稿卡片吃）。 */
  layer: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  } as CSSProperties,
  /**
   * 落点按钮：铺满视口的透明控件（评论模式下才渲染；键盘等价路径见组件头注释）。
   *
   * `pointerEvents: auto` 是必需的：覆盖层根节点是 `none`（不吃画布事件），
   * 只靠继承的话落点按钮在**真浏览器**里点不到（jsdom 不算 pointer-events，
   * 这正是「组件测试绿、门禁红」的那类差异——由 verify-figma-review 的交互断言兜住）。
   */
  surface: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'crosshair',
    pointerEvents: 'auto',
  } as CSSProperties,
  pin: {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: cssVar('icon-size-lg'),
    height: cssVar('icon-size-lg'),
    // 钉点锚点 = 世界坐标点：视觉中心对齐锚点（几何换算，非样式裸值）
    transform: 'translate(-50%, -50%)',
    borderRadius: cssVar('radius-pill'),
    border: 'none',
    background: cssVar('color.primary'),
    color: cssVar('color.onPrimary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-11'),
    fontWeight: cssVar('font-weight-medium'),
    cursor: 'pointer',
    pointerEvents: 'auto',
  } as CSSProperties,
  pinResolved: { background: cssVar('color.success') } as CSSProperties,
  pinActive: {
    boxShadow: `0 0 0 ${cssVar('border-width.thick')} ${cssVar('color.focusRing')}`,
  } as CSSProperties,
  /** 悬停展开的预览卡（钉点右下方）。 */
  hoverCard: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    minWidth: cssVar('size.menu-min-width'),
    maxWidth: cssVar('size.tooltip-max-width'),
    padding: cssVar('space-2'),
    borderRadius: cssVar('radius-md'),
    border,
    background: cssVar('color.surfaceRaised'),
    boxShadow: cssVar('shadow-popover'),
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    pointerEvents: 'none',
  } as CSSProperties,
  /** 草稿卡片（新评论落点处）。 */
  draft: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    width: cssVar('size.sidebar'),
    padding: cssVar('space-2'),
    borderRadius: cssVar('radius-md'),
    border,
    background: cssVar('color.surfaceRaised'),
    boxShadow: cssVar('shadow-popover'),
    pointerEvents: 'auto',
  } as CSSProperties,
  /** 线程面板条目。 */
  thread: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    borderBottom: border,
    cursor: 'default',
  } as CSSProperties,
  threadActive: { background: cssVar('color.hover') } as CSSProperties,
  /** 条目行内动作区（已解决条目的显式「重新打开」入口；行内右对齐、始终可见）。 */
  rowActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: `0 ${cssVar('space-3')} ${cssVar('space-2')}`,
  } as CSSProperties,
  threadHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: cssVar('space-2'),
  } as CSSProperties,
  author: {
    fontWeight: cssVar('font-weight-medium'),
    fontSize: cssVar('font-size-12'),
  } as CSSProperties,
  body: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as CSSProperties,
  reply: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    paddingLeft: cssVar('space-3'),
    borderLeft: `${cssVar('border-width.thick')} solid ${cssVar('color.border')}`,
  } as CSSProperties,
  /** 线程展开区（回复列表 + 输入 + 操作）。 */
  threadDetail: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: `0 ${cssVar('space-3')} ${cssVar('space-3')}`,
  } as CSSProperties,
  /** 列表重置（ul/li 不显标记与缩进）。 */
  listReset: { listStyle: 'none', margin: 0, padding: 0 } as CSSProperties,
  /** 线程条目的整行按钮（内容由条目自身排版，这里只做重置）。
   *
   * 原生 `<button>` 不吃父级文本样式：不显式声明 `color` / `font` 时浏览器用默认黑字，
   * 叠在深色面板上只剩时间可见（DEF-03）。作者/正文跟随按钮前景色，时间仍走 meta 次级色。
   */
  threadToggle: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    color: cssVar('color.text.primary'),
    font: 'inherit',
  } as CSSProperties,
  /** 回复条目（作者行 + 正文纵向排列）。 */
  replyItem: { display: 'flex', flexDirection: 'column' } as CSSProperties,
  sectionToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    border: 'none',
    borderTop: border,
    background: 'transparent',
    color: cssVar('color.text.secondary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-11'),
    textAlign: 'left',
    cursor: 'pointer',
  } as CSSProperties,
  /** 模式开关（顶栏/工具栏插槽用）。 */
  modeToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: cssVar('icon-gap'),
    height: cssVar('control-height-md'),
    paddingInline: cssVar('control-padding-x-md'),
    borderRadius: cssVar('radius-md'),
    border,
    background: 'transparent',
    color: cssVar('color.text.secondary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    cursor: 'pointer',
  } as CSSProperties,
  modeToggleOn: {
    background: cssVar('color.primary'),
    borderColor: cssVar('color.primary'),
    color: cssVar('color.onPrimary'),
  } as CSSProperties,
} satisfies Record<string, CSSProperties>;

/** 版本历史（抽屉列表 + 并排对比浮层）。 */
export const versionStyles = {
  drawerBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
  } as CSSProperties,
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: `${cssVar('space-2')} 0`,
    borderBottom: border,
  } as CSSProperties,
  rowHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: cssVar('space-2'),
  } as CSSProperties,
  rowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  } as CSSProperties,
  /**
   * 并排对比浮层的内容容器（铺满视口；两栏才是真的「并排」）。
   *
   * 定位与 z 序**归 `@dforge/ui` 的 `Overlay`**（浮层栈内同源推导，见 C1/D-4 修复）：
   * 这里只说「内容如何排布」，不再自持 `position: fixed` / `z-index` 令牌——
   * 自持会与栈序脱钩（本模块的历史缺陷正是二者同值、层序却被 portal 的挂载先后决定）。
   */
  overlay: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-3'),
    padding: cssVar('space-4'),
    background: cssVar('color.surface'),
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    overflowY: 'auto',
  } as CSSProperties,
  overlayHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: cssVar('space-3'),
  } as CSSProperties,
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: cssVar('space-3'),
    flex: '1 1 auto',
    minHeight: 0,
  } as CSSProperties,
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    borderRadius: cssVar('radius-lg'),
    border,
    background: cssVar('color.surfaceSubtle'),
    minHeight: 0,
  } as CSSProperties,
  columnHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: cssVar('space-2'),
  } as CSSProperties,
  columnPreview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
  } as CSSProperties,
  diffPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-3'),
    borderRadius: cssVar('radius-lg'),
    border,
    background: cssVar('color.surfaceRaised'),
  } as CSSProperties,
  diffRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: cssVar('space-3'),
    paddingBlock: cssVar('space-1'),
  } as CSSProperties,
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: cssVar('space-2'),
  } as CSSProperties,
  confirmHint: { flex: '1 1 auto', color: cssVar('color.text.secondary') } as CSSProperties,
} satisfies Record<string, CSSProperties>;
