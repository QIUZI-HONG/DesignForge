/**
 * `@dforge/web` 编辑器面板特性（FE-04 · RW-13 重写图层面板）—— 图层面板 + 资产面板的公开面。
 *
 * 消费方（FE-03 编辑器壳 / FE-05 Inspector / FE-06 画布）只需要这几样：
 * - `createPanelsSession` + `PanelsProvider`：把命令栈与选择集接起来；
 * - `EditorPanels`（左栏「图层 / 资产」双页签）/ `LayersPanel` / `AssetsPanel`：可直接挂载的面板；
 * - `usePanelsDocument` / `usePanelsUi`：面板内部的订阅 hooks（画布渲染循环也可直接用 `session.subscribe`）。
 *
 * 纪律：本模块**不直接修改文档**——一切写入都是引擎命令，由 `PanelsSession.run` 交给命令栈。
 */

export {
  bringToFrontCommands,
  deleteLayerCommands,
  groupLayersCommands,
  moveLayerCommands,
  renameLayerCommands,
  sendToBackCommands,
  setLockedCommands,
  setVisibilityCommands,
  toggleLockCommands,
  toggleVisibilityCommands,
  ungroupLayerCommands,
} from './commands/layer-commands';
export { type LayerMenuEntry, layerContextMenu } from './commands/layer-menu';
export {
  resolveTreeDropPlacement,
  type TreeDropPlacement,
  type TreeDropPointer,
} from './commands/tree-drop';
export { AssetsPanel, type AssetsPanelProps } from './components/AssetsPanel';
export { EditorPanels, type EditorPanelsProps } from './components/EditorPanels';
export { LayerContextMenu, type LayerContextMenuProps } from './components/LayerContextMenu';
export { LayersPanel, type LayersPanelProps } from './components/LayersPanel';
export { PanelsProvider, usePanelsSession } from './components/panels-context';

export { createPanelsSession, type PanelsSession, type PanelsSessionOptions } from './session';
export { usePanelsDocument, usePanelsUi } from './state/hooks';
export {
  type AssetSegment,
  createPanelsUiStore,
  isRowSelected,
  type LeftPanelTab,
  type PanelsUiState,
  type PanelsUiStore,
  selectionOf,
} from './state/panels-store';
