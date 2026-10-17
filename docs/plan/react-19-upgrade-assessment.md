# React 19 升级评估（Next.js 16 口径）

- 状态：**评估完成，本批不升级**（实际升级另立票）
- 票号：改进批次 5 · 工作包 G（#46）
- 评估日期：2026-10-17
- 评估基线：`integration/batch5` @ `c6b1654`（与 `main` 含 PR #45 的 tip 一致）
- 取证环境：Node `v24.9.0`、pnpm `10.33.2`；本机 `pnpm install --frozen-lockfile` 与 `next build` 均已实际执行（见附录 A）
- 结论摘要：**建议另立票升级，本批不升级**。以本仓当前使用面看，升级属**低—中风险、小工作量**：主要成本在 catalog、锁文件与少量类型/测试修补；不存在 React 19 专属 API 的硬阻塞。建议时机为 REF-01 参照集冻结之后、Next 17 升级之前。

> 本文只做评估与方案，不修改任何依赖版本、`pnpm-lock.yaml` 或业务代码。

## 1. 现状（本仓实测）

### 1.1 版本锁定（单一真源：`pnpm-workspace.yaml` 的 `catalog:`）

| 依赖 | catalog 写法 | 实际解析/安装 | 说明 |
|---|---|---|---|
| `next` | `16.4.1` | `16.4.1` | Next 16 App Router；构建使用 Turbopack |
| `react` | `18.3.1` | `18.3.1` | 运行时 |
| `react-dom` | `18.3.1` | `18.3.1` | 运行时 |
| `@types/react` | `^18.3.31` | `18.3.31` | 类型 |
| `@types/react-dom` | `^18.3.7` | `18.3.7` | 类型 |
| `@testing-library/react` | `^16.3.3` | `16.3.3` | 组件测试（RTL 16） |
| `@testing-library/dom` | 未直接声明 | `10.4.2`（RTL 传递依赖） | RTL 16 的 peer |
| `@testing-library/user-event` | `^14.6.8` | `14.6.8` | 交互测试 |
| `jsdom` | `^30.1.3` | `30.1.3` | 组件测试 DOM |
| `vitest` | `5.0.5` | `5.0.5` | 测试运行器 |
| `typescript` | `~5.9.3` | `5.9.3` | TypeScript strict |
| `electron` | `44.7.2` | `44.7.2` | 桌面壳；**不依赖 React** |

环境口径：根 `package.json` 锁 `pnpm@10.33.2`、`engines.node >= 22`；CI 用 Node 22（`.github/workflows/ci.yml`），开发机为 Node 24。Next 16.4.1 自身 `engines.node >= 20.9.0`，与 CI 的 Node 22 相容。

`pnpm install --frozen-lockfile` 实测：`Lockfile is up to date, resolution step is skipped`，10 个 workspace 项目、184 个包，安装成功；本次评估**未改动 lockfile**。

### 1.2 哪些包使用 React

`pnpm why -r react` 实测只有 **1 个 React 版本**（`18.3.1`），来源为：

```
react@18.3.1
├── @dforge/ui (devDependencies)
├── @dforge/web (dependencies)
├─┬ @testing-library/react@16.3.3
├─┬ next@16.4.1
├─┬ react-dom@18.3.1
├─┬ styled-jsx@5.1.6（next 传递依赖）
└─┬ zustand@5.0.15
```

按包统计（`grep -rl "from 'react'"`，含 `react-dom` 另计）：

| 包 | 导入 `react` 的文件 | 导入 `react-dom*` 的文件 | 测试文件 | 说明 |
|---|---:|---:|---:|---|
| `apps/web` | 91 | 12 | 155 | Next App Router 主体；122 个非测试文件标 `'use client'` |
| `packages/ui` | 17 | 0 | 13 | 设计系统组件；`react`/`react-dom` 在 devDependencies，peer 为 `>=18` |
| `packages/engine` | 0 | 0 | — | 纯 TS 零 DOM |
| `packages/contracts` | 0 | 0 | — | 纯类型/契约 |
| `apps/daemon` | 0 | 0 | — | Fastify 5 |
| `apps/desktop` | 0 | 0 | — | Electron 主进程/预加载；装载 web 产物 |
| `services/*`、`tools/cli` | 0 | 0 | — | 无 React |

`react-dom` 的 12 个导入文件集中在：`createPortal`（Overlay / Modal / Drawer / command-palette，4 个文件）、`react-dom/server` 的 `renderToStaticMarkup`（7 个测试文件）、`react-dom/client` 的 `createRoot` + `react-dom` 的 `flushSync`（`CreateDocumentDialog.test.tsx`，1 个文件，用于竞态测试）。

### 1.3 关键 API 使用面（静态清点）

以下为 `grep` 行数（不是语义级精确计数，但足以判断影响面）：

| API/模式 | 数量 | 备注 |
|---|---:|---|
| `useState` | 70 | 常规状态 |
| `useEffect` | 68 | 常规副作用 |
| `useCallback` | 64 | 常规记忆化 |
| `useMemo` | 24 | 常规记忆化 |
| `useRef` | 54 处（含泛型书写） | **未发现零参 `useRef()`**；全部传入初值 |
| `useId` | 11 | 用于 `aria-labelledby`/`aria-describedby`/表单 id |
| `useSyncExternalStore` | 13 处 / 12 个文件 | 文档快照、命令表、画布 HUD、插槽等外部 store 订阅 |
| `useContext` | 5 | 常规 context 读取 |
| `useReducer` | 1 | **未使用泛型参数** |
| `forwardRef` | 3 个组件 | `Button` / `Input` / `IconButton` |
| `createContext` | 5 处 / 5 个文件 | 其中 `.Provider` 写法 7 个文件、14 处（含闭合标签） |
| `createPortal` | 4 个文件 | 浮层/弹窗 |
| `cloneElement` | 1 个文件 | `Tooltip` 的 `asChild` 分支 |
| React 19 专属 API | 0 | 未使用 `use` / `useActionState` / `useFormStatus` / `useOptimistic` |
| 服务端 Actions | 0 | 未发现 `'use server'` 或真实 `<form action={...}>` |
| 旧 API | 0 | 未发现 `ReactDOM.render` / `hydrate` / `findDOMNode` / 字符串 ref / `defaultProps` / `propTypes` / `react-test-renderer` / `react-dom/test-utils` 直接导入 |

类型面：`ReactNode` 出现在 39 个文件、105 次（含 import 行）；`ReactElement` 8 处；`React.MouseEvent`/`React.CSSProperties` 各 1 处；**未发现** `React.FC`、全局 `JSX.`/`React.JSX`、`MutableRefObject`、已移除的旧类型别名、`element.props` 直接访问（`Tooltip` 使用显式 `ReactElement<Record<string, unknown>>` 泛型）。

### 1.4 构建与测试基线

- `pnpm --filter @dforge/web build` 实测**成功**（退出码 0）：`Next.js 16.4.1 (Turbopack)`，编译 2.7s，TypeScript 7.5s，生成 13 条路由；**伴随 React 18 弃用警告**（原文见 §2.3）。
- 测试规模：`apps/web` 155 个测试文件（1343 个用例）+ `packages/ui` 13 个（165 个用例）；`apps/web` 中 76 个文件显式用 `// @vitest-environment jsdom`、其余默认 node，`packages/ui` 全部由配置走 jsdom；7 个页面/图标测试使用 `react-dom/server` 的 `renderToStaticMarkup`。
- `apps/web/vitest.config.ts` 使用 `oxc: { jsx: { runtime: 'automatic' } }`；`packages/ui/vitest.config.ts` 使用 `environment: 'jsdom'`；均与 React 19 的自动 JSX 运行时相容。
- 基线 `pnpm verify` **实测绿**（lint + typecheck + test，退出码 0；`apps/web` 155 文件/1343 用例、`packages/ui` 13 文件/165 用例全部通过）。`e2e:smoke` 属浏览器门禁，未在纯文档票中执行；升版票必须把它作为门禁，见 §4。

## 2. Next 16 与 React 19 的支持口径

### 2.1 官方口径（Next.js 文档）

Next.js 官方「React Version Support」页面（<https://nextjs.org/docs/messages/react-version>）明确：

> - React versions earlier than `18.2.0` are unsupported.
> - React 18.2 and later remain supported in Next.js 16, but React 18 support is deprecated.
> - React 19 is recommended for Next.js 16 and will be required in Next.js 17.
>
> React 19 includes features used by Next.js, such as Actions and improved hydration errors. Upgrade `react` and `react-dom` together to keep their versions in sync.
> If you use TypeScript, upgrade `@types/react` and `@types/react-dom` at the same time.

即：**本仓当前 `18.3.1` 在 Next 16 仍可用，但已弃用；Next 17 将强制 React 19**。升级不是「能不能」的问题，而是「在 Next 17 前必须做」的期限问题。

### 2.2 安装包层面的支持范围

`next@16.4.1` 自带 `peerDependencies`（本机 `node_modules/.pnpm/next@16.4.1.../node_modules/next/package.json`）为：

```json
"react": "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0",
"react-dom": "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0"
```

因此 Next 16.4.1 对 React 19 是**正式支持**，不是试配。React 18 的弃用是**构建期警告**（本次在 `next build` 启动阶段复现），不是 peer 阻断：

- 警告常量位于 `node_modules/.pnpm/next@16.4.1.../node_modules/next/dist/server/config.js`：
  `REACT_18_DEPRECATION_WARNING = 'React 18 support is deprecated in Next.js 16 and will be removed in Next.js 17. Please upgrade to React 19. Learn more: https://nextjs.org/docs/messages/react-version'`
- 该警告在 `next build` 启动阶段打印一次，构建仍继续并以 0 退出。

### 2.3 构建警告的实际文本（本机复现）

执行：

```bash
pnpm --filter @dforge/web build
```

输出（节选，退出码 0）：

```
▲ Next.js 16.4.1 (Turbopack)
⚠ React 18 support is deprecated in Next.js 16 and will be removed in Next.js 17. Please upgrade to React 19. Learn more: https://nextjs.org/docs/messages/react-version
✓ Running next.config.ts took 227ms

  Creating an optimized production build ...
✓ Compiled successfully in 2.7s
  Running TypeScript ...
  Finished TypeScript in 7.5s ...
✓ Generating static pages using 15 workers (13/13) in 711ms
```

结论：警告文本与 Next 源码常量一致；升级到 React 19 后该警告应消失（升版票以此作为验收点之一）。

### 2.4 React 19 的收益（与本仓的相关度）

| React 19 能力 | 本仓相关度 | 说明 |
|---|---|---|
| Actions（`useActionState` / `useFormStatus` / `useOptimistic`） | 低（当前未用） | 本仓没有服务端 Actions；主要收益是未来表单/异步交互可减样板 |
| `use`（读 Promise/Context） | 低（当前未用） | 可作为未来异步数据读取的选项；本仓外部 store 走 `useSyncExternalStore` |
| `ref` as prop（函数组件直接收 `ref`） | 中 | 3 个 `forwardRef` 组件可简化，但**不必在升级票里做**；`forwardRef` 在 19 仍可用 |
| ref cleanup 函数 | 低 | 本仓 2 处内联 ref 回调均为块体、返回 `undefined`，不依赖 `null` 回调语义 |
| `<Context>` 直接作 Provider | 低 | 7 个文件、14 处 `.Provider`（含闭合标签）仍受支持；可留作后续重构 |
| Hydration 错误改善（单条 diff 错误） | 中 | 静态导出/SSR 页面受益；同时也意味着**更严格/更易定位**的水合问题会在升版后暴露 |
| 文档元数据、样式表/脚本提升、预加载 API | 低 | 本仓由 Next App Router 管理，未直接使用 |
| 错误上报（`onCaughtError` / `onUncaughtError`） | 低 | 生产错误边界仅 Next `error.tsx`；测试中有 class 边界，行为不变 |

**升级动机**：主要是「消除弃用、对齐 Next 16 推荐组合、为 Next 17 铺路」，不是「本仓急需某个 React 19 API」。因此升级票应保持**纯依赖/兼容性升级**，不夹带 `forwardRef`/Context 重构或新功能。

### 2.5 是否存在 React 19 专属 API 的阻碍

**未发现硬阻塞**：

- 业务代码没有使用任何 React 19 才有的 API（见 §1.3），因此不需要为了编译而升级。
- 反过来，也没有使用 React 19 移除的旧 API（`ReactDOM.render`/`hydrate`/`findDOMNode`、字符串 ref、函数组件 `defaultProps`/`propTypes`、`react-dom/test-utils` 直接导入等），因此运行时移除项不构成迁移工作。
- 唯一需要确认的是**类型包**与**测试库**的兼容性（§3.1/§3.3），两者在版本声明上均已支持 React 19。

## 3. 影响面

### 3.1 类型（`@types/react` 18 → 19）

React 19 的类型破坏面与「本仓暴露」对照：

| 类型变化 | 本仓暴露 | 预计动作 |
|---|---|---|
| 全局 `JSX` 命名空间移除，改用 `React.JSX` / `import type { JSX } from 'react'` | `grep "JSX\.\|React\.JSX"` 为 0 | 无；若未来做 JSX 扩展，`jsx: "preserve"` 下用 `declare module "react"` |
| `ReactNode` 容纳 `bigint` / async 内容（`Promise`），联合类型变宽 | 39 个文件、105 次出现（含 import）；均为 children/节点透传，未做穷举收窄 | 预计无破坏；以 `tsc --noEmit` 实测为准 |
| `ReactElement` 的 `props` 默认从 `any` 变为 `unknown` | 无 `.props` 访问；`Tooltip` 已显式 `ReactElement<Record<string, unknown>>` | 无；若升版后出现，补显式泛型 |
| `useRef` 必须传初始参数，零参重载移除 | 54 处均带初值；`grep "useRef()"` 为 0 | 无 |
| ref 回调返回类型收紧（只允许 `void` 或 cleanup 函数） | 2 处内联 ref 回调均为块体；`assignRef` 显式 `: void` | 无；禁止改成简写箭头隐式返回 |
| `MutableRefObject` 等旧类型移除/合并 | 0 引用 | 无 |
| `useReducer` 泛型签名变化 | 1 处，未使用泛型 | 无 |
| 已移除的旧类型别名（`ReactChild`、`SFC` 等） | 0 引用 | 无 |
| `@types/react-dom` 必须与 `@types/react` 同 major | catalog 同时锁 `^18.3.x` | 升版时**两者一起**改到 19 |

补充：本仓 `tsconfig.base.json` 开了 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`，React 19 类型可能让少数 props 的可选性与 `undefined` 处理更严格；这是升版票最可能出现的真实修补点，需预留时间（预计个位数文件）。

### 3.2 组件

- **`forwardRef`（3 个）**：`packages/ui/src/components/Button.tsx`、`Input.tsx`、`IconButton.tsx`。React 19 仍支持 `forwardRef`，官方仅表示未来会弃用；**升级票不改**，避免把依赖升级与组件重构混在一起。后续可另立「ref as prop」重构票。
- **Context Provider（7 个文件、14 处 `.Provider`，含闭合标签）**：React 19 仍支持；`<Context value>` 简写是可选收益，不在升级票做。
- **`createPortal`（4 个文件）**：API 不变。
- **`cloneElement`（`Tooltip`）**：React 19 仍支持；现有显式泛型可继续编译。
- **错误边界**：生产只有 Next `error.tsx`（函数组件，接收 `error`/`reset`）；测试中有 class 边界。React 19 改变的是错误「再抛出」行为（未捕获到 `window.reportError`、被捕获到 `console.error`），不影响现有边界渲染逻辑，但升版后需跑错误态测试。
- **StrictMode**：`next.config.ts` 为 `reactStrictMode: true`。React 19 在 dev 下仍会双调用 ref 回调/effect；本仓 ref 回调只做 map 注册/清理，预期无问题；生产构建不受影响。

### 3.3 测试

- **RTL 16.3.3 明确支持 React 19**：本机 `@testing-library/react/package.json` 的 peer 为
  `"react": "^18.0.0 || ^19.0.0"`、`"react-dom": "^18.0.0 || ^19.0.0"`、`"@types/react": "^18.0.0 || ^19.0.0"`。
- RTL 的 `act-compat.js` 逻辑为 `typeof React.act === 'function' ? React.act : DeprecatedReactTestUtils.act`：React 19 下优先走 `React.act`，不依赖已移除的 `react-dom/test-utils.act`。本仓也没有任何直接导入 `react-dom/test-utils` 或 `act` 的测试。
- `@testing-library/dom@10.4.2`、`@testing-library/user-event@14.6.8`、`jsdom@30.1.3`、`vitest@5.0.5` 均为当前 RTL 16 的常规组合；`user-event` 只要求 `@testing-library/dom >= 7.21.4`，与 React 版本无直接 peer 约束。
- 测试环境：`apps/web` 155 个测试文件中 76 个显式 jsdom、其余默认 node；`packages/ui` 13 个全部走 jsdom 配置。7 个页面/图标测试用 `renderToStaticMarkup`，1 个用 `createRoot` + `flushSync`；没有 `react-test-renderer`、没有 `act` 直接调用。
- **`useId` 格式变化**：React 19 将 `useId` 生成的 id 从 `:r123:` 改为 `«r123»`（见 React CHANGELOG 19.0 条）。本仓测试通过 `getAttribute('aria-labelledby')` 再 `getElementById` 动态读取，不硬编码格式；也未发现基于 id 的 CSS 选择器。风险低，但仍应在升版后跑 `a11y-keyboard` 与组件测试确认。
- 预期真实修补点：若 React 19 的 act/警告更严格，可能出现少量 `act(...)` 警告或异步 `await` 时序断言需要调整；RTL 版本本身不需要升级（16.3.3 已声明 19 兼容）。

### 3.4 打包/构建

- Next 16.4.1 + Turbopack 已是当前构建链；React 19 是 Next 16 的推荐组合，构建方式不变。`next build` 会在编译期跑 TypeScript，因此类型问题会直接阻断构建。
- `apps/web/next.config.ts` 的 `transpilePackages: ['@dforge/ui', '@dforge/contracts', '@dforge/engine']` 不变；`@dforge/ui` 的 peer `react >=18`/`react-dom >=18` 对 19 成立，无需改 peer 范围（如需表达「只支持 18/19」，可另行收紧，但不是必需）。
- 传递依赖的 peer 均兼容：`zustand@5.0.15` 要求 `react >=18.0.0`；`styled-jsx@5.1.6` 的 peer 含 `^19.0.0-0`；`next@16.4.1` 见 §2.2。
- 静态导出（`output: 'export'`）目前仍是注释预留；React 19 不改变该路径，但升版后应至少跑一次 `next build` + `next start`（或现有浏览器门禁）验证生产产物。
- 不存在 UMD 构建依赖（React 19 移除 UMD）或 `react-dom/test-utils` 运行时代码（测试链除外）。

### 3.5 桌面壳、浏览器门禁与 CI

- **桌面壳**：`apps/desktop` 零 React 导入；Electron 44.7.2 只负责窗口/装载/安全基线，装载目标是 dev URL、`apps/web/out` 静态产物或壳内诊断页（`resolveLoadPlan`）。React 版本只随 web 产物走，**桌面壳不需要单独升级**；Electron 44 的 Chromium 版本远高于 React 19 所需的 DOM 能力。
- **浏览器门禁**：`e2e:smoke`、`verify:canvas`、`verify:shell-parity` 通过 Playwright 操作真实 DOM，选择器是外部行为（`data-df-*`/role/label），不依赖 React 内部实现；React 19 不应改变这些挂点。`verify-figma-*` 在 REF-01 前仍为 `exit 2`（阻塞），不能作为升级的视觉判据；升级票应以 `e2e:smoke` + `verify:canvas`（可用时）+ `next build` 为主要行为门禁。
- **CI**：Node 22 满足 Next 16 的 `>=20.9.0` 与根 `>=22`；CI 不拉 Electron 二进制，不受桌面壳影响。`pnpm install --frozen-lockfile` 要求 catalog/lockfile 同步更新，否则 CI 首步即失败（这是升版票的必检项）。

### 3.6 文档漂移清单（升版票收尾时同步）

以下文档/描述仍写「React 18」，实际升级后应同步（spec 类文档如涉及规格变更，按变更纪律由规格 owner 决定，不在普通升级票里擅自改）：

- `apps/web/package.json` 的 `description`（"React 18"）
- `README.md` 第 50 行附近（`apps/web` 技术栈描述）
- `docs/plan/skeleton-and-package-layout-v1.md` 的包布局注释
- `docs/plan/architecture-v1.1.md` 的技术栈段与选型表
- `docs/spec/frontend-impl-spec-v1.md` 的技术栈条目（spec，需 owner 确认）
- `docs/architecture/enterprise-architecture-v1.md` 的技术栈表与 A-09 架构债条目

## 4. 分步迁移方案（另立票执行）

### 4.1 原则

1. **一票一树**：从最新 `main`（或届时集成分支）拉 `chore/react19`，不与其他功能票混做。
2. **版本单一真源**：只改 `pnpm-workspace.yaml` 的 `catalog:`，各包继续用 `catalog:`；不散写版本号。
3. **react 与 react-dom 同版本**、`@types/react` 与 `@types/react-dom` 同 major；升版票按当时 registry 稳定版定版，不用 canary/RC。
4. **不夹带重构**：`forwardRef` → ref as prop、`Context.Provider` → `<Context>` 均留到后续独立票。
5. **每步一个提交**，保证可单独 revert；未通过门禁不合并。

### 4.2 步骤、判据与回滚点

| 步骤 | 动作 | 命令/判据 | 回滚点 |
|---|---|---|---|
| 0. 基线 | 拉工作树；记录当前构建警告、测试与 e2e 基线；确认 `pnpm why -r react` 只有 18.3.1 | `pnpm install --frozen-lockfile`；`pnpm verify`；`pnpm --filter @dforge/web build`；可跑则 `pnpm e2e:smoke`；保存输出 | 基线提交（不改依赖） |
| 1. 升类型 | catalog 改 `@types/react`/`@types/react-dom` 到 19.x；`pnpm install`；只修**类型层**问题 | `pnpm typecheck` 全绿；`pnpm test` 仍绿（运行时还是 React 18）；**不得**在此阶段使用 ref-as-prop 等 19 运行时特性 | revert catalog + lockfile；`pnpm install --frozen-lockfile` |
| 2. 升运行时 | catalog 改 `react`/`react-dom` 到同一 19.x；`pnpm install`；确认无第二份 React | `pnpm why -r react` 仍只有 1 个版本；`node_modules/.pnpm` 无 `react@18`；`pnpm typecheck`；`pnpm test`；`next build` 不再出现 React 18 警告 | revert catalog + lockfile；重装并重建 |
| 3. 修类型/测试 | 按实际报错修；只做兼容性修补；测试断言仍只面向外部行为 | `pnpm -r typecheck`、`pnpm -r test` 全绿；无新增 lint 抑制 | 每个修复提交单独 revert |
| 4. 全量门禁 | 全量 verify + 构建 + 浏览器门禁 | `pnpm verify`；`pnpm --filter @dforge/web build`（0 警告）；`pnpm e2e:smoke`；`pnpm verify:canvas`（可用时）；`pnpm verify:shell-parity`（0 或 2，**不得 1**）；`verify-figma-*` 预期 2；CI 绿 | 回退到步骤 2 或整个 PR |
| 5. 收尾 | 更新 §3.6 文档/描述；PR 写清真实门禁输出；确认 lockfile 只含预期变化 | `git diff` 审查 lockfile；`pnpm install --frozen-lockfile` 在干净环境通过；CI 绿 | 整个 PR revert |

### 4.3 关于「先升 types 再升 runtime」的顺序

票面要求先升 types、再升 runtime。这个顺序可行，但要注意：

- 类型包升级后、运行时仍是 18 的窗口期内，**只能修类型错误，不能采用 React 19 专属运行时行为**（例如函数组件直接声明 `ref` prop 并期望它被转发；React 18 不会转发，运行时会告警/失效）。
- 官方建议 react/react-dom 与类型「一起升」；本方案的拆步只为**缩小每步的失败面**，两步应在同一个 PR 内完成，不把中间状态合入 `main`。
- 如果拆步导致修复量反而变大（类型先报错、运行时又变），可直接合并为一步（types + runtime 同一提交），判据不变。

### 4.4 版本选择建议

- 以另立票开工时的 registry 稳定版为准。评估日（2026-10-17）查询结果：`react@19.3.1`、`@types/react@19.3.0`、`@types/react-dom@19.3.0` 可用；`react-dom@19.3.1` 的 peer 为 `react ^19.3.1`（所以两者必须同版）。
- 本仓 Next 仍锁 `16.4.1`（registry 已有 `16.4.2`，但**不在本评估范围**，升级 Next 与升级 React 分开做）。
- 不使用 `^19` 浮动范围到 catalog 之外；catalog 写精确版本或与现有风格一致的范围，由升版票决定并锁进 lockfile。

### 4.5 建议的验收集（升版票 DoD）

1. catalog 中 `react`/`react-dom`/`@types/react`/`@types/react-dom` 均到 19.x，lockfile 同步。
2. `pnpm why -r react` 只有 1 个版本；无 `Invalid hook call` / 双 React 实例。
3. `pnpm verify` 全绿（lint + typecheck + test）。
4. `pnpm --filter @dforge/web build` 成功，**React 18 弃用警告消失**。
5. `pnpm e2e:smoke` 绿；`verify:canvas` 可用则绿；`verify:shell-parity` 不出现 exit 1。
6. 浏览器门禁三态语义不被破坏：figma 族仍为 exit 2（参照集未冻结），不得假绿。
7. §3.6 文档同步；PR 附真实输出摘要与回滚说明。

## 5. 风险与回滚

| 风险 | 可能性/影响 | 缓解与判据 |
|---|---|---|
| 锁文件大 diff / CI `--frozen-lockfile` 失败 | 中/中 | 只通过 `pnpm install` 生成 lockfile；不手改；PR 审查只允许 react/react-dom/types 相关条目与 peer 后缀变化；CI 首步验证 |
| 双 React 副本（hooks/context 失效） | 低/高 | catalog 单一真源；升级后 `pnpm why -r react` 必须 1 个版本；若传递依赖锁旧版 `react`/`@types/react`，用 `pnpm.overrides` 统一（当前 `pnpm why -r react` 只有 1 个版本） |
| 类型修补超出预期（`exactOptionalPropertyTypes` + 19 类型） | 中/中 | 先跑 `pnpm -r typecheck` 量化；预计个位数文件；不为过类型而改业务行为 |
| 水合/错误上报行为变化 | 低/中 | `next build` + 生产 `next start` + `e2e:smoke`；关注控制台 hydration 错误；错误态测试回归 |
| `useId` 格式变化影响断言/样式 | 低/低 | 本仓动态读取 id，无格式硬编码；升版后跑 `a11y-keyboard` 与 UI 组件测试 |
| StrictMode 下 ref 回调/effect 双调用暴露副作用 | 低/中 | 现有 ref 回调只做注册/清理；dev 下观察；生产不受影响 |
| RTL/测试链与 React 19 的实际兼容差异 | 低/中 | RTL 16.3.3 peer 已声明 19；以 `pnpm test` 实测；如需升级 RTL，单独评估，不混入 |
| 浏览器视觉门禁暂不可用（REF-01 未冻结） | 高/中 | 升级票以 e2e/行为门禁为准；视觉对照延后到 REF-01 冻结后复跑；不得把 exit 2 当绿 |
| 桌面壳产物不一致 | 低/低 | 壳不依赖 React；升级后重新 `next build`/静态导出再装载；壳门禁跑 0/2 |
| CI Node 22 与本地 Node 24 差异 | 低/低 | Next 16 要求 `>=20.9`；CI 已用 22；升级前后都在 CI 跑同一链路 |

### 5.1 回滚步骤

1. 回退升版提交（catalog + `pnpm-lock.yaml` + 兼容性修补），保持业务提交不动。
2. `pnpm install --frozen-lockfile` 重新装回 React 18 组合。
3. `pnpm --filter @dforge/web build` 重建；如桌面壳装载静态产物，替换回旧产物。
4. `pnpm verify` / `e2e:smoke` 复跑确认回到基线。
5. 因无数据格式/协议变更，**不涉及数据迁移**；回滚只影响前端依赖与构建产物。

### 5.2 建议的回滚触发条件

- 升版后 1 个工作日内无法让 `pnpm verify` 全绿，且修复需要改动业务语义；
- `e2e:smoke` 出现与 React 19 相关的稳定失败（非环境问题）；
- 生产构建/水合出现无法解释的错误，或双 React 实例无法消除；
- 浏览器门禁出现 exit 1（真实违规）而非 exit 2（阻塞）。

## 6. 结论与建议

**结论：建议另立票升级 React 19；本批（改进批次 5）不升级。**

理由：

1. 本仓没有 React 19 专属 API 的硬依赖，也没有被 React 19 移除的旧 API；升级是**兼容性/期限驱动**，不是功能驱动。
2. Next 16 官方明确「React 19 推荐、Next 17 强制」；继续停留在 18.3.1 只会累积警告，并把压力推到 Next 17 升级票。
3. 使用面集中（`apps/web` + `packages/ui`），类型/测试风险可枚举，预计工作量小（0.5–1.5 个工作日量级，不含浏览器门禁环境搭建）。
4. 当前批次 5 的主题是可测性与工程卫生；把依赖大版本升级混进来会扩大 diff 与回滚面。

**建议时机与前置条件**：

- 时机：**REF-01 参照集冻结之后**（这样 figma/视觉门禁能真正验证，而不是只能 exit 2），且**在任何 Next 17 升级之前**；最好单独一个短批次，不与功能票并行。
- 前置：基线 `pnpm verify` + `e2e:smoke` 绿；无其他进行中的 UI/测试大改分支；CI 保持 Node 22；规格 owner 同意 §3.6 的文档漂移同步方式。
- 不建议：与 Next 17 升级、React Compiler 接入、`forwardRef` 重构或功能开发合并到同一票。

**本批交付边界**：本文只登记评估结论、影响面、分步方案与回滚；不改 catalog、不改 lockfile、不改源码。实际升级由另立票执行。

## 附录 A：取证命令与关键输出

以下命令均在评估工作树 `/home/QIU/df-wt/b5-g` 执行，基线 `c6b1654`。

| 命令 | 关键输出 |
|---|---|
| `pnpm install --frozen-lockfile` | `Lockfile is up to date, resolution step is skipped`；`Scope: all 10 workspace projects`；成功 |
| `pnpm list -r --depth 0` | `next@16.4.1`、`react@18.3.1`、`react-dom@18.3.1`、`@types/react@18.3.31`、`@types/react-dom@18.3.7`、`@testing-library/react@16.3.3`、`jsdom@30.1.3`、`vitest@5.0.5`、`typescript@5.9.3`、`electron@44.7.2` |
| `pnpm why -r react` | `Found 1 version of react`（18.3.1） |
| `pnpm why -r react-dom` | `Found 1 version of react-dom`（18.3.1） |
| `pnpm --filter @dforge/web build` | 退出码 0；`Next.js 16.4.1 (Turbopack)`；打印 §2.3 的 React 18 弃用警告；13 条路由生成成功 |
| `pnpm verify` | 退出码 0；lint（Biome，根 scripts/.github 111 文件 + 各包）+ 全包 `tsc --noEmit` + 全包 vitest 全绿；`apps/web` 155 文件/1343 用例、`packages/ui` 13 文件/165 用例 |
| `grep -rl "from 'react'" apps packages --include="*.ts" --include="*.tsx"` | 108 个文件（web 91 + ui 17） |
| `grep -rl "from 'react-dom" ...` | 12 个文件 |
| `grep -rl "use client" apps/web/src ... \| grep -v "\.test\."` | 122 个文件 |
| `grep -rn "useRef()"` | 0 |
| `grep -rn "JSX\.\|React\.JSX"` | 0 |
| `grep -rn "MutableRefObject\|ReactChild\|SFC<"` | 0 |
| `grep -rn "react-dom/test-utils\|ReactDOM\.render\|findDOMNode\|defaultProps\|propTypes"` | 0 |
| `pnpm view react@19 version`（2026-10-17） | 最新列出 `19.3.1` |
| `pnpm view @types/react@19 version` | 最新列出 `19.3.0` |
| `pnpm view @types/react-dom@19 version` | 最新列出 `19.3.0` |
| `pnpm view react-dom@19.3.1 peerDependencies` | `{ react: '^19.3.1' }` |
| `pnpm view next@16 version` | 最新列出 `16.4.2`（本仓仍锁 `16.4.1`） |

## 附录 B：未在本机验证的事项（避免误读）

- **没有实际安装/运行 React 19**：本文不做升级，因此 `@types/react@19` 下的真实 `tsc` 结果、React 19 下的测试结果均为**预估**；升版票必须以真实门禁输出为准。
- **没有跑 `e2e:smoke` 等浏览器门禁**：本文是文档票；`pnpm verify` 与 `next build` 已实测，浏览器行为门禁留给升版票步骤 0/4。
- **浏览器视觉门禁当前不可用**：`verify-figma-*` 在 REF-01 冻结前按纪律 `exit 2`，本文不将其作为升级判据。
- **registry 版本是评估日快照**：`pnpm view` 结果只用于说明 19.x 可用，不作为升级票的锁版依据；锁版以升级票执行时的稳定版与 lockfile 为准。

## 附录 C：参考

- Next.js · React Version Support：<https://nextjs.org/docs/messages/react-version>
- React 19 发布说明：<https://react.dev/blog/2024/12/05/react-19>
- React 19 升级指南（破坏性变更/类型变化）：<https://react.dev/blog/2024/04/25/react-19-upgrade-guide>
- React CHANGELOG（`useId` 格式变化等）：<https://github.com/facebook/react/blob/main/CHANGELOG.md>
- 本仓：`pnpm-workspace.yaml`、`package.json`、`apps/web/package.json`、`packages/ui/package.json`、`apps/web/next.config.ts`、`apps/web/vitest.config.ts`、`.github/workflows/ci.yml`
