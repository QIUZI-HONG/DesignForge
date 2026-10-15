# 工程骨架与包布局 v1（设界 · 寻路图 #13）

- 状态：**v1 定稿**（2026-10-15，#13 收口）
- 依据：设界架构说明 v1.1 §3/§6/§7 + 范围边界（#6）+ 研究 #5 环境实测
- 用途：供「新仓工程化落点」（#12）落地、「前端实现规格」（#11）与「市场首实现」（#10）引用

## 1. 判定

**pnpm workspace monorepo**（Node 22 LTS），本段实落「前端 + 市场」所需子集；包名前缀 `@dforge/*`，CLI 入口 `df`。

```
/
├── apps/
│   ├── web         # Next.js 16 App Router + React 18（前端主体；静态导出 output:'export' 口径预留）
│   ├── desktop     # Electron 最小壳（窗口 + 装载 + 安全基线守卫骨架）
│   └── daemon      # Fastify 5 本地服务（本段=前端所需子集：文档/导出/AI 代理/出图调度/凭据/市场服务/本地遥测）
├── packages/
│   ├── engine      # 编辑器内核（纯 TS 零 DOM：场景图/命令栈/布局/组件/Token/命中）
│   ├── ui          # 设计系统（令牌 + 组件；承载「浅色/深色双基准 × 密度」映射）
│   └── contracts   # 共享类型与契约（Design IR / marketplace.index / 事件）
├── services/
│   ├── ingest      # 采集与市场数据管线（独立可跑：采集→四层→评分→索引）
│   └── comfy       # 出图适配（本地 ComfyUI 客户端；未启动态是验收对象）
├── tools/
│   └── cli         # CLI `df`（首批：df market collect|score|index|search）
├── docs/           # adr / agents / plan / spec / research（现有）
└── scripts/        # 工程脚本与门禁挂点
```

## 2. 关键约定

- **命名**：workspace 包 = `@dforge/<name>`；应用与服务的 package name 同前缀（`@dforge/web` 等）；根包 `designforge`（private）。
- **i18n**：zh-CN 为主（ICU MessageFormat），en 仅工程兜底；**不暴露语言切换**（ADR-0003）。消息目录落 `apps/web`。
- **工具链最小集**：TypeScript（strict）+ Biome（lint/format）+ Vitest；根 `tsconfig.base.json` 共享。
- **CI（本段）**：安装 → 逐包 lint + typecheck → 根 scripts lint → workspace 全量 vitest。**浏览器门禁（verify-figma-* / verify-canvas / e2e:smoke）留挂点，随对应实现票接入**。
- **守卫预留名**（后续期落地）：`guard:deps`（依赖方向）/ `guard:electron-baseline`（安全基线）/ `guard:mcp-contract`（契约快照）/ `guard:channel-pairing`（通道配对）。
- **环境锁定**（研究 #5 实测：本机 node/pnpm 多份并存、含 Windows 侧与 corepack shim）：`engines.node >= 22` + `packageManager` 精确锁定；脚本一律经根 scripts 走。

## 3. 显式圈外（本段）

- daemon 握手全量（端口调度/令牌/数据目录协商）、更新通道（`df:update:*`）、Agent 运维通道（`df:agent:*`）。
- 四守卫全量（依赖方向 / Electron 基线 / MCP 契约快照 / 通道配对——仅预留名）。
- 多标签壳、托盘/浮层桥、跨窗口能力（P6）。
- 云侧（PG/pgvector、事件汇聚）与 `deploy/` 全套（后续期）。
