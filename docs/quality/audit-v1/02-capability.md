# 审计 02 · 五态能力表与全规格差距单

- **状态**：已完成（本票证据与中间笔记见 `~/df-evidence/audit-50/aud-02/`）
- **日期**：2026-10-17
- **代码基线**：`main` @ `c6b1654`（= 审计 01 基线；本票基于 `integration/audit-v1` @ `9079f02`）
- **本票分支/工作树**：`audit/02-capability` / `/home/QIU/df-wt/aud-02`
- **上游**：审计 01 基线报告 `docs/quality/audit-v1/01-baseline.md`（29 次执行 = 退出码 0 共 22 次 / 1 共 0 次 / 2 共 7 次 / 超时 0 次）
- **范围**：以已合并/已关闭票的验收标准做主判定，覆盖四域；全规格未开工/超范围项另列差距单。不修产品代码，不写必红测试。

## 0. 判定口径

### 0.1 五态

| 状态 | 判定 |
|---|---|
| `working` | 验收标准在当前环境可复现通过；功能路径有测试/门禁/真链路证据。 |
| `partial` | 有入口，但关键路径不完整或规格未达（含只做了降级/桩、只覆盖部分数据面、只在一段范围生效）。 |
| `missing` | 能力尚未实现；点名但不计为 bug。 |
| `broken` | 已实现但当前失败（**本轮 0 条**：基线无 exit 1，未复现已实现却失败的能力）。 |
| `blocked` | 环境或前置不成立（`exit 2` 语义），不得写成通过；必须点名前置。 |

`missing` 与 `broken` 严格分开：未实现不冒充失败；阻塞不冒充通过。基线中的 7 个 `exit 2` 只按阻塞记账，其中 3 个是未实现守卫（见差距单），4 个是环境/前置（REF-01、Electron、未播种市场索引、canvas 视觉段）。

### 0.2 范围

- **主表**只判 `main` 已合并范围：FE-01…FE-12（#14–#25）、INF-01（#26）、ENG-01（#27）、MK-01…MK-05（#30–#34）、修复批次 3/4（#38/#41）、市场增量分页（PR #45）。
- **差距单**列全规格中未开工、超范围或尚无可判定前置的能力（planned/missing/blocked），不计入「本段失败」。
- 视觉对照类 AC 统一按 blocked 记：REF-01 参照集未冻结（#28），逐页/逐组件/壳内对照不能出结论；功能断言不受此影响。
- 本轮不改产品代码；只读代码/测试与轻量环境探测，未重跑全量门禁。

## 1. 统计

### 1.1 主表（59 项）

| 域 | working | partial | missing | broken | blocked | 合计 |
|---|---:|---:|---:|---:|---:|---:|
| 编辑器与评审 | 16 | 3 | 0 | 0 | 2 | 21 |
| AI 与出图 | 5 | 0 | 2 | 0 | 2 | 9 |
| 市场与桌面壳 | 8 | 4 | 2 | 0 | 2 | 16 |
| 导入导出与设置 | 10 | 2 | 1 | 0 | 0 | 13 |
| **合计** | **39** | **9** | **5** | **0** | **6** | **59** |

### 1.2 差距单（26 项，全规格视角；与主表对应项不重复相加）

| 状态 | 数量 | 说明 |
|---|---:|---|
| blocked | 6 | REF-01、术语校准、Electron、真 DeepSeek key、真 ComfyUI、digest 裁决（#39） |
| planned | 7 | MCP 真网关、市场真实写入、受控 AI 写入、D5 沙箱试跑、P1 性能、市场 v2、P6/圈外 |
| missing | 13 | 覆盖率/mutation/PBT/契约快照/axe/故障注入/flake/跨平台/供应链/分支保护/CI 门禁/三守卫/市场索引播种/文档漂移 |
| **合计** | **26** | 详见 §4 |

### 1.3 结论

- 已合并范围的功能主路径整体为 **working**：编辑器 13 类交互、保存/重开/导出、市场检索与装载边界、AI 降级、ComfyUI 失败态、MCP 桩、设置/诊断均有真链路或三态门禁证据。
- **9 条 partial** 是规格未达或数据面不完整，不是「全绿」能掩盖的：评论/版本仅浏览器本地存储、代码导出档位缺 HTML/Tailwind、市场三项筛选只作用于当前页、D5 试跑只记计数不执行、看板多层未上报、设计系统卡 0（#39）、导出渲染简化、跨版本 `$version` 静默接受。
- **5 条 missing** 属已实现范围之外的闭环缺口：`.dfg` 外部导入、出图任务持久化（P4b）、受控 AI 写入（P5）、市场真实写入（P5）、MCP 真网关（P5）。
- **6 条 blocked** 全部点名前置：REF-01（视觉/术语）、Electron 二进制（壳运行态）、无 DeepSeek key（真 AI）、无 ComfyUI 8188（真出图）。这些不能写成通过，也不能算产品缺陷。
- 基线中 3 个未实现守卫（`guard:deps` / `guard:mcp-contract` / `guard:channel-pairing`）仍是 `exit 2` 桩，已放入差距单，不混入功能主表。

## 2. 主表（已合并范围）

> 证据键见 §6；`处置` 列按 #50 的 A/B/C 分级：A 阻断（主路径不可用、安全或数据丢失风险）、B 严重（功能不可达/规格未达，默认阻断但可书面豁免）、C 一般/观察。

### 2.1 编辑器与评审（21 项）

| ID | 域 | 能力 | AC 来源 | 状态 | 证据 | 影响面 | 处置 |
|---|---|---|---|---|---|---|---|
| A-01 | 编辑器与评审 | 双基准令牌 + 基础组件 + F1/F2/F3/F11–F15 状态族 | FE-01（#14）；验收标准 §2/§5；实现规格 §一.3 | working | EV-VERIFY-UI；EV-GUARD-TOKENS | 全局 UI 底座 | C |
| A-02 | 编辑器与评审 | 全中文 i18n + 离线 Noto Sans SC | ADR-0003；验收标准 §1.3；实现规格 §一.4 | working | EV-I18N；EV-FONT | 全站文案/字体 | C |
| A-03 | 编辑器与评审 | 21 条术语表与 Figma 中文界面校准 | ADR-0003；页面清单附录 B；验收标准 §1.3 | blocked | EV-FIGMA-BASE；前置 REF-01（#28） | 验收判定（A 级词表） | B |
| A-04 | 编辑器与评审 | 首页/文件浏览器 B1–B12（新建/筛选/搜索/空态/删除两步/回收站） | FE-02（#15）；页面清单 B 区 | working | EV-E2E-HOME；EV-VERIFY-WEB | 产品主入口 | C |
| A-05 | 编辑器与评审 | 全局搜索 B9（本地文档 + 市场，失效降级） | FE-02（#15）；页面清单 B9 | working | EV-VERIFY-WEB（HomeTopbar 测试） | 检索入口 | C |
| A-06 | 编辑器与评审 | 编辑器壳层 C1/C2/C16/C20（顶栏/工具栏/缩放菜单/HUD） | FE-03（#16）；页面清单 C 区 | working | EV-VERIFY-WEB；EV-E2E-EDITOR；EV-CANVAS | 编辑主界面 | C |
| A-07 | 编辑器与评审 | 画布挂载 + 交互白名单 13 类接线 | FE-06（#19）；实现规格 §一.5；验收标准 §5 | working | EV-CANVAS（A1–A7 + W1–W14；exit 2 仅视觉段） | 编辑主路径 | C |
| A-08 | 编辑器与评审 | 编辑器内核 ENG-01（场景图/命令栈/命中/布局/组件/令牌/吸附/选择） | ENG-01（#27）；实现规格 §一.5 | working | EV-ENGINE；EV-WHITELIST | 编辑内核 | C |
| A-09 | 编辑器与评审 | 图层面板 C3（显隐/锁定/重命名/拖拽/右键） | FE-04（#17）；页面清单 C3 | working | EV-VERIFY-WEB | 编辑面板 | C |
| A-10 | 编辑器与评审 | 资产面板 C4（组件/Token 分段 + 搜索） | FE-04（#17）；页面清单 C4 | working | EV-VERIFY-WEB | 编辑面板 | C |
| A-11 | 编辑器与评审 | Inspector C5/C6/C7（四分区/混选/空选/300ms 提交） | FE-05（#18）；页面清单 C5–C7 | working | EV-VERIFY-WEB | 编辑面板 | C |
| A-12 | 编辑器与评审 | 组件创建/实例/覆盖重置/变体切换 C17 | FE-08（#21）；页面清单 C17 | working | EV-VERIFY-WEB；EV-CODE-COMPONENTS | 组件编辑 | C |
| A-13 | 编辑器与评审 | 检查/代码导出 C15/F6（属性、复制、Token→CSS 变量） | FE-08（#21）；页面清单 C15/F6 | partial | EV-CODEGEN：只有 CSS/React 两档；#21 要求的 React+Tailwind/HTML 未实现 | 交付/规格未达 | B |
| A-14 | 编辑器与评审 | 评论 C12/F7（钉点、线程、解决/重开） | FE-07（#20）；页面清单 C12/F7 | partial | EV-STORAGE：仅 `localStorage`（`dfg:comments:*`），daemon 无评论路由，未入 `.dfg` | 评审数据（清站点数据即丢） | A |
| A-15 | 编辑器与评审 | 版本历史/对比/回滚 C14/F10 | FE-07（#20）；页面清单 C14/F10 | partial | EV-STORAGE：仅 `localStorage`（`dfg:versions:*`），daemon 无版本路由，未入 `.dfg` | 版本数据（清站点数据即丢） | A |
| A-16 | 编辑器与评审 | Present C13（黑底、键盘翻页、边界/Esc） | FE-07（#20）；页面清单 C13 | working | EV-REVIEW（三条交互 passed）；EV-VERIFY-WEB | 演示 | C |
| A-17 | 编辑器与评审 | 编辑器主路径：载入→画→保存→重开→导出 | #41 工作包 A；测试计划 P-01…P-04 | working | EV-E2E-EDITOR（17 步） | 主路径 | C |
| A-18 | 编辑器与评审 | 文档持久化 `.dfg`（CRUD/原子写/并发/路径安全） | INF-01（#26）；ADR-0001 | working | EV-DAEMON（37 项）；EV-DOC-SEC | 文档真值 | C |
| A-19 | 编辑器与评审 | 逐页/逐组件视觉对照（A/B 级） | 验收标准 §2–§4；FE-01…FE-08 | blocked | EV-FIGMA-BASE；EV-CANVAS 视觉段；EV-SHELL 对照段；前置 REF-01（#28） | 验收结论不可出 | B |
| A-20 | 编辑器与评审 | 评审浮层/评论态/演示判定修复（批次 4 C） | #41 工作包 C；测试报告 DEF/UX | working | EV-REVIEW；EV-VERIFY-WEB | 评审交互 | C |
| A-21 | 编辑器与评审 | 命令面板 E7 + 快捷键说明 E8 | FE-03（#16）；页面清单 E7/E8 | working | EV-VERIFY-WEB（registry/palette/shortcut 测试） | 效率入口 | C |

### 2.2 AI 与出图（9 项）

| ID | 域 | 能力 | AC 来源 | 状态 | 证据 | 影响面 | 处置 |
|---|---|---|---|---|---|---|---|
| B-01 | AI 与出图 | AI 抽屉/意图卡/步骤流（queued/llm/validate/compile） | FE-10（#23）；页面清单 F4 | working | EV-AI（16 步，含真浏览器 UI 段） | AI 主界面 | C |
| B-02 | AI 与出图 | 无 key/上游失败降级（本地模板角标 + 建议清单） | FE-10（#23）；范围边界 §3 | working | EV-AI；EV-DAEMON（`ai.degrade.no-credentials`） | 降级可用 | C |
| B-03 | AI 与出图 | 有 key 真 DeepSeek 上游（BYOK/流式） | FE-10（#23）；范围边界 §3「真 + 降级分支必验」 | blocked | EV-AI 只验证 mock 上游；`apps/daemon/src/ai/client.ts` 为真实实现；前置：无真实 key（允许一次性安全注入） | 真 AI 能力 | B |
| B-04 | AI 与出图 | BYOK 凭据安全（key 只在 daemon 解密、0600、掩码、不落日志） | INF-01（#26）；#38 工作包 F | working | EV-DAEMON（`credentials.never-in-log`）；EV-CREDENTIALS | 安全 | C |
| B-05 | AI 与出图 | 出图面板（进度/取消/OOM 降档重试提示） | FE-10（#23）；页面清单 F5 | working | EV-IMG（12 步） | 出图 UI | C |
| B-06 | AI 与出图 | ComfyUI 未启动/缺模型的结构化失败与动作 | FE-10（#23）；范围边界 §3 | working | EV-IMG；EV-DAEMON | 失败态 | C |
| B-07 | AI 与出图 | ComfyUI 真实正常态出图 | FE-10（#23）；范围边界 §3「真 + 两态必验」 | blocked | EV-IMG 为 mock 正常态；本机 8188 探测连接拒绝（curl exit 7）；前置：ComfyUI 服务 + 模型 | 真出图 | B |
| B-08 | AI 与出图 | 出图任务持久化/崩溃恢复（P4b） | 架构 v1.1 §4.5.6；`image/client.ts` 自述 | missing | EV-CODE-IMAGE（任务登记在进程内存） | 任务可靠性 | B |
| B-09 | AI 与出图 | 受控 AI 写入/变更提案（P5） | 市场规格 §6.2 D2；#50 US-15 | missing | 无应用/写入路径；MCP 为桩 | AI 写入闭环 | B |

### 2.3 市场与桌面壳（16 项）

| ID | 域 | 能力 | AC 来源 | 状态 | 证据 | 影响面 | 处置 |
|---|---|---|---|---|---|---|---|
| C-01 | 市场与桌面壳 | 采集线六环（请求纪律→认定→评分→index→检索→离线复跑） | MK-01…MK-05（#30–#34）；市场首实现 §4 | working | EV-MK（0×5；真实批次 42 仓/1496 认定/344 卡/15 查询/digest 一致） | 市场数据 | C |
| C-02 | 市场与桌面壳 | D1 市场首页/卡片/增量分页 | FE-11（#24）；PR #45；市场规格 §6 | working | EV-MARKET；EV-CODE-PAGINATION | 市场主路径 | C |
| C-03 | 市场与桌面壳 | D2 资源详情（来源/许可/五维/下架态/装载三态） | FE-11（#24）；市场规格 §6.2 | working | EV-MARKET；EV-VERIFY-WEB | 市场详情 | C |
| C-04 | 市场与桌面壳 | D3 搜索 BM25，与 CLI 同口径 | FE-11（#24）；#41 工作包 E1 | working | EV-MARKET；EV-MK；测试报告「幻灯片 78=78」 | 检索 | C |
| C-05 | 市场与桌面壳 | D3 筛选（许可档/来源/已装载）全量语义 | FE-11（#24）；市场规格 §6.2 D3 | partial | EV-CODE-FILTERS：三项为**当前页客户端过滤**，未在服务端全量过滤；过滤×分页边界未闭合 | 检索/分页边界 | B |
| C-06 | 市场与桌面壳 | 市场空态/错误/索引缺失/损坏/检索索引降级 | FE-11（#24）；市场规格 §6.2 | working | EV-MARKET（未播种 exit 2 / 播种 exit 0）；daemon 市场测试 | 降级 | C |
| C-07 | 市场与桌面壳 | D4 装载确认/能力清单/license 守门/一次性 token | FE-11（#24）；市场规格 §7.3 | working | EV-MARKET；EV-CODE-LOAD-TOKEN | 装载边界 | C |
| C-08 | 市场与桌面壳 | 市场真实写入/卸载/更新文件操作 | 市场规格 §7.3/§7.4；P5 | missing | EV-CODE-MARKET：路由只出装载提案；本地记录册在 `localStorage`；MCP 桩不改文档 | 装载闭环 | B |
| C-09 | 市场与桌面壳 | D5 编辑器内市场面板/试跑（dryRun）/采纳计数 | FE-11（#24）；市场规格 §6.2 D5 | partial | EV-VERIFY-WEB（panel/feedback 测试）；试跑入口只记本地计数，未执行示例话术/沙箱 | 面板试跑 | B |
| C-10 | 市场与桌面壳 | D6 数据看板（采集进度/四层状态/质量三看板） | FE-11（#24）；市场规格 §6.2 D6 | partial | EV-CODE-DASHBOARD：ADS 有上报；ODS/DWD/DWS、runId、ODS 水位均「未上报」 | 看板完整性 | B |
| C-11 | 市场与桌面壳 | 市场数据质量（设计系统卡/digest 口径） | #39（open）；测试报告 O-02 | partial | EV-TEST-REPORT：真实批次设计系统卡 0；digest 口径待裁决 | 数据完整性 | B |
| C-12 | 市场与桌面壳 | 桌面壳静态安全基线/菜单/外链/静态服务 | FE-12（#25）；#41 工作包 F | working | EV-GUARD-ELECTRON；EV-VERIFY-WEB（desktop 122 例） | 桌面交付 | C |
| C-13 | 市场与桌面壳 | 桌面壳运行态装载/交互存活 | FE-12（#25）；#41 工作包 F2 | blocked | EV-SHELL：Electron 二进制缺失（smoke/alive 均 exit 2） | 桌面交付 | B |
| C-14 | 市场与桌面壳 | 壳内/浏览器视觉对照 | 验收标准 §3；FE-12（#25） | blocked | EV-SHELL：parity exit 2（Electron 二进制 + REF-01） | 验收结论 | B |
| C-15 | 市场与桌面壳 | MCP 确认桩（dryRun → 一次性 ackToken → 审计） | FE-10（#23）；INF-01（#26） | working | EV-MCP（16 步）；UI 显式「桩」角标；真实写入 `applied=false` | MCP 桩 | C |
| C-16 | 市场与桌面壳 | MCP 真网关/双端（ZCode、WorkBuddy）接入 | 架构 v1.1 §4.5.4；P5 | missing | EV-CODE-MCP（`stub: true`，`applied: false`） | MCP 真值 | B |

### 2.4 导入导出与设置（13 项）

| ID | 域 | 能力 | AC 来源 | 状态 | 证据 | 影响面 | 处置 |
|---|---|---|---|---|---|---|---|
| D-01 | 导入导出与设置 | PNG/SVG/PDF 导出（含失败态/重试） | FE-08（#21）；INF-01（#26）；#50 US-17 | partial | EV-E2E-EXPORT（三格式产物落盘）；EV-CODE-EXPORT：简化渲染，PNG/PDF 跳过文本与位图，PDF 不表达圆角，SVG 图片为占位 | 产物可用性 | B |
| D-02 | 导入导出与设置 | `.dfg` 保存/重开/跨会话恢复 | #41 工作包 A；INF-01（#26） | working | EV-E2E-EDITOR；EV-DAEMON | 本地真值 | C |
| D-03 | 导入导出与设置 | `.dfg` 外部导入/打包导出（文件选择/交换） | #50 US-17；INF-01（#26） | missing | EV-CODE-IMPORT（`importIr` 返回「未接入导入」，无文件选择入口） | 导入导出闭环 | B |
| D-04 | 导入导出与设置 | 跨版本兼容（迁移/拒绝未来版本） | #50 US-17；`serialize.ts` 信封 | partial | EV-CODE-SERIALIZE：任意数值 `$version` 被接受，无迁移/拒绝；测试只覆盖 v1 | 兼容/数据误读风险 | B |
| D-05 | 导入导出与设置 | 设置页四分区（工作目录/DeepSeek/ComfyUI/埋点）+ 保存态/校验 | FE-09（#22）；页面清单 E3 | working | EV-VERIFY-WEB（settings 13 文件）；EV-SELF | 设置 | C |
| D-06 | 导入导出与设置 | 凭据注入/掩码/清除（设置页 + `df config set-key --stdin`） | FE-09（#22）；#38 工作包 F；INF-01 | working | EV-DAEMON；EV-CREDENTIALS；CLI 单测 | 安全 | C |
| D-07 | 导入导出与设置 | 四步引导 E4（当前步高亮/完成/跳过） | FE-09（#22）；页面清单 E4 | working | EV-VERIFY-WEB；EV-SELF | 引导 | C |
| D-08 | 导入导出与设置 | 空库冷启动 E6（空态→一键示例） | FE-09（#22）；页面清单 E6 | working | EV-VERIFY-WEB；EV-SELF | 冷启动 | C |
| D-09 | 导入导出与设置 | 诊断面板 F8（版本/环境/日志/连通性自检） | FE-10（#23）；页面清单 F8 | working | EV-VERIFY-WEB；EV-DAEMON | 诊断 | C |
| D-10 | 导入导出与设置 | 本地遥测（默认仅本地/查看/删除/脱敏） | INF-01（#26）；市场规格 §8.3 | working | EV-DAEMON；EV-VERIFY-WEB | 隐私 | C |
| D-11 | 导入导出与设置 | 导出失败分类/行动建议/重试 | #41 工作包 G4；测试计划 | working | EV-VERIFY-WEB（ExportPanel 测试） | 错误态 | C |
| D-12 | 导入导出与设置 | 配置/工作目录持久化与可写校验 | INF-01（#26） | working | EV-VERIFY-WEB（config store 测试）；EV-DAEMON | 配置 | C |
| D-13 | 导入导出与设置 | 连接错误占位（—）/未知路由中文 404/全中文错误文案 | #41 工作包 G1/G5；ADR-0003 | working | EV-VERIFY-WEB（not-found/home 测试） | 错误态 | C |

## 3. 最关键的 8 条缺口

| # | ID | 缺口 | 级别 | 为什么关键 | 建议 |
|---:|---|---|---|---|---|
| 1 | A-14/A-15 | 评论与版本历史只存浏览器 `localStorage`，未入 `.dfg`/daemon | A（数据丢失） | 清站点数据即不可恢复；评审数据不在本地真值内 | 先登记缺口；#54 评估 daemon 路由/`.dfg` 子目录方案 |
| 2 | C-08 | 市场装载真实写入/卸载/更新未实现 | B | D4 只到 token 与本地记录，`applied=false`；闭环缺最后一跳 | 归 #55 + P5 网关；先补契约快照 |
| 3 | D-03/D-04 | `.dfg` 外部导入缺失；未来 `$version` 静默接受 | B | 用户无法交换文档；未来格式可能被误读 | #57 定导入/打包与版本拒绝策略 |
| 4 | D-01 | 导出渲染简化：PNG/PDF 跳过文本/位图，PDF 无圆角，SVG 图片占位 | B | 产物「能导出」但保真不足，交付场景受限 | #57 评估 CanvasKit/引擎序列化接入 |
| 5 | C-05 | 许可/来源/已装载筛选只在当前页生效 | B | 过滤×分页结果不完整，用户以为全量 | #55 把三项下沉 daemon 或做全量索引过滤 |
| 6 | C-10/C-11 | 看板多层未上报；设计系统卡 0（#39） | B | 市场数据面不可解释，看板无法给结论 | #55 补 collector 字段；#39 裁决 digest |
| 7 | A-03/A-19 | REF-01 未冻结：术语校准与逐页视觉对照全阻塞 | B | 验收标准的主判定面不可出结论（不是产品失败） | #28 冻结参照集后复跑 figma/canvas/shell |
| 8 | C-13/C-14 | Electron 二进制缺失：壳运行态与壳内对照不可判定 | B | 桌面壳只能静态判，不能证明可交付 | 按 `fetch-electron` 安装后复跑 `verify:shell-parity` |

补充（不计入上表）：B-03/B-07 真 DeepSeek/真 ComfyUI 因无 key/无服务而 blocked，属两态验收的真实缺失；B-08/B-09/C-16 是 P4b/P5 路线图项。

## 4. 全规格差距单（planned / missing / blocked）

> 本表是**全规格视角**的未开工/超范围清单：包含主表 blocked/partial/missing 的后续阶段（如 G-03 对应 C-13/C-14、G-07 对应 C-16），因此**不与主表相加**；`blocked` 均已点名前置。

| ID | 能力 | 规格来源 | 状态 | 前置/说明 |
|---|---|---|---|---|
| G-01 | REF-01 参照集冻结 + 逐页/组件/状态视觉判定 + 人工验收会话 | 验收标准 §2–§5；#28 | blocked | 参照集目录 `~/df-evidence/reference-v1` 不存在 |
| G-02 | 21 条术语表与 Figma 中文界面校准 | ADR-0003；页面清单附录 B | blocked | 随 REF-01 采集一次完成 |
| G-03 | Electron 运行态（冒烟/存活）与壳内一致性 | FE-12；验收标准 §3 | blocked | `apps/desktop/node_modules/electron/dist/electron` 缺失 |
| G-04 | 有 key 真 DeepSeek 一次性手工验收 | #50「两态 + 契约」；#56 | blocked | 无 key；只允许用户安全注入后一次性验收 |
| G-05 | 真 ComfyUI 正常/OOM/取消 + P4b 持久队列 | 架构 v1.1 §4.5.6；P4b | blocked | 本机 8188 不可达；队列属 P4b |
| G-06 | digest v2 / 设计系统卡口径裁决 | 市场规格 §1.6；#39 | blocked | 人工裁决；当前真实批次 DS 卡 0 |
| G-07 | MCP 真网关与 ZCode/WorkBuddy 双端读写 | 架构 v1.1 §4.5.4；P5 | planned | 当前为桩（`applied=false`） |
| G-08 | 市场真实装载写入/卸载/更新文件操作 | 市场规格 §7.3/§7.4；P5 | planned | 真实写入归 MCP 网关；当前只记本地册 |
| G-09 | D2「一键做同款」/受控 AI 写入变更提案 | 市场规格 §6.2 D2；#50 US-15 | planned | 无应用路径；归 P5 |
| G-10 | D5 沙箱试跑执行（非 dryRun） | 市场规格 §6.2 D5 | planned | 当前试跑只列能力与注入点，不执行 |
| G-11 | 性能硬预算 P1（500 节点 ≥55FPS、启动/内存/包体） | 实现规格 §一.5/§四；#50 Out of Scope | planned | 本段只建基线，不进 DoD |
| G-12 | 市场 v2：向量检索/增量调度/云聚合/付费/生成线/全量普查/中文生态 | 市场规格 §5/§9；市场首实现 §5 | planned | 首版明确圈外 |
| G-13 | P6 与圈外项：A 区 15 项壳能力、C18/C19、B6/B11、E1/E2/E5/E9、移动端编辑、实时协同、更新通道 | 范围边界 §2/§5；实现规格 §四 | planned | 路线图/圈外，不计本段失败 |
| G-14 | 覆盖率阈值（按包采集 + 门槛） | #50 企业级缺口 | missing | 现有测试无覆盖率门禁 |
| G-15 | mutation / 基于性质的测试（PBT） | #50 企业级缺口 | missing | 现有 fuzz 仅引擎固定种子子集 |
| G-16 | 契约快照（daemon↔web↔CLI、market schema、MCP 工具集） | #50 新增接缝 | missing | 无快照工装 |
| G-17 | a11y 自动化（真实浏览器 axe + WCAG 2.2 AA） | #50 企业级缺口；验收标准 §5 | missing | 现有 `verify/a11y-keyboard.test.tsx` 为 jsdom 键盘断言，非 axe |
| G-18 | 韧性故障注入（ENOSPC/EACCES/SIGKILL/损坏 `.dfg`） | #50 US-8；#53 | missing | 现有仅 manifest 损坏跳过、并发/路径安全单测 |
| G-19 | flake 观测（JUnit/重试/隔离/统计） | #50 企业级缺口 | missing | e2e runner 无统计输出 |
| G-20 | 跨浏览器矩阵 / Windows 全矩阵 / macOS 自动化 | #50 平台范围 | missing | 当前 Linux 主判、Chromium 单浏览器 |
| G-21 | 供应链：依赖审计、CodeQL、Dependabot、dependency review 进 CI | #50 US-22；基线 §3.3 | missing | `pnpm audit --prod` 仅手工快照（本轮 0 漏洞） |
| G-22 | `main` branch protection 与必需检查 | #50 US-20；基线 §3.3 | missing | 仓库设置项，需管理员授权 |
| G-23 | CI 纳入生产构建/e2e/浏览器门禁/canvas/daemon/market/两态/shell | #50 US-21；基线 §3.2 | missing | 当前 CI 仅 lint/typecheck/test/test:scripts/4 守卫/engine + figma 阻塞语义 |
| G-24 | 三个未实现守卫：`guard:deps` / `guard:mcp-contract` / `guard:channel-pairing` | 工作流门禁清单 | missing | 均 `exit 2` 桩，禁止当绿 |
| G-25 | 市场索引播种/CI 数据根 | 基线 §2/§5 | missing | 空根 `verify:market` exit 2；需 `df market collect / score / index` 或播种 |
| G-26 | 门禁文档漂移（e2e 10 vs 63 步、canvas 6 vs 7 断言、`next dev` vs 生产构建） | 基线 §4.7；#51 | missing | 文档/CI 注释与实际不一致，归 #60 |

## 5. 待深挖清单（交接 #53–#58）

> 这些项本轮只有代码/基线级判断，未做真链路深挖；不要在 #52 提前下缺陷结论。

### #53 数据完整性与安全

1. `.dfg` 原子写/并发保存在 SIGKILL、ENOSPC、EACCES 下的行为；临时文件/rename 的崩溃窗口。
2. 损坏 `.dfg`（manifest/page JSON/截断）的恢复策略与“跳过 vs 报错”边界；备份/回收站是否可恢复。
3. 路径穿越 5 种编码、符号链接、大小写/Unicode 归一化；工作目录逃逸。
4. 凭据主密钥损坏/轮换、`credentials.json` 权限、日志/遥测/审计 JSONL 是否可能泄漏 key。
5. CORS 白名单与 `Origin: null`（打包壳）的伪造面；本地端口暴露面。
6. `applyJsonLine`/审计文件的崩溃一致性；MCP 提案内存态在重启后的行为。

### #54 编辑器与评审

1. 13 类交互在真实浏览器下的边界（多选/旋转/吸附/文本 IME/组合输入/超长文本）。
2. 500 节点性能基线（帧率、首帧、内存）；当前只有功能断言，无性能预算。
3. 评论/版本 `localStorage` 的配额、清站点数据、跨浏览器/多窗口一致性；迁到 daemon 的成本。
4. a11y：真实浏览器 axe、键盘可达、焦点回环、读屏语义；现有 jsdom 断言不够。
5. `/editor` 与 `/_canvas` 装配层剩余差异（会话换代/URL 参数/提示层）对主路径的影响。
6. 代码导出档位/确定性/令牌绑定；C15 与 F6 同源是否在真实选择集上成立。

### #55 市场、桌面壳与 MCP

1. 索引缺失/损坏/部分失败/分页截断的 UI 与契约；`filter × pagination` 全量语义。
2. 不可信卡片内容（名称/描述/标签/许可）的 XSS/注入面；React 转义之外的第二通道。
3. 装载 token 的边界：重复消费、超时、跨标签页、并发批准；本地记录册与真实写入的差异。
4. 真实写入/卸载/更新（P5）与“已装载但被引用”的提示；yank/本地改动二次确认。
5. Electron 运行态：装载 URL/静态服务/外链/菜单/存活；`fetch-electron` 后复跑三段门禁。
6. MCP 契约快照与双端读写；桩到真网关的字段漂移。

### #56 AI 与出图

1. 真实 DeepSeek key 一次性验收（流式/取消/429/5xx/超时）；key 不入聊天/日志/证据。
2. prompt injection 防线：AI 输出是否只展示、是否有工具调用/写入路径；注入文本的展示边界。
3. 流式中止、客户端断开、上游半包、SSE 帧解析的失败态。
4. 真 ComfyUI 正常/OOM/取消/缺模型；任务队列持久化（P4b）与产物哈希去重。
5. mock 与真上游的契约漂移（响应形状、错误码、usage、artifact）。

### #57 导入导出、设置与诊断

1. `.dfg` 外部导入/打包导出（文件选择、冲突、同名覆盖、路径安全）。
2. 跨版本：未来 `$version` 拒绝/迁移；旧版本字段缺失的兼容矩阵。
3. 导出保真：文本/位图/圆角/多页/字体；PNG/SVG/PDF 在外部查看器中的可用性。
4. 设置校验边界（URL/路径/超长/非法字符）、保存失败与回滚；引导/冷启动的同源。
5. 诊断连通性（daemon/ComfyUI/DeepSeek）与日志脱敏；遥测查看/删除；工作目录切换的迁移。

### #58 跨域

- 以上修复后的 e2e 用户路径与回归资产；REF-01 冻结后的视觉差异闭环与人工验收会话。

## 6. 证据索引与复现

### 6.1 证据键

| 键 | 路径/内容 |
|---|---|
| EV-BASE | `docs/quality/audit-v1/01-baseline.md`；`~/df-evidence/audit-50/aud-01/baseline.json` |
| EV-VERIFY | `~/df-evidence/audit-50/aud-01/logs/verify.log`（9 包/292 文件/2765 例） |
| EV-VERIFY-WEB | 同上（web 155 文件/1343 例；settings/home/review/panel/diagnostics 等） |
| EV-VERIFY-UI | `packages/ui` 13 文件/165 例（EV-VERIFY）；`packages/ui/src/__verify__/components-verify.test.tsx` |
| EV-GUARD-TOKENS | `~/df-evidence/audit-50/aud-01/logs/guard-tokens.log` |
| EV-GUARD-ELECTRON | `~/df-evidence/audit-50/aud-01/logs/guard-electron-baseline.log` |
| EV-CANVAS | `~/df-evidence/audit-50/aud-01/logs/verify-canvas.log`；`gate-evidence/fe-06/verify-canvas-2026-10-17T12-44-55.json`（A1–A7 + W1–W14；exit 2 仅视觉） |
| EV-E2E-HOME | `~/df-evidence/audit-50/aud-01/logs/e2e-smoke.log`（home 8 步） |
| EV-E2E-EDITOR | 同上（editor 17 步；导出 PNG/SVG/PDF 落 `gate-evidence/fe-02/e2e/2026-10-17T12-45-20/scenarios/editor/data/exports/`） |
| EV-E2E-EXPORT | 同上导出目录（三格式真实文件） |
| EV-ENGINE | `~/df-evidence/audit-50/aud-01/logs/verify-engine.log`（23 文件/312 例；快照哈希 `d5bf98762842…`） |
| EV-WHITELIST | `packages/engine/src/whitelist.test.ts`（13 类逐条） |
| EV-AI | `~/df-evidence/audit-50/aud-01/logs/verify-ai-two-state.log`；`gate-evidence/fe-10/verify-ai-two-state.json`（16 步） |
| EV-IMG | `~/df-evidence/audit-50/aud-01/logs/verify-image-two-state.log`；`gate-evidence/fe-10/verify-image-two-state.json`（12 步） |
| EV-MCP | `~/df-evidence/audit-50/aud-01/logs/verify-mcp-stub.log`；`gate-evidence/fe-10/verify-mcp-stub.json`（16 步） |
| EV-MARKET | `~/df-evidence/audit-50/aud-01/logs/verify-market.log`（未播种 exit 2）；`verify-market-seeded.log`（播种 exit 0）；`gate-evidence/fe-11/verify-market-2026-10-17T12-49-25.json` |
| EV-MK | `~/df-evidence/audit-50/aud-01/logs/verify-mk-01.log`…`verify-mk-05.log`；`~/df-evidence/mk-05/verify-mk-05.evidence.json` |
| EV-DAEMON | `~/df-evidence/audit-50/aud-01/logs/verify-daemon.log`；`~/df-evidence/inf-01/verify-daemon.evidence.json`（37 项） |
| EV-SHELL | `~/df-evidence/audit-50/aud-01/logs/verify-shell-parity.log`；`gate-evidence/fe-12/shell-parity-2026-10-17T12-45-44Z/evidence.json`（三段 exit 2） |
| EV-FIGMA-BASE | `~/df-evidence/audit-50/aud-01/logs/verify-figma-baseline.log`；`gate-evidence/ref-01/verify-figma-baseline-2026-10-17T12-44-14.json`（exit 2：参照集未冻结） |
| EV-REVIEW | `~/df-evidence/fe-07/verify-figma-review-2026-10-16T14-04-06.json`（comments/versions/present 三条交互 passed；exit 2 仅 REF） |
| EV-SELF | `~/df-evidence/audit-50/aud-01/logs/verify-self-designed.log`；`~/df-evidence/fe-09/verify-self-designed-2026-10-17T12-45-44.json` |
| EV-TEST-REPORT | `docs/quality/test-report-v1.md`（缺陷趋势/已知债 O-01…O-08） |
| EV-I18N | `apps/web/src/i18n/index.ts`；`apps/web/src/i18n/index.test.ts` |
| EV-FONT | `apps/web/src/app/layout.tsx`；`apps/web/src/app/globals.css`；`packages/ui/src/tokens.css` |
| EV-STORAGE | `apps/web/src/features/editor-review/storage.ts`（`dfg:comments:*` / `dfg:versions:*`；daemon 无对应路由） |
| EV-CODEGEN | `apps/web/src/features/inspect-export/model/codegen.ts`（`css` / `react` 两档）；`components/CodeExportPanel.tsx` |
| EV-CODE-COMPONENTS | `apps/web/src/features/editor-components/preview.ts`；`model/*` 测试 |
| EV-CODE-FILTERS | `apps/web/src/features/market/filters.ts`（三项客户端过滤仅当前页） |
| EV-CODE-PAGINATION | `apps/web/src/features/market/pagination.ts`；`use-market.ts` |
| EV-CODE-LOAD-TOKEN | `apps/web/src/features/market/load-token.ts`；`load-store.ts` |
| EV-CODE-MARKET | `apps/daemon/src/routes/market.ts`（只出装载提案）；`market/service.ts` |
| EV-CODE-DASHBOARD | `apps/web/src/features/dashboard/metrics.ts`（ODS/DWD/DWS/runId/watermark 未上报） |
| EV-CODE-MCP | `apps/daemon/src/mcp/stub.ts`（`stub: true` / `applied: false`） |
| EV-CODE-IMAGE | `apps/daemon/src/image/client.ts`（任务登记在进程内存，P4b） |
| EV-CODE-EXPORT | `apps/daemon/src/export/png.ts` / `svg.ts` / `pdf.ts`（简化渲染边界） |
| EV-CODE-IMPORT | `apps/web/src/features/canvas/debug/canvas-debug.ts`（`importIr` 返回「未接入导入」） |
| EV-CODE-SERIALIZE | `packages/engine/src/serialize/serialize.ts`（任意数值 `$version` 被接受） |
| EV-CREDENTIALS | `apps/daemon/src/credentials/store.ts`（AES-256-GCM、0600、掩码） |
| EV-DOC-SEC | `apps/daemon/src/routes/documents.security.test.ts`；`adversarial.test.ts` |
| EV-CI | `.github/workflows/ci.yml`；EV-BASE §3 |

### 6.2 本轮轻量复验（未重跑全量门禁）

| 探测 | 结果 |
|---|---|
| `ls apps/desktop/node_modules/electron/dist/electron` | 不存在（exit 2）→ C-13/C-14 blocked |
| `ls ~/df-evidence/reference-v1` | 不存在（exit 2）→ A-03/A-19/C-14 blocked |
| `curl --max-time 2 http://127.0.0.1:8188/system_stats` | 连接拒绝（exit 7）→ B-07 blocked |
| `DF_DEEPSEEK_API_KEY` | unset → B-03 blocked（真 key 一次性验收未做） |
| `ls ~/df-evidence/mk-05/batch/data/ads` | 存在 `df.marketplace.index.v1.json` / `market_search_index.v1.json` → EV-MARKET 播种可用 |
| 代码阅读 | 评论/版本存储、过滤×分页、导出渲染、序列化版本、D5 试跑、看板未上报、市场真实写入、`.dfg` 导入 |

## 7. 边界与未决

1. 本票不修产品代码；A-14/A-15 的持久化方案与 C-08/G-07/G-08 的真实写入均归后续票，先登记不为缺陷判定。
2. 视觉类结论一律等 REF-01；本轮不拿自截图/近似图当判据（基线已有同样纪律）。
3. 市场相关判定必须声明数据根：空根是阻塞（exit 2），播种 MK-05 索引后才可判 0；本报告引用的是播种后的 `verify-market-seeded` 证据。
4. `verify-figma-review` 未在 #51 基线中重跑；A-16/A-20 引用的是既有证据（三条交互 passed）与单测，视觉段同样 blocked。归 #54 复验。
5. 真 AI/真出图的 blocked 不是产品缺陷：代码路径为真实实现，缺的是 key/服务与一次性验收；#56 负责两态复验。
6. 差距单中的质量能力（G-14…G-26）是审计与门禁改造输入，最终清单由 #59/#60 汇总，不在本票开 issue。

---

*审计 02 完 · 2026-10-17*
