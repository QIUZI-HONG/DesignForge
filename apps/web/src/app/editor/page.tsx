// FE-06 宿主接线（工单 02 引导收口）：编辑器页只挂「壳层 + 唯一客户端引导件」。
//
// 为什么引导是「渲染出来的客户端组件」而不是裸 import：Next App Router 里仅被 import、
// 未被渲染的客户端模块不进首屏客户端图（实测入口仍是禁用态）；引导在挂载后（effect）
// 才注册插槽与命令，服务端/客户端首帧一致（服务端空槽形态 = 客户端首帧形态），
// hydration 不匹配由此消除。此前散点 `return null` 引导件（WorkspaceBootstrap /
// ReviewBootstrap）与模块顶层注册的职责，全部收进 `./editor-bootstrap`。
//
// 插槽（`left-panel` / `canvas` / `right-panel` / `topbar-*` / `toolbar` / `overlays`）
// 与命令注册全部声明在 `./editor-bootstrap` 的注册表里：
//
// - FE-04 图层面板 + 资产面板 → `left-panel`（`fe-04-panels`，经 FE-06 装配同源）
// - FE-05 Inspector → `right-panel`（`fe-06-right` 装配的下半区）
// - FE-06 画布与编辑行为 → `canvas` 等（HUD 用 `useCanvasHud()`）
// - FE-07 评论 / Present / 版本 → `canvas` / `right-panel` / `overlays` + 顶栏命令
// - FE-08 组件交互 + 检查导出 → `right-panel` 页签（FE-06 装配）
// - FE-10 AI/MCP → `toolbar` / `overlays`
//
// 新增插槽 = 注册表加一条声明（纯增量），不再需要改本页。
import { EditorShell } from '@/features/editor-shell';

import { EditorBootstrap } from './editor-bootstrap';

/**
 * 编辑器页（`/editor`，清单 C 区对标页族的外围骨架）。
 *
 * 注意：本页是服务端组件，不直接用浏览器 API；壳层、插槽宿主与本页唯一渲染的
 * 客户端引导件都是客户端组件。
 */
export default function EditorPage() {
  return (
    <>
      <EditorShell />
      <EditorBootstrap />
    </>
  );
}
