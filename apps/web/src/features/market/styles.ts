/**
 * 市场与看板的页面级样式基线（全部走 `@dforge/ui` 双基准令牌变量；禁裸值）。
 *
 * 为什么用内联样式对象而不是新增 CSS 文件：组件样式已由 `@dforge/ui` 的 `components.css`
 * 承载；页面级版式是**本票自设计页的私有排版**，集中在单文件里便于门禁扫描
 * （`scripts/verify-market.mjs` 对两个 feature 目录跑 `guard-tokens` 同源检查）与换肤。
 * 令牌引用一律 `var(--dfg-*)`；主题差异通过 `data-theme="dark"` 由令牌变量自身承接
 * （浅色首页族 ↔ 深色编辑器族，验收标准 §3）。
 */

import type { CSSProperties } from 'react';

/** 布局容器（浅色页：整页背景 + 内容栅格）。 */
export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  alignContent: 'start',
  gap: 'var(--dfg-space-6)',
  padding: 'var(--dfg-space-6)',
  background: 'var(--dfg-color-canvas)',
  color: 'var(--dfg-color-text-primary)',
  fontFamily: 'var(--dfg-font-sans)',
  fontSize: 'var(--dfg-font-size-13)',
};

/** 页头（标题 + 副标题 + 搜索/操作区）。 */
export const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-3)',
};

/** 页标题。 */
export const titleStyle: CSSProperties = {
  margin: '0',
  fontSize: 'var(--dfg-font-size-20)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 页副标题/说明。 */
export const subtitleStyle: CSSProperties = {
  margin: '0',
  color: 'var(--dfg-color-text-secondary)',
  lineHeight: 'var(--dfg-line-height-relaxed)',
};

/** 小号提示文字。 */
export const hintStyle: CSSProperties = {
  margin: '0',
  color: 'var(--dfg-color-text-disabled)',
  fontSize: 'var(--dfg-font-size-11)',
};

/** 分页行（「加载更多」+ 已加载计数；DEF-R1/DEF-02）。顶部 hairline 与结果区分隔。 */
export const paginationStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--dfg-space-3)',
  paddingBlock: 'var(--dfg-space-3)',
  borderTop: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
};

/** 空态动作区（主/次按钮与进度行居中排布；DEF-01）。 */
export const emptyActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--dfg-space-2)',
};

/** 空态内的分页进度行（页内空态也保留加载入口；DEF-01）。 */
export const emptyPaginationStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--dfg-space-2)',
  fontSize: 'var(--dfg-font-size-11)',
  color: 'var(--dfg-color-text-secondary)',
};

/** 分页失败提示（行内，保留已载内容可重试）。 */
export const paginationErrorStyle: CSSProperties = {
  color: 'var(--dfg-color-danger)',
  fontSize: 'var(--dfg-font-size-11)',
};

/** 工具栏行（搜索 + 一级标签 + 排序等横向排布）。 */
export const toolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--dfg-space-2)',
};

/** 筛选栏容器（白底卡片）。 */
export const filterBarStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-3)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-lg)',
};

/** 筛选行（横向控件组）。 */
export const filterRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--dfg-space-2)',
};

/** 卡片网格（自适应列宽；minmax 的下限是 8 栅格上的卡片最小可读宽）。 */
export const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', // guard-tokens:allow 卡片最小列宽：240 为页面几何常量（令牌族未覆盖，见 verify-market 登记）
  gap: 'var(--dfg-space-4)',
  alignItems: 'stretch',
};

/** 卡片基础（悬停抬升由组件按状态叠加 transform/boxShadow）。 */
export const cardStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 'var(--dfg-space-2)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-lg)',
  boxShadow: 'var(--dfg-shadow-sm)',
  transition:
    'transform var(--dfg-duration-fast) var(--dfg-easing-standard), box-shadow var(--dfg-duration-fast) var(--dfg-easing-standard)',
};

/** 卡片悬停态（抬升一个基础间距档；配合强调阴影）。 */
export const cardHoverExtraStyle: CSSProperties = {
  transform: 'translateY(calc(var(--dfg-space-1) * -1))',
  boxShadow: 'var(--dfg-shadow-lg)',
  borderColor: 'var(--dfg-color-border-strong)',
  cursor: 'pointer',
};

/** 卡片缩略图占位区（固定 64 高：kind 图标 + 「暂无预览」，不再用 16:9 大灰块）。 */
export const thumbStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--dfg-space-1)',
  height: 'var(--dfg-space-16)',
  background: 'var(--dfg-color-surface-subtle)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-md)',
  color: 'var(--dfg-color-icon-secondary)',
};

/** 缩略图占位的说明文字（11px 次级文本）。 */
export const thumbLabelStyle: CSSProperties = {
  fontSize: 'var(--dfg-font-size-11)',
  color: 'var(--dfg-color-text-secondary)',
};

/** 卡片标题行。 */
export const cardTitleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--dfg-space-2)',
  justifyContent: 'space-between',
};

/** 卡片主文案（中文主名）。 */
export const cardNameStyle: CSSProperties = {
  margin: '0',
  fontSize: 'var(--dfg-font-size-15)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 卡片次行（英文名/机器名，双语卡片的第二语言行）。 */
export const cardSubNameStyle: CSSProperties = {
  margin: '0',
  color: 'var(--dfg-color-text-disabled)',
  fontSize: 'var(--dfg-font-size-11)',
};

/** 卡片描述。 */
export const cardSummaryStyle: CSSProperties = {
  margin: '0',
  color: 'var(--dfg-color-text-secondary)',
  lineHeight: 'var(--dfg-line-height-base)',
  display: '-webkit-box',
  WebkitLineClamp: '3',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/** 徽标/标签行。 */
export const badgeRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--dfg-space-1)',
};

/** 徽标基座（风险/许可/来源共用；色调由 tone 决定）。 */
export function badgeStyle(tone: 'neutral' | 'ok' | 'warn' | 'danger'): CSSProperties {
  const color =
    tone === 'danger'
      ? 'var(--dfg-color-danger)'
      : tone === 'warn'
        ? 'var(--dfg-color-warning)'
        : tone === 'ok'
          ? 'var(--dfg-color-success)'
          : 'var(--dfg-color-text-secondary)';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-1)',
    paddingBlock: 'var(--dfg-space-1)',
    paddingInline: 'var(--dfg-space-2)',
    border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-sm)',
    background: 'var(--dfg-color-surface-subtle)',
    color,
    fontSize: 'var(--dfg-font-size-11)',
  };
}

/** 搜索命中高亮片段。 */
export const markStyle: CSSProperties = {
  background: 'var(--dfg-color-selection)',
  color: 'var(--dfg-color-selection-text)',
  borderRadius: 'var(--dfg-radius-sm)',
};

/** 区块卡（详情/看板分组）。 */
export const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-3)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-lg)',
};

/** 区块标题。 */
export const sectionTitleStyle: CSSProperties = {
  margin: '0',
  fontSize: 'var(--dfg-font-size-15)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 键值信息表（来源/许可/版本等）。 */
export const kvTableStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 'var(--dfg-space-2) var(--dfg-space-4)',
  margin: '0',
  fontSize: 'var(--dfg-font-size-12)',
};

/** 键列。 */
export const kvKeyStyle: CSSProperties = {
  color: 'var(--dfg-color-text-secondary)',
};

/** 值列（可换行，长哈希不撑破容器）。 */
export const kvValueStyle: CSSProperties = {
  margin: '0',
  overflowWrap: 'anywhere',
};

/** 详情两栏（左预览 / 右信息）。 */
export const detailLayoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 5fr) minmax(0, 7fr)', // guard-tokens:allow 详情预览栏最小宽：320 为页面几何常量（令牌族未覆盖，见 verify-market 登记）
  gap: 'var(--dfg-space-4)',
  alignItems: 'start',
};

/** 预览区（左栏）。 */
export const previewStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-3)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-lg)',
  position: 'sticky',
  top: 'var(--dfg-space-4)',
};

/** 预览画布（无预览资产时的占位由组件替换）。 */
export const previewCanvasStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  aspectRatio: '4 / 3',
  background: 'var(--dfg-color-surface-subtle)',
  border: 'var(--dfg-border-width-hairline) dashed var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-md)',
  color: 'var(--dfg-color-icon-secondary)',
};

/** 列表行（扣分原因/能力清单）。 */
export const listStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-2)',
  margin: '0',
  padding: '0',
  listStyle: 'none',
};

/** 列表项。 */
export const listItemStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-1)',
  padding: 'var(--dfg-space-3)',
  background: 'var(--dfg-color-surface-subtle)',
  borderRadius: 'var(--dfg-radius-md)',
};

/** 维度行（雷达旁的分维度分数 + 原因）。 */
export const dimRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  alignItems: 'center',
  gap: 'var(--dfg-space-2)',
};

/** 进度轨道底（分维度条）。 */
export const meterTrackStyle: CSSProperties = {
  height: 'var(--dfg-space-2)',
  background: 'var(--dfg-color-surface-subtle)',
  borderRadius: 'var(--dfg-radius-pill)',
  overflow: 'hidden',
};

/** 进度条填充（宽度由数据给百分比）。 */
export function meterFillStyle(tone: 'primary' | 'warn' | 'danger'): CSSProperties {
  return {
    height: '100%',
    background:
      tone === 'danger'
        ? 'var(--dfg-color-danger)'
        : tone === 'warn'
          ? 'var(--dfg-color-warning)'
          : 'var(--dfg-color-primary)',
  };
}

/** 数值（分数徽标）。 */
export const scoreStyle: CSSProperties = {
  fontSize: 'var(--dfg-font-size-15)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 看板统计卡网格。 */
export const statGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', // guard-tokens:allow 统计卡最小列宽：180 为页面几何常量（令牌族未覆盖，见 verify-market 登记）
  gap: 'var(--dfg-space-3)',
};

/** 统计卡（数字 + 标签）。 */
export const statCardStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-1)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-lg)',
};

/** 统计数值。 */
export const statValueStyle: CSSProperties = {
  fontSize: 'var(--dfg-font-size-20)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 统计标签。 */
export const statLabelStyle: CSSProperties = {
  color: 'var(--dfg-color-text-secondary)',
  fontSize: 'var(--dfg-font-size-12)',
};

/** 数据表（看板）。 */
export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--dfg-font-size-12)',
};

/** 表头单元。 */
export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: 'var(--dfg-space-2)',
  color: 'var(--dfg-color-text-secondary)',
  borderBottom: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  fontWeight: 'var(--dfg-font-weight-medium)',
};

/** 表体单元。 */
export const tdStyle: CSSProperties = {
  textAlign: 'left',
  padding: 'var(--dfg-space-2)',
  borderBottom: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
};

/** 命令提示块（空态里的采集指引；等宽显示 CLI）。 */
export const codeStyle: CSSProperties = {
  display: 'block',
  margin: '0',
  padding: 'var(--dfg-space-3)',
  background: 'var(--dfg-color-surface-subtle)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-md)',
  fontFamily: 'monospace',
  fontSize: 'var(--dfg-font-size-12)',
  color: 'var(--dfg-color-text-primary)',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
};

/* ---------------- 深色面板（D5 编辑器内市场面板） ---------------- */

/** 深色面板外壳（宽固定，随编辑器右栏挂载；独立路由时居中演示）。 */
export const panelStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 'var(--dfg-space-3)',
  width: '100%',
  maxWidth: 'var(--dfg-size-drawer-md)',
  padding: 'var(--dfg-space-4)',
  background: 'var(--dfg-color-surface)',
  color: 'var(--dfg-color-text-primary)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-md)',
  fontFamily: 'var(--dfg-font-sans)',
  fontSize: 'var(--dfg-font-size-12)',
};

/** 深色面板标题行。 */
export const panelHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--dfg-space-2)',
};

/** 深色面板列表（紧凑行高：面板密度随深色族）。 */
export const panelListStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-1)',
  margin: '0',
  padding: '0',
  listStyle: 'none',
};

/** 深色面板列表行。 */
export const panelRowStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--dfg-space-1)',
  padding: 'var(--dfg-space-2)',
  background: 'var(--dfg-color-surface-raised)',
  border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  borderRadius: 'var(--dfg-radius-sm)',
};

/** 深色页容器（独立路由演示深色族；编辑器内由壳层给主题）。 */
export const darkPageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  alignContent: 'start',
  justifyItems: 'center',
  gap: 'var(--dfg-space-4)',
  padding: 'var(--dfg-space-6)',
  background: 'var(--dfg-color-canvas)',
  color: 'var(--dfg-color-text-primary)',
  fontFamily: 'var(--dfg-font-sans)',
};
