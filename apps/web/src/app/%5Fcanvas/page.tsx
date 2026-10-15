/**
 * `/_canvas` 路由入口（FE-06 画布宿主页）。
 *
 * 为什么要有这个「重导出」文件：Next App Router 把下划线开头的目录（`_canvas`）
 * 当作**私有目录**（非路由），因此 `app/_canvas/page.tsx` 不会产生 URL。
 * 用 URL 编码目录名 `%5Fcanvas` 才能得到 `/_canvas` 真实路由，
 * 同时把实现留在语义清晰的 `_canvas/` 私有目录里（与 FE-01 的 `/_design` 同一手法）。
 */
export { default } from '../_canvas/page';
