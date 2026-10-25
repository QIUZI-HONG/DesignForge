# 编辑器路由（`/editor`）· FE-03 已落地

本目录是编辑器族（清单 C 区，深色对标页）的 App Router 落点，**归 FE-03**。
口径：`docs/spec/page-inventory-v1.md`（清单 C 区）+ `docs/spec/acceptance-standard-v1.md`。

## 现状（FE-03 + 工单 02 引导收口之后）

- `layout.tsx`：深色基准（`data-theme="dark"` 落根元素 + 首帧内联脚本）+ `CanvasHudProvider`；
- `page.tsx`：挂 `<EditorShell />` 与**唯一客户端引导件** `<EditorBootstrap />`；
- `editor-bootstrap.tsx`：声明式注册表——全部插槽挂载（`EDITOR_SLOT_DECLARATIONS`）与
  域登记项（`EDITOR_BOOTSTRAP_ENTRIES`）在此声明，引导挂载后（effect）统一执行；
  服务端/客户端首帧一致（服务端空槽形态 = 客户端首帧形态）由此统一保证。

壳层实现全在 `apps/web/src/features/editor-shell/**`（含样式 `editor-shell.css`；
引导机制层在 `features/editor-shell/bootstrap/registry.ts`）。
两个冻结接口（供后续票消费，签名见 `features/editor-shell/index.ts` 头注释）：

- 命令注册表：`registerCommand({ id, title, group, shortcut?, enabled?, run })` —— 注册即获得
  命令面板条目、快捷键说明条目与全局键盘派发；
- 画布 HUD：`useCanvasHud() → { show(text, options?), hide() }`。

## 后续票怎么挂进来（**不要改本目录的既有结构**；工单 02 口径）

插槽：在 `editor-bootstrap.tsx` 的 `EDITOR_SLOT_DECLARATIONS` 加一条声明（**唯一声明处**，
由引导统一执行，不再自带 `return null` 引导组件）：

```tsx
{ slot: 'canvas', id: 'fe-NN-xxx', order: 0, render: () => <YourComponent /> },
```

命令/接线：在自己的 `features/<id>/**` 里写 register 模块导出登记函数
（浏览器守卫 + 幂等，参照 `features/canvas/register.tsx` 的 `mountEditorWorkspace`），
加进 `editor-bootstrap.tsx` 的 `EDITOR_BOOTSTRAP_ENTRIES`（按声明顺序执行）；
渲染该登记项引用的组件即可把模块拉进首屏客户端图（裸 import 不进客户端图）。

槽位：`topbar-left` / `topbar-center` / `topbar-right` / `toolbar` / `left-panel` /
`canvas` / `right-panel` / `overlays`。归属建议：

| 票 | 槽位 | 说明 |
|---|---|---|
| FE-04 | `left-panel` | 图层面板 + 资产面板 |
| FE-05 | `right-panel` | Inspector（默认态/混选态/空选态） |
| FE-06 | `canvas` | 画布 + 覆盖层；HUD 走 `useCanvasHud()` |
| FE-07 | `topbar-right` / `overlays` / `toolbar` | 评论入口、Present 全屏层、版本抽屉 |
| FE-08 | `toolbar` / `right-panel` / `overlays` | 组件与检查/导出入口 |

本目录其余内容（顶栏/工具栏/壳层骨架）由 FE-03 维护；改结构前先读
`features/editor-shell/slots/registry.ts`、`features/editor-shell/bootstrap/registry.ts`
与 `features/editor-shell/index.ts` 的接口注释。
