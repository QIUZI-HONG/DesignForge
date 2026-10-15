'use client';

/**
 * 面板共享样式（内联样式对象，全部取 `@dforge/ui` 令牌变量）。
 *
 * 为什么不写 CSS 文件：与 `/_design` 预览页（FE-01）同一口径——样式对象随组件走，
 * 令牌引用在 TS 里可见（`guard-tokens` 的禁裸值检查能逐行兜住），且 jsdom 测试能直接读 `style`。
 * 几何计算（如缩进 = 4 + 12 × 深度）显式写出算式，单位仍来自令牌。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const border = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 面板外框（深色编辑器族下取面板底与描边令牌：surface / border）。 */
export const panelStyles = {
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
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    borderBottom: border,
  },
  headerTitle: {
    fontSize: cssVar('font-size-13'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  },
  headerSpacer: { flex: '1 1 auto' },
  body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', position: 'relative' },
} satisfies Record<string, CSSProperties>;

/** 图层行的样式。 */
export const layerRowStyles = {
  row: {
    display: 'grid',
    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: cssVar('space-1'),
    height: cssVar('row-height-md'),
    paddingRight: cssVar('space-1'),
    // 缩进 12/级 + 基准 4（清单 C3）；单位来自令牌，倍数由深度给出
    paddingLeft: `calc(${cssVar('space-1')} + ${cssVar('space-3')} * var(--dfg-layer-depth))`,
    borderRadius: cssVar('radius-sm'),
    cursor: 'default',
    userSelect: 'none',
    // 长列表（>200 节点）用 content-visibility 跳过屏外行的渲染（不引重依赖）
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${cssVar('row-height-md')}`,
    position: 'relative',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
  },
  input: {
    width: '100%',
    minWidth: 0,
    height: cssVar('control-height-sm'),
    paddingInline: cssVar('space-1'),
    font: 'inherit',
    color: cssVar('color.text.primary'),
    background: cssVar('color.surface-raised'),
    border,
    borderRadius: cssVar('radius-sm'),
  },
  indicatorTop: {
    position: 'absolute',
    insetInline: 0,
    top: 0,
    height: cssVar('border-width-thick'),
    background: cssVar('color.primary'),
  },
  indicatorBottom: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    height: cssVar('border-width-thick'),
    background: cssVar('color.primary'),
  },
} satisfies Record<string, CSSProperties>;

/** 选中/悬停/聚焦的底色（按状态合并到行样式上）。 */
export const layerRowStateStyles = {
  hover: { background: cssVar('color.hover') },
  selected: {
    background: cssVar('color.selection'),
    color: cssVar('color.selection-text'),
  },
  focusRing: {
    outline: `${cssVar('border-width-focus')} solid ${cssVar('color.focus-ring')}`,
    outlineOffset: '0',
  },
  inside: {
    outline: `${cssVar('border-width-thick')} solid ${cssVar('color.primary')}`,
    outlineOffset: `calc(${cssVar('border-width-thick')} * -1)`,
  },
  dimmed: { opacity: '0.5' },
} satisfies Record<string, CSSProperties>;

/** 资产面板样式。 */
export const assetStyles = {
  toolbar: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    borderBottom: border,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-1'),
    textAlign: 'left',
    background: cssVar('color.surface'),
    border,
    borderRadius: cssVar('radius-md'),
    cursor: 'pointer',
  },
  cardSelected: {
    borderColor: cssVar('color.primary'),
  },
  thumb: {
    display: 'grid',
    placeItems: 'center',
    aspectRatio: '3 / 2',
    background: cssVar('color.surface-raised'),
    borderRadius: cssVar('radius-sm'),
    color: cssVar('color.component'),
  },
  cardName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.primary'),
  },
  cardMeta: { fontSize: cssVar('font-size-11'), color: cssVar('color.text-secondary') },
  tokenGroup: {
    padding: `${cssVar('space-2')} ${cssVar('space-3')} 0`,
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text-secondary'),
    textTransform: 'none',
  },
  tokenRow: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    minHeight: cssVar('row-height-md'),
    paddingInline: cssVar('space-3'),
  },
  swatch: {
    flex: '0 0 auto',
    width: cssVar('icon-size-md'),
    height: cssVar('icon-size-md'),
    borderRadius: cssVar('radius-sm'),
    border,
  },
  tokenName: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: cssVar('font-size-12'),
  },
  tokenValue: {
    flex: '0 0 auto',
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text-secondary'),
  },
} satisfies Record<string, CSSProperties>;
