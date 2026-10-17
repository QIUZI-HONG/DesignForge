/**
 * `@dforge/web` 数据看板特性（D6）——公开面。
 *
 * 消费方（`/dashboard` 路由）只需要：
 * - `DashboardView`：受控看板视图（`response` + `nowIso` 由页面注入，页面持有取数）。
 *
 * 不导出（刻意的）：`metrics.ts` 纯函数族——它们只服务本 feature 的视图与测试
 * （验收要的是「算不出的项显示未上报」，不是让外部重算）。
 */

export { DashboardView, type DashboardViewProps } from './DashboardView';
