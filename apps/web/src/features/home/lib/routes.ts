/**
 * 首页 → 编辑器跳转地址（FE-02）。
 *
 * `/editor` 路由归 FE-03（并行落地中）：本模块只收敛地址形状（`?documentId=`），
 * 首页卡片、搜索结果、新建后的跳转都从这里取——FE-03 若调整约定，只改这一处。
 */

/** 编辑器路由路径（FE-03 落地）。 */
export const EDITOR_ROUTE = '/editor';

/** 文档 id → 编辑器地址。 */
export function editorHref(documentId: string): string {
  return `${EDITOR_ROUTE}?documentId=${encodeURIComponent(documentId)}`;
}
