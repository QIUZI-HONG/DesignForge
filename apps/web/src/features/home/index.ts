/**
 * `@dforge/web` 首页特性（FE-02）——公开面。
 *
 * 消费方（`app/page.tsx` 首页路由、FE-09 冷启动页）只需要：
 * - `HomeView`：整块首页视图（数据面可注入）；
 * - `editorHref` / `EDITOR_ROUTE`：编辑器地址形状的单点收敛（`?documentId=`）
 *   ——首页卡片、搜索结果、新建跳转与冷启动分流都从这里取；FE-03 若改约定只改此处。
 *
 * 不导出（刻意的）：`api/*`（文档网关与基址解析，属首页内部数据面）、
 * `state/*`（首页 store）、`lib/*` 中除地址形状外的过滤/格式化工具、图标与卡片等内部组件。
 */

export { HomeView, type HomeViewProps } from './components/HomeView';
export { EDITOR_ROUTE, editorHref } from './lib/routes';
