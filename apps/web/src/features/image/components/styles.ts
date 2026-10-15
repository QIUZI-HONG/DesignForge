'use client';

/**
 * 出图面板样式（内联样式对象；颜色/间距/圆角/字号一律取 `@dforge/ui` 令牌）。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const hairline = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 面板内容区样式。 */
export const imageStyles = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-3'),
  },
  banner: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    background: cssVar('color-warning-subtle'),
    borderRadius: cssVar('radius-md'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
  },
  bannerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.primary'),
  },
  bannerDetail: {
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
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
  },
  fieldLabel: {
    fontSize: cssVar('font-size-12'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.secondary'),
  },
  textarea: {
    width: '100%',
    minHeight: cssVar('size-textarea-min-height'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    background: cssVar('color.surface-subtle'),
    color: cssVar('color.text.primary'),
    border: hairline,
    borderRadius: cssVar('radius-md'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
    resize: 'vertical',
  },
  paramRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: cssVar('space-2'),
  },
  paramLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
  },
  paramInput: {
    width: '100%',
    height: cssVar('control-height-md'),
    padding: `0 ${cssVar('space-2')}`,
    background: cssVar('color.surface-subtle'),
    color: cssVar('color.text.primary'),
    border: hairline,
    borderRadius: cssVar('radius-sm'),
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
  },
  progressArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    background: cssVar('color.surface-subtle'),
    border: hairline,
    borderRadius: cssVar('radius-md'),
  },
  progressHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  statusText: {
    flex: '1 1 auto',
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.primary'),
  },
  failureBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    background: cssVar('color.danger-subtle'),
    borderRadius: cssVar('radius-md'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
  },
  failureMessage: {
    color: cssVar('color.text.primary'),
    wordBreak: 'break-word',
  },
  modelLists: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
  },
  artifactList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  artifactRow: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    height: cssVar('row-height-md'),
    padding: `0 ${cssVar('space-2')}`,
    border: hairline,
    borderRadius: cssVar('radius-sm'),
    fontSize: cssVar('font-size-12'),
  },
  artifactName: {
    flex: '1 1 auto',
    color: cssVar('color.text.primary'),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  artifactSize: {
    color: cssVar('color.text.secondary'),
    fontSize: cssVar('font-size-11'),
  },
  sectionTitle: {
    fontSize: cssVar('font-size-12'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.secondary'),
  },
  emptyText: {
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
