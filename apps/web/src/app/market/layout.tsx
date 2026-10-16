import type { ReactNode } from 'react';

import { pageStyle } from '@/features/market';

/**
 * 市场路由段布局（FE-11 自设计页族）。
 *
 * 只做「浅色首页族」的页面外壳（整页底 + 栅格 + 字体），主题与间距全部走令牌；
 * 编辑器内市场面板（D5）是深色族，走独立路由 `/market/panel` 自行切主题。
 * 主题按页对齐 Figma 本体（验收标准 §3）：D1–D3 浅色。
 */
export default function MarketLayout({ children }: { children: ReactNode }) {
  return <div style={pageStyle}>{children}</div>;
}
