/**
 * `features/inspector` 公开面（FE-05 交付给 FE-06 / 编辑器壳的接口）。
 *
 * 使用方式（宿主页面 = 编辑器路由，FE-06 接线）：
 * ```tsx
 * import { InspectorPanel } from '@/features/inspector';
 * <InspectorPanel stack={stack} pageId={pageId} selection={selection} />
 * ```
 * 面板是**受控组件**：文档来自命令栈（`useSyncExternalStore` 订阅，不进 React state），
 * 选中集与当前页面由宿主传入（选中集是 UI 态，归宿在宿主的 store）。
 *
 * RW-10：可选 `selectionStore`（zustand vanilla store 的 `{ selection }` 片段）——
 * 提供后面板**自订阅**选中变化（即时刷新，不依赖宿主整树重渲）；
 * 未提供时回落 `selection` props（受控路径）。
 *
 * 门禁与预览：`preview.ts` 提供三态（默认/混选/空选）文档与选择集预设，
 * `scripts/verify-figma-inspector.mjs` 通过 `?df-state=` 驱动宿主页面取这三态。
 */

export { AlignRow, type AlignRowProps } from './components/AlignRow';
export {
  CanvasSettings,
  type CanvasSettingsProps,
  isValidColorLiteral,
} from './components/CanvasSettings';
export {
  InspectorPanel,
  type InspectorPanelProps,
  type SelectionSource,
} from './components/InspectorPanel';
export { MIXED_PLACEHOLDER, NumberField, type NumberFieldProps } from './components/NumberField';
export { createScrubSession, type ScrubSession } from './model/scrub-session';
export { COMMIT_DELAY_MS, type DraftCommit, useDraftCommit } from './model/draft';
export {
  createPreviewDocument,
  INSPECTOR_PREVIEW_STATES,
  type InspectorPreviewState,
  previewSelection,
} from './preview';
