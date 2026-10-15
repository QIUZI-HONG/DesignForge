import { ReviewBootstrap } from '@/features/editor-review/register';
import { EditorShell } from '@/features/editor-shell';

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
 * 各票在自己的 `features/<id>/` 目录里写挂载模块，并在本文件里挂一次
 * （纯增量，见 `features/editor-shell/slots/registry.ts` 头注释）——
 * 已接线：FE-07 评审（命令 + canvas/right-panel/overlays 插槽，见 `features/editor-review/register.tsx`）。
 * 注：客户端模块**必须被渲染**才会进首屏客户端图（裸 import 不加载，实测入口仍禁用），
 * 因此 FE-07 用 `return null` 的 `<ReviewBootstrap />` 引导一次。
 * 注意：本页是服务端组件，不直接用浏览器 API；壳层与插槽宿主都是客户端组件。
 */
export default function EditorPage() {
  return (
    <>
      <EditorShell />
      <ReviewBootstrap />
    </>
  );
}
