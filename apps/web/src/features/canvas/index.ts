/**
 * `@dforge/web` 画布特性（FE-06）——公开面。
 *
 * 本 feature 是「编辑器路由的画布实现」：它在自己的目录里实现画布、输入、渲染与
 * 工作区装配，并**经 FE-03 的插槽约定挂载**（挂载入口是 `./register`，见其头注释与
 * `features/editor-shell/index.ts`），因此跨边界消费面很窄：
 * - `CanvasStudio`：宿主页 `/_canvas`（内部工具页，画布 6 断言与 e2e 的入口）的整块画布工作室；
 * - `getWorkspace` / `subscribeWorkspace` / `setWorkspace` / `resetWorkspace`：
 *   **编辑器工作区单例的读写接缝**——编辑器路由上「文档真值」住在这里
 *   （FE-04 `PanelsSession` 的命令栈被画布会话共享），评审会话（FE-07）的文档端口
 *   必须与它同源，否则演示判定/版本快照会读到另一份文档；载入/导入换栈后由
 *   `subscribeWorkspace` 通知跨 feature 消费者重订阅（`resetWorkspace` 是测试/热重载复位）。
 *
 * 不导出（刻意的）：`CanvasSession` 状态与 store（跨票拿文档真值应走 FE-04 的
 * `PanelsSession`）、渲染/输入/调试内部件、`register*` 引导函数（挂载走 `./register`）。
 * 新增跨边界消费需求 = 在本文件显式加一行，而不是引用内部路径。
 */

export { CanvasStudio, type CanvasStudioProps } from './studio/canvas-studio';
export {
  type EditorWorkspace,
  getWorkspace,
  resetWorkspace,
  setWorkspace,
  subscribeWorkspace,
} from './workspace/workspace-session';
