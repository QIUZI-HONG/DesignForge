/**
 * `@dforge/web` 技能市场特性（FE-11 · D1–D6）——公开面。
 *
 * 消费方（`app/market/**` 三条路由 + `app/dashboard` 路由 + `features/dashboard` 看板）
 * 需要的东西分四类，本文件按类收敛：
 * 1. **组件**：`./components` 已是策展过的 barrel（页面只从这里取件），整表转发；
 * 2. **页面级纯逻辑**：`filters`（筛选/检索）、`load-store`（本地装载记录册）、
 *    `feedback`（回流计数）——整个模块的接口都是页面级共享面，整表转发；
 * 3. **样式**：`styles`（按令牌变量的页面级版式对象；浅色市场族 + 深色面板族）；
 * 4. **hooks / 视图态**：`useMarketQuery` / `useMarketAsset` / `useLoadPlan` / `useLoadRecords`
 *    （取数）、`classifyMarketOutcome`（索引缺失/损坏归一成空态）、`MarketPanel`（编辑器内速览面板）。
 *
 * 测试夹具：`marketFixtures` 命名空间——卡片字段多（§1.2 二十余键），逐用例手写会把测试淹在
 * 样板里；跨 feature 的测试（dashboard / app 路由）经此取，**不经 `__fixtures__` 深路径**。
 * 生产代码不得引用它。
 *
 * 不导出（刻意的）：`api.ts` 的取数客户端与 URL 构造（只服务本 feature 的 hooks 与门禁脚本）、
 * `capabilities` / `quality` 内部口径、`state-coverage*`（门禁用统计）。
 */

/** 测试夹具命名空间（**仅供 `*.test.*`**；理由见文件头）。 */
export * as marketFixtures from './__fixtures__/market';
export { classifyMarketOutcome, isSearchDegraded, type MarketOutcome } from './api';
export * from './components';
export * from './feedback';
export * from './filters';
export * from './load-store';
export { MarketPanel, type MarketPanelProps } from './panel/MarketPanel';
export * from './styles';
export {
  type MarketQueryState,
  useLoadPlan,
  useLoadRecords,
  useMarketAsset,
  useMarketQuery,
} from './use-market';
