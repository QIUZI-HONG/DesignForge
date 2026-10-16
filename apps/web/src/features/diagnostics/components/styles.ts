'use client';

/**
 * 诊断面板样式（内联样式对象；颜色/间距/圆角/字号一律取 `@dforge/ui` 令牌）。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const hairline = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 面板内容区样式。 */
export const diagnosticsStyles = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-3'),
  },
  errorBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    background: cssVar('color.danger-subtle'),
    borderRadius: cssVar('radius-md'),
  },
  errorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    fontSize: cssVar('font-size-13'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  },
  errorDesc: {
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.secondary'),
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  sectionTitle: {
    fontSize: cssVar('font-size-12'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.secondary'),
  },
  rowList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: cssVar('space-2'),
    minHeight: cssVar('row-height-md'),
  },
  rowLabel: {
    minWidth: cssVar('space-16'),
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.secondary'),
  },
  rowValue: {
    flex: '1 1 auto',
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.primary'),
    wordBreak: 'break-word',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    padding: cssVar('space-2'),
    background: cssVar('color.surface-subtle'),
    borderRadius: cssVar('radius-md'),
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  itemLabel: {
    fontSize: cssVar('font-size-12'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  },
  statusChip: {
    fontSize: cssVar('font-size-11'),
    padding: `0 ${cssVar('space-2')}`,
    borderRadius: cssVar('radius-pill'),
    lineHeight: cssVar('line-height-relaxed'),
  },
  itemDetail: {
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
    wordBreak: 'break-word',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    height: cssVar('control-height-sm'),
    padding: `0 ${cssVar('space-2')}`,
    border: hairline,
    borderRadius: cssVar('radius-pill'),
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
  logList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: cssVar('space-2'),
    listStyle: 'none',
    background: cssVar('color.surface-subtle'),
    borderRadius: cssVar('radius-md'),
  },
  logLine: {
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.primary'),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  muted: {
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.secondary'),
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  spacer: { flex: '1 1 auto' },
} satisfies Record<string, CSSProperties>;
