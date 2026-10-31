/**
 * 市场空态判定顺序（巡检缺口①②；ux-audit spec P2「判定顺序修正」）。
 *
 * 旧实现里 `index-missing` 在页面渲染序里压过一切：有查询词时「无结果」、已装载视图的
 * 「已装载空态」在空索引下都不可达。本模块把四类空态的**判定顺序**收成一个纯函数：
 *
 * 1. **已装载视图 + 本地无装载记录** → `installed-empty`：用户还没装载过任何资源，
 *    这是比「索引缺失」更贴切的真话（缺口②）；
 * 2. **有查询词** → `no-result`：查询词优先于索引缺失（缺口①——判定顺序改为查询词优先，
 *    「无结果」空态不再被 `index-missing` 压住不可达）；
 * 3. **索引缺失/损坏** → `index-missing` / `index-invalid`：无查询词的浏览态维持
 *    「去跑采集」指引（已装载视图本地有记录但列不出时也落在这支——如实说索引缺失，
 *    而不是假称「还没有装载任何资源」）；
 * 4. 其余（集合被查询/客户端过滤滤空）→ `no-result`。
 *
 * 纯函数、无 DOM：页面（`app/market/page.tsx`）在结果集为空或索引缺失时调它取空态种类。
 */

import type { MarketOutcome } from './api';
import type { MarketEmptyKind } from './components/MarketStates';

/** 判定输入（页面就绪态的四个事实；不传组件状态，只传已归一的事实）。 */
export interface MarketEmptyKindInput {
  /** 查询响应归一结果（`classifyMarketOutcome` 的产出）。 */
  outcome: MarketOutcome;
  /** 搜索框是否有关键词（去空白后非空）。 */
  hasQuery: boolean;
  /** 是否处于「已装载」二级视图。 */
  installedView: boolean;
  /** 本地装载记录条数（真值在本地记录册；0 = 还没装载过任何资源）。 */
  loadedCount: number;
}

/** 按判定顺序归一空态种类（顺序见模块头注释；任何输入都有分支可匹配）。 */
export function resolveMarketEmptyKind(input: MarketEmptyKindInput): MarketEmptyKind {
  if (input.installedView && input.loadedCount === 0) return 'installed-empty';
  if (input.hasQuery) return 'no-result';
  if (input.outcome === 'index-missing') return 'index-missing';
  if (input.outcome === 'index-invalid') return 'index-invalid';
  return 'no-result';
}
