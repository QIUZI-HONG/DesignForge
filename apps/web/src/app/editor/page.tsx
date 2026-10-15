import { EditorShell } from '@/features/editor-shell';

// FE-06 宿主接线（画布 + 面板 + Inspector + 检查/导出 + AI/MCP 的挂载入口；
// 只 import 一次即完成插槽与命令注册，壳层与本文件其余部分不动）。
import '@/features/canvas/register';

/**
 * 编辑器页（`/editor`，清单 C 区对标页族的外围骨架）。
 *
 * 本页只做一件事：把壳层挂到路由上。壳层内部的插槽
 * （`left-panel` / `canvas` / `right-panel` / `topbar-*` / `toolbar` / `overlays`）
 * 由后续票以 `registerEditorSlotItem(...)` 挂载实现：
 *
 * - FE-04 图层面板 + 资产面板 → `left-panel`
 * - FE-05 Inspector → `right-panel`
 * - FE-06 画布与编辑行为 → `canvas`（HUD 用 `useCanvasHud()`）
 * - FE-07 评论 / Present / 版本 → `topbar-right`、`overlays`、`toolbar`
 * - FE-08 组件交互 + 检查导出 → `toolbar` / `right-panel` / `overlays`
 *
 * 各票在自己的 `features/<id>/` 目录里写挂载模块，并在本文件顶部加一行
 * `import '@/features/<id>/register';`（纯增量，见 `features/editor-shell/slots/registry.ts` 头注释）。
 * 注意：本页是服务端组件，不直接用浏览器 API；壳层与插槽宿主都是客户端组件。
 */
export default function EditorPage() {
  return <EditorShell />;
}
