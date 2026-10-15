'use client';

/**
 * MCP 确认条样式（内联样式对象；颜色/间距/圆角/字号一律取 `@dforge/ui` 令牌）。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const hairline = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 确认条样式。 */
export const mcpStyles = {
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    background: cssVar('color.surface-raised'),
    border: hairline,
    borderRadius: cssVar('radius-lg'),
    boxShadow: cssVar('shadow-md'),
    color: cssVar('color.text.primary'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
    maxWidth: cssVar('size-modal-md'),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  title: {
    fontSize: cssVar('font-size-13'),
    fontWeight: cssVar('font-weight-medium'),
  },
  /** 桩角标：AI 紫语义色（与 AI 族同源），全站唯一的「桩」标注样式。 */
  stubBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    height: cssVar('control-height-sm'),
    padding: `0 ${cssVar('space-2')}`,
    background: cssVar('color.component'),
    color: cssVar('color.on-primary'),
    borderRadius: cssVar('radius-pill'),
    fontSize: cssVar('font-size-11'),
    fontWeight: cssVar('font-weight-medium'),
    letterSpacing: cssVar('letter-spacing-wide'),
    cursor: 'help',
  },
  spacer: { flex: '1 1 auto' },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: cssVar('space-2'),
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
  metaItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: cssVar('space-1'),
  },
  tool: {
    fontFamily: cssVar('font.sans'),
    color: cssVar('color.text.primary'),
  },
  diffList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  diffRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-2'),
    background: cssVar('color.surface-subtle'),
    borderRadius: cssVar('radius-sm'),
  },
  diffHead: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  diffOp: {
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  },
  diffTarget: {
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
  diffSummary: {
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  countdown: {
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
  },
  result: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-2'),
    background: cssVar('color-success-subtle'),
    borderRadius: cssVar('radius-sm'),
    fontSize: cssVar('font-size-12'),
  },
  expired: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-2'),
    background: cssVar('color-warning-subtle'),
    borderRadius: cssVar('radius-sm'),
    fontSize: cssVar('font-size-12'),
  },
  failure: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-2'),
    background: cssVar('color-danger-subtle'),
    borderRadius: cssVar('radius-sm'),
    fontSize: cssVar('font-size-12'),
  },
  stubNote: {
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
} satisfies Record<string, CSSProperties>;
