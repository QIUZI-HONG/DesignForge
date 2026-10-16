/**
 * `@dforge/web` 检查/导出特性（FE-08：检查态 · 代码 · 导出）——公开面。
 *
 * 消费方（编辑器右栏插槽 `features/canvas/workspace/slots.tsx` 与工作区装配
 * `workspace-session.ts`）只需要：
 * - 三块右栏面板：`InspectPanel`（C15 检查态）/ `CodeExportPanel`（F6 代码）/ `ExportPanel`；
 * - 预览协议：`?df-inspect=` 三态 → `InspectPreviewState` 类型 + 文档/选择集工厂。
 *
 * 不导出（刻意的）：`model/*`（测量、代码生成、导出客户端、令牌桥）、
 * `hooks/*`、`testing/*` 夹具——它们只服务本 feature 与自己的测试。
 */

export { CodeExportPanel, type CodeExportPanelProps } from './components/CodeExportPanel';
export { ExportPanel, type ExportPanelProps } from './components/ExportPanel';
export { InspectPanel, type InspectPanelProps } from './components/InspectPanel';
export {
  createInspectPreviewDocument,
  type InspectPreviewState,
  previewSelection,
} from './preview';
