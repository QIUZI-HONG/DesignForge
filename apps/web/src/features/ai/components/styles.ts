'use client';

/**
 * AI 抽屉样式（内联样式对象；颜色/间距/圆角/字号一律取 `@dforge/ui` 令牌）。
 *
 * 与面板（FE-04）同一口径：样式对象随组件走，令牌引用在 TS 里可见（guard-tokens 可逐行兜住），
 * jsdom 测试也能直接读 `style`。几何计算（如步骤圆圈边长）显式写算式，单位仍来自令牌。
 */
import { cssVar } from '@dforge/ui';
import type { CSSProperties } from 'react';

const hairline = `${cssVar('border-width.hairline')} solid ${cssVar('color.border')}`;

/** 抽屉内容区样式。 */
export const aiStyles = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-3'),
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    padding: `${cssVar('space-2')} ${cssVar('space-3')}`,
    background: cssVar('color.warning-subtle'),
    color: cssVar('color.text.primary'),
    borderRadius: cssVar('radius-md'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
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
    minHeight: cssVar('size.textarea-min-height'),
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
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  spacer: { flex: '1 1 auto' },
  sectionTitle: {
    fontSize: cssVar('font-size-12'),
    fontWeight: cssVar('font-weight-medium'),
    color: cssVar('color.text.secondary'),
  },
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
    minHeight: cssVar('control-height-md'),
    padding: `0 ${cssVar('space-2')}`,
    borderRadius: cssVar('radius-sm'),
  },
  stepLabel: {
    flex: '1 1 auto',
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.primary'),
  },
  stepStatus: {
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
  },
  stepDot: {
    width: cssVar('icon-size-sm'),
    height: cssVar('icon-size-sm'),
    borderRadius: cssVar('radius-pill'),
    border: `${cssVar('border-width-thick')} solid ${cssVar('color.border-strong')}`,
    boxSizing: 'border-box',
  },
  result: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-2'),
    padding: cssVar('space-3'),
    background: cssVar('color.surface-subtle'),
    border: hairline,
    borderRadius: cssVar('radius-md'),
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  content: {
    margin: 0,
    padding: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: cssVar('font.sans'),
    fontSize: cssVar('font-size-12'),
    lineHeight: cssVar('line-height-base'),
    color: cssVar('color.text.primary'),
  },
  /** 降级角标「本地模板」：AI 紫语义色（与组件紫同源）。 */
  badge: {
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
  },
  suggestionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: cssVar('space-1'),
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  suggestionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: cssVar('space-2'),
  },
  suggestionText: {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.text.primary'),
  },
  suggestionDetail: {
    fontSize: cssVar('font-size-11'),
    color: cssVar('color.text.secondary'),
  },
  errorText: {
    fontSize: cssVar('font-size-12'),
    color: cssVar('color.danger'),
  },
} satisfies Record<string, CSSProperties>;

/** 步骤圆形状态的强调色（活动 = 主色；完成 = 成功；失败 = 危险）。 */
export function stepAccent(status: string): string {
  if (status === 'active') return cssVar('color.primary');
  if (status === 'done') return cssVar('color.success');
  if (status === 'failed') return cssVar('color.danger');
  return cssVar('color.text.disabled');
}
