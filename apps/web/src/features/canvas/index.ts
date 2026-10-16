/**
 * `@dforge/web` 画布特性（FE-06）——公开面。
 *
 * 本 feature 是「编辑器路由的画布实现」：它在自己的目录里实现画布、输入、渲染与
 * 工作区装配，并**经 FE-03 的插槽约定挂载**（挂载入口是 `./register`，见其头注释与
 * `features/editor-shell/index.ts`），因此跨边界消费面很窄：
 * - `CanvasStudio`：宿主页 `/_canvas`（内部工具页，画布 6 断言与 e2e 的入口）的整块画布工作室；
 *
 * 不导出（刻意的）：`CanvasSession` 状态与 store（跨票拿文档真值应走 FE-04 的
 * `PanelsSession`）、渲染/输入/调试内部件、`register*` 引导函数（挂载走 `./register`）。
 * 新增跨边界消费需求 = 在本文件显式加一行，而不是引用内部路径。
 */

export { CanvasStudio, type CanvasStudioProps } from './studio/canvas-studio';
