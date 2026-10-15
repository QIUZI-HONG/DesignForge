/**
 * `/_design` 路由入口（FE-01 预览页）。
 *
 * 为什么要有这个「重导出」文件：Next App Router 把下划线开头的目录（`_design`）
 * 当作**私有目录**（非路由，只用于同目录内共享模块），因此 `app/_design/page.tsx`
 * 不会产生 URL。用 URL 编码目录名 `%5Fdesign` 才能得到 `/_design` 这个真实路由，
 * 同时把实现留在语义清晰的 `_design/` 私有目录里（含测试与主题切换）。
 */
export { default } from '../_design/page';
