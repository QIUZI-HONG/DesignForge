# 编辑器路由（`/editor`）· FE-03 已落地

本目录是编辑器族（清单 C 区，深色对标页）的 App Router 落点，**归 FE-03**。
口径：`docs/spec/page-inventory-v1.md`（清单 C 区）+ `docs/spec/acceptance-standard-v1.md`。

## 现状（FE-03 之后）

- `layout.tsx`：深色基准（`data-theme="dark"` 落根元素 + 首帧内联脚本）+ `CanvasHudProvider`；
- `page.tsx`：挂 `<EditorShell />`（顶栏三区 / 工具栏 / 三栏主体 / 命令面板 / 快捷键说明）。

壳层实现全在 `apps/web/src/features/editor-shell/**`（含样式 `editor-shell.css`）。
两个冻结接口（供后续票消费，签名见 `features/editor-shell/index.ts` 头注释）：

- 命令注册表：`registerCommand({ id, title, group, shortcut?, enabled?, run })` —— 注册即获得
  命令面板条目、快捷键说明条目与全局键盘派发；
- 画布 HUD：`useCanvasHud() → { show(text, options?), hide() }`。

## 后续票怎么挂进来（**不要改本目录的既有结构**）

各票在自己的 `features/<id>/**` 里写挂载模块，用具名插槽注册：

```ts
import { registerEditorSlotItem } from '@/features/editor-shell';
registerEditorSlotItem('canvas', { id: 'fe-06-canvas', render: () => <Canvas /> });
```

槽位：`topbar-left` / `topbar-center` / `topbar-right` / `toolbar` / `left-panel` /
`canvas` / `right-panel` / `overlays`。归属建议：

| 票 | 槽位 | 说明 |
|---|---|---|
| FE-04 | `left-panel` | 图层面板 + 资产面板 |
| FE-05 | `right-panel` | Inspector（默认态/混选态/空选态） |
| FE-06 | `canvas` | 画布 + 覆盖层；HUD 走 `useCanvasHud()` |
| FE-07 | `topbar-right` / `overlays` / `toolbar` | 评论入口、Present 全屏层、版本抽屉 |
| FE-08 | `toolbar` / `right-panel` / `overlays` | 组件与检查/导出入口 |

如需让挂载模块被路由加载，在 `page.tsx` 顶部加一行 `import '@/features/<id>/register';`（纯增量）。
本目录其余内容（顶栏/工具栏/壳层骨架）由 FE-03 维护；改结构前先读
`features/editor-shell/slots/registry.ts` 与 `features/editor-shell/index.ts` 的接口注释。
