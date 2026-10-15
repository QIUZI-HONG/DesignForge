# 设界 · DesignForge

毕业设计：类 Figma 设计工作台（本地优先）。

**三条支柱**：本地真值（`.dfg` 目录态、可 Git diff、离线完整可用）· 受控 AI（自然语言 → Design IR → 双重校验 → 逐项 diff 审批 → 单事务 → 审计回放）· 数据飞轮（GitHub 技能大数据市场：采集 → 四层仓库 → 五维评分 → 混合检索 → 采纳回流）。

**AI 边界**：文本上云（DeepSeek，用户自带 key，可脱敏、可关闭）＋ 图像本地（ComfyUI，零出机、零成本、可复现）。

**接入**：MCP 双端——ZCode 与 WorkBuddy 读写同一份设计真值。

## 状态

起步中（P0）。寻路地图见 Issues 的 `wayfinder:map`；当前一段的目的地 = 前端对标 Figma 本体可验收 + 技能市场首个实现跑通。

## 工程启动

环境：Node ≥ 22（开发机 node 24）+ pnpm 10.33.2（由根 `packageManager` 锁定，建议 `corepack enable`）。

```bash
pnpm install                 # 工作区安装（版本统一走 pnpm-workspace.yaml 的 catalog:）
pnpm --filter @dforge/web dev # 起前端开发服务器（Next.js 16 App Router）
pnpm lint                    # 逐包 lint + 根 scripts 门禁脚本 lint（Biome）
pnpm typecheck               # 逐包 tsc --noEmit
pnpm test                    # 逐包 vitest
pnpm verify                  # 上三者串跑（与 CI 同一条链）
```

浏览器门禁（`verify-figma-*` / `verify-canvas` / `e2e:smoke`）为**挂点**，随对应实现票接入，
当前不接 CI。四守卫 `guard:deps` 等脚本未实现时 `exit 2`（阻塞语义，禁假绿）。

## 目录地图

```
apps/web          Next.js 16 App Router + React 18 前端（zh-CN 唯一暴露，i18n 在 apps/web/messages）
apps/desktop      Electron 最小壳（FE-12 落地；安全基线断言挂点）
apps/daemon       Fastify 5 本地服务（文档/导出/AI 代理/出图调度/市场/本地遥测）
packages/engine   编辑器内核（纯 TS 零 DOM：场景图/命令栈/布局/令牌/命中）
packages/ui       设计系统（浅色/深色双基准令牌 × 密度映射；组件禁裸值）
packages/contracts 共享类型与契约（Design IR / marketplace.index / 跨进程事件）
services/ingest   采集与市场数据管线（采集→四层→评分→索引）
services/comfy    出图适配（本地 ComfyUI 客户端；未启动态是验收对象）
tools/cli         CLI `df`（首批 df market collect|score|index|search）
scripts/          工程脚本与门禁挂点（guard-*.mjs）
docs/             adr / agents / plan / spec（骨架与布局见 docs/plan/skeleton-and-package-layout-v1.md）
```

**实施纪律**（工作树 / 门禁退出码 / 合并卫生 / 代码规范）见 `docs/agents/implementation-workflow.md`。

## 历史

前置实现（M0–M3：在线协同画布 + AI 生成，12 条浏览器验收门禁全绿）冻结于 [`DesignForge-legacy`](https://github.com/QIUZI-HONG/DesignForge-legacy)，仅作历史参照。本项目全新自研（clean-room：只借公开可观测的产品结构与交互范式，不取用第三方源码与资产）。
