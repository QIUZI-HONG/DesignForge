/**
 * `@dforge/web` 组件系统特性（FE-08 组件交互）——公开面。
 *
 * 消费方只有两处，导出因此刻意收窄：
 * - 编辑器工作区（`features/canvas/workspace/workspace-session.ts`）：预览协议
 *   —— `?df-components=` 五态 → `ComponentPreviewState` 类型 + 文档/选择集工厂；
 * - 编辑器壳（经插槽挂组件面板）：`ComponentPanel`（受控：文档来自命令栈，选中集由宿主传入）。
 *
 * 不导出（刻意的）：`model/*`（命令构造、覆盖读取、快捷键）、`testing/*` 夹具、
 * 内部 hooks——它们只服务本 feature 与自己的测试。
 */

export {
  ComponentPanel,
  type ComponentPanelProps,
} from './components/ComponentPanel';
export {
  type ComponentPreviewState,
  createComponentsPreviewDocument,
  previewSelection,
} from './preview';
