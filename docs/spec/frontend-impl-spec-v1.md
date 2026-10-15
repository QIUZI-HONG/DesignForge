# 前端实现规格 v1（设界 · 寻路图 #11）

- 状态：**v1 定稿**（2026-10-15，#11 收口）
- 依据：设界架构说明 v1.1（§3/§4.3/§6）+ 骨架（#13）+ 验收标准 v1（#7）+ 范围边界（#6）+ 对照页面清单 v1（#8）
- 目的：把 54 项前端范围细到「**每票可直接开工**」——实现票 = FE-01 … FE-12。

## 一、实现决策

1. **技术栈**（v1.1 §6）：Next.js 16 App Router + React 18 + Zustand；画布 **CanvasKit（Skia WASM）**；Electron 最小壳；Fastify daemon（子集）。
2. **骨架**：按 `docs/plan/skeleton-and-package-layout-v1.md`；核心包 `@dforge/{engine,ui,contracts}`；本段实落。
3. **令牌与双基准**：`@dforge/ui` 承载两套基准令牌 + 密度映射——浅色（首页族：控件 32 / 主色 #0D99FF / 选中底 #E5F4FF / 描边 #E6E6E6 / 文字 #1E1E1E·#757575·#B3B3B3，圆角 3·6·8·13·999）↔ 深色（编辑器族：画布 #1E1E1E / 面板 #2C2C2C / 描边 #3E3E3E / AI 紫 #9747FF / 控件 28 / 胶囊 13）；组件**禁裸值**（守卫挂点 `guard:deps` 同族规则后续接入）。
4. **i18n**：zh-CN 唯一暴露（ICU MessageFormat），en 仅工程兜底文件；文案遵守术语对照表（清单附录 B 程序）；不提供语言切换（ADR-0003）。
5. **画布与编辑**（FE-06）：`packages/engine`（纯 TS 零 DOM）实现交互白名单 13 类所需内核（选择/移动/缩放/旋转/画布缩放/画布平移/复制粘贴/层级/编组/撤销/对齐/吸附/文本编辑）；文本编辑走 **DOM 覆盖层**（世界坐标对齐，旧仓先例）；性能硬指标（500 节点 ≥55FPS 等）**不在本段 DoD**（P1 基线另线）。
6. **壳**（FE-12）：`apps/desktop` 最小 Electron——窗口 + 装载 web + 安全基线断言骨架（contextIsolation=true / sandbox=true / nodeIntegration=false / webSecurity=true）。
7. **数据面**：daemon（apps/daemon）本段落前端所需子集——文档读写、导出（PNG/SVG/PDF 起步）、AI 代理（BYOK 凭据走 daemon 解密）、出图调度、市场服务、本地遥测；**MCP 确认走桩**（契约形状按 v1.1 §4.5.4：dryRun → 一次性 ackToken → 审计），网关归 P5；全部跨进程契约类型定义在 `@dforge/contracts`。
8. **状态边界**：文档状态归 engine（**不进 React state**）；Zustand 仅 UI 态（选择集/面板开合/视口）。渲染在 `requestAnimationFrame`；命令栈在微任务结算（旧仓不变式：写操作唯一入口）。

## 二、接缝与门禁（测试决策）

- **验收接缝** = 验收标准 §4：`verify-figma-*`（page/component/states/baseline）+ 功能断言；本段先落 `verify-canvas`（画布挂载 6 断言）与 `e2e:smoke`（10 步冒烟：拖画→持久化→导出/导入往返）形态（沿旧仓），随 FE-02 / FE-06 接入 CI 挂点。
- **每票 DoD**：lint / typecheck / vitest 绿 + 本票范围**对照证据**（截图 + 证据 JSON，字段按标准 §4）+ 差异 → 修复 → 复核 → 关闭。
- 只测**外部行为**；引擎测试在包内（纯 TS，无浏览器依赖）；浏览器门禁用 playwright-core 1.63.0（锁 chromium-1243）。

## 三、页面 → 实现票拆分（12 张）

| 票 | 范围（清单 ID） | 依赖 | 关键门禁 |
|---|---|---|---|
| FE-01 | 设计系统与令牌：双基准令牌、基础组件（按钮/菜单/模态/抽屉/输入/Toast）、状态族基础件（F1–F3、F11–F15） | 骨架 | 组件级对照（`verify-figma-component`） |
| FE-02 | 首页 / 文件浏览器（B1–B5、B7–B10、B12） | FE-01 | `verify-figma-home` + e2e:smoke |
| FE-03 | 编辑器壳层（C1、C2、C16、C20、E7、E8） | FE-01 | `verify-figma-editor` |
| FE-04 | 图层面板 + 资产面板（C3、C4） | FE-01 | 组件对照 |
| FE-05 | Inspector（C5、C6、C7） | FE-01 | 组件对照 |
| FE-06 | 画布与编辑行为（C8、C9、C10、C11 + engine 白名单 13 类） | FE-01、engine | `verify-canvas` + `e2e:smoke` |
| FE-07 | 评论 + Present + 版本（C12、C13、C14、F7、F10） | FE-01 | 状态对照 |
| FE-08 | 组件交互 + 检查 / 导出（C17、C15、F6） | FE-01 | 对照 + 功能断言 |
| FE-09 | 设置 + 引导 + 冷启动（E3、E4、E6） | FE-01 | 自设计页 §6 |
| FE-10 | AI 抽屉 + 出图面板 + MCP 桩 + 诊断（F4、F5、F9、F8） | FE-01 | 真/桩两态必验 |
| FE-11 | 市场前端 + 数据看板（D1–D6） | FE-01、《技能市场规格 v1》 | 自设计页 §6 |
| FE-12 | 最小壳（apps/desktop） | 骨架 | 壳内渲染一致性断言（标准 §3） |

## 四、圈外

- 性能硬指标（P1 基线）、P6 体验项（多标签壳/错误分类/更新通道）、移动端编辑、实时协同、真 MCP 网关、云侧。
- A 区壳层 15 项（缓归 P6，见清单 A 区名单）。

## 五、附注

- 实现票 = FE-01 … FE-12（独立 issue，`ready-for-agent`，正文引用本规格与清单 ID）。
- FE-11 交互细节以《技能市场规格 v1》为准；两规格在语义冲突时以《技能市场规格 v1》+《前端验收标准 v1》§6 合并解释。
