'use client';

/**
 * 市场特性的**编辑器接线模块**（票 16 · register 接缝，ADR-0004 ②「唯一第二入口」）。
 *
 * 由编辑器唯一客户端引导件 `app/editor/editor-bootstrap.tsx` 的插槽声明表引用
 * （`slot: 'left-panel-tabs'`，图层 / 资产之后追加「市场」页签）；feature 之间不得互引
 * 本模块（边界守卫），app 路由层引 `@/features/market/register` 是登记例外。
 *
 * 职责：把既有市场面板（D5）承载进编辑器左栏。数据流与 `/market/panel` 页同口径——
 * 自 P1-5 六态提取起两侧共用 `MarketPanelBody`（数据/feedback/派生经 `useMarketPanelData`
 * 单点供给），本模块只剩页签体的**壳**。两处刻意不同（勿在共享件里合并）：
 * - **不动根元素主题**：编辑器深色基准由壳层持有（`EditorThemeScope`），页级主题开关
 *   若带进编辑器，卸载时会把根元素「恢复」成浅色（漂移 + 残留）；
 * - **无页面级壳**：页题/反馈键说明是 `/market/panel` 的页面 chrome，页签体只承载面板内容与六态。
 */

import { t } from '@/i18n';

import { MarketPanelBody } from './components/MarketPanelBody';

/** 左栏扩展页签 id（editor-bootstrap 声明与测试共用一处定义；id 约定 `<ticket>-<feature>`）。 */
export const MARKET_TAB_ID = 'p2-market';

/** 页签文案（i18n 单点；editor-bootstrap 声明与测试共用，禁裸值）。 */
export function marketTabLabel(): string {
  return t('panels.market.title');
}

/** 编辑器内市场面板页签体（六态渲染体 + 编辑器宿主壳）。 */
export function MarketPanelSlot() {
  return (
    <div className="dfg-market__editor-host" data-df-market="editor-panel">
      <MarketPanelBody />
    </div>
  );
}
