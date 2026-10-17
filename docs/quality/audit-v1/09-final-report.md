# 审计 09 · 最终报告：issue/epic 收口与 CI 改造清单

- **状态**：已完成（审计 #50 收口；不修产品代码）
- **日期**：2026-10-17
- **代码基线**：`main` @ `c6b1654`；集成分支 `integration/audit-v1` @ `f559cb4`（09 收口时）
- **收口复核基线**：`integration/audit-v1` @ `66f0f91`（#107 测试工装与 #108 CI 硬化合并后；本报告 §1.2/§4.5/§9 按此更新）
- **本票分支 / 工作树**：`audit/09-final-report` / `/home/QIU/df-wt/aud-09`
- **上游**：审计 01–08 报告 `docs/quality/audit-v1/01-baseline.md` … `08-cross-domain.md`
- **证据根**：`~/df-evidence/audit-50/aud-09/`（`register.json`、`register.md`、`created.json`、`create-issues.log`）
- **登记结果**：5 个 epic（#62–#66）+ 40 个子 issue（#67–#106）；另有 10 条 blocked/质量缺口只登记、不建缺陷票。

## 0. 执行摘要与结论

本轮审计以**真实产品标准**收口：不把测试绿数当可用性结论，不以完成文案代替产物，不把 `exit 2` 写成通过。八份报告的证据来自生产构建、真 Chromium、真 daemon、临时数据根与仓外证据；审计阶段未改产品代码。

**数量**：来源报告共 53 条 finding（#53 14、#54 10、#55 6、#56 13、#57 10），另有 #52 能力表中的 partial/missing 映射。去重合并后登记 **40 个子 issue：A 3 / B 23 / C 14**；分类为缺陷 21、观察 13、planned 缺口 6。全规格差距单 26 项（blocked 6 / planned 7 / missing 13）中的质量项统一归 #60。

**A 级 3 条（必须优先处理）**：

1. **跨进程并发建页静默丢页** — [#67](https://github.com/QIUZI-HONG/DesignForge/issues/67)（F-03-01）：20 个 201 请求后 manifest 只剩 11 页，静默数据丢失。
2. **CORS `Origin: null` 沙箱 iframe 越权读写删** — [#68](https://github.com/QIUZI-HONG/DesignForge/issues/68)（F-03-02）：本地页面中的沙箱 iframe 可读取并删除任意文档。
3. **真实编辑器导出 PNG/SVG/PDF 全空白** — [#69](https://github.com/QIUZI-HONG/DesignForge/issues/69)（F-07-01）：三格式均 200，但产物没有任何设计内容；旧 e2e 只看完成文案，属假绿。

**不假绿的关键事实**：

- 旧 `e2e:smoke`（63/63）对导出全空白仍 exit 0；审计 08 加固为内容断言后为 **114 步 = 110 pass / 4 fail**（F-07-01×3 + F-05-01×1），4 红如实保留。
- `verify:resilience` 47 步 = **31 pass / 9 fail / 0 blocked / 7 observe，exit 1**；9 红全部对应 A/B 缺陷。
- `verify:market` 在 1/344 条坏卡被静默跳过时仍 **exit 0**（`total=343` 与 `counts.total=344` 不一致、`warnings=[]`），是门禁假绿。
- `verify:canvas` 的 exit 2 只来自 REF-01 视觉段；功能断言 7/7 与接线 15/15 全过。
- `verify:shell-parity` 三段 exit 2 来自 Electron 二进制缺失与 REF-01，不得写成通过。
- `guard:deps` / `guard:channel-pairing` 仍是 `exit 2` 桩；`guard:mcp-contract` 已由审计 05 实现并接 CI。

**结论**：审计完成，A/B 缺陷与缺口已登记，放行判断由负责人按分级决定。本报告不代替负责人作发布放行判断。

## 1. 基线事实

### 1.1 门禁复跑（审计 01，29 次执行）

| 退出码 | 次数 | 含义 |
|---|---:|---|
| 0 | 22 | 通过 |
| 1 | 0 | 真违规 |
| 2 | 7 | 阻塞（不是通过） |
| 超时 | 0 | — |

7 个 `exit 2` 当时代码：

| 门禁 | 阻塞原因 | 现状 |
|---|---|---|
| `guard:deps` | 未实现桩 | 仍为桩 |
| `guard:mcp-contract` | 未实现桩（#51 时点） | **审计 05 已实现并接 CI** |
| `guard:channel-pairing` | 未实现桩 | 仍为桩 |
| `verify:figma-baseline` | REF-01 参照集未冻结 | 仍阻塞（#28） |
| `verify:market`（空根） | 市场索引缺失 | 播种后 exit 0；空根仍按阻塞语义 |
| `verify:canvas` | 视觉段 REF-01（功能 7/7 + 接线 15/15 全过） | 仍阻塞 |
| `verify:shell-parity` | Electron 二进制缺失 + REF-01 | 仍阻塞 |

补充事实：`pnpm verify` = 9 包 / 292 文件 / **2765 例**全绿；生产构建 web（13 路由）与 desktop 均 exit 0；`pnpm audit --prod` 手工 exit 0（0 已知漏洞，期间两次 ETIMEDOUT 重试）。测试规模：web 1343、ingest 579、engine 312、ui 165、desktop 122、daemon 118、contracts 80、cli 45、comfy 1。`test:scripts` 基线 56 例，审计后为 **79 例**（#53 +10 韧性自测、#55 +7 MCP 契约、#58 +6 导出判定）。

### 1.2 CI 覆盖矩阵

`.github/workflows/ci.yml` 是主 workflow；触发 `push`/`pull_request` 到 `main`；单 job `verify`（ubuntu-latest、Node 22、45 分钟；顶层 `permissions: contents: read`）。下表按 `integration/audit-v1` @ `66f0f91`（#107/#108 合并后）更新；09 当时的「30 分钟 / 无覆盖率 / 无供应链配置」矩阵已过时。

| 门禁 | 在 CI？ | 形式 |
|---|---|---|
| lint / typecheck / test:coverage / test:scripts | 是 | 必过；`test:coverage` = 逐包测试 + v8 覆盖率（**不重复跑 `pnpm test`**） |
| 覆盖率阈值（9 包） | 是 | 必过；9 包均设保守阈值（实测下留 2–5pp），artifact `coverage` 保留 14 天 |
| 生产构建 web | 是 | 必过（`next build`，13 路由） |
| guard:tokens / vocab / feature-boundaries / electron-baseline | 是 | 必过步骤 |
| guard:mcp-contract | 是 | 审计 05 实现并接入的必过步骤 |
| verify:engine | 是 | 必过步骤 |
| verify:figma-baseline | 部分 | 只断言「无参照集 → exit 2 + 点名」的阻塞语义，不是通过 |
| CodeQL | 是 | advanced workflow；首轮 CI **pass**（2m11s） |
| dependency-audit | 定时（非 PR 必过） | weekly + 手动 `pnpm audit --prod`；网络失败按阻塞退出 |
| Dependabot | 配置（仓库设置待启用） | `.github/dependabot.yml` 已提交；alerts/security updates 属人工项 |
| dependency-review | 否（手动） | 依赖图未启用（首轮 CI `not supported`），workflow 仅 `workflow_dispatch`，按阻塞登记 |
| guard:deps / guard:channel-pairing | 否 | 未实现桩（exit 2），不接 CI |
| verify:daemon / mcp-stub / ai-two-state / image-two-state | 否 | 仅本地 |
| verify:market | 否 | 仅本地，且需播种索引 |
| verify:canvas / e2e:smoke | 否 | 仅本地；e2e 114 步 / 4 known-red |
| verify:self-designed / verify:shell-parity | 否 | 仅本地；shell 需 Electron 与显示环境 |
| verify:mk-01…05 | 否 | 需仓外采集/评测产物 |
| 生产构建 desktop | 否 | 仅本地（CI 不拉 Electron 二进制） |
| `test:mutation` / `audit:a11y` | 否 | 仅本地；a11y 2 critical / 5 serious known-red |
| 逐页/逐组件 Figma 门禁 | 否 | 浏览器挂点 |

### 1.3 仓库与 PR 事实

- `main` **没有 branch protection**（`GET /branches/main/protection` → 404）；CI 绿是约定，不是合并强制条件。
- PR **#49**（base `integration/batch5`）`statusCheckRollup` 为空：**完全没有 CI 检查**；PR #48（base main）有成功 `verify`。
- 工作流文档与实测存在漂移：e2e 仍写「10 步」（实际 6 场景 114 步）、canvas 仍写「6 断言」（实际 7 断言 + 15 接线）；`verify-canvas` / 两态门禁仍自起 `next dev`（工作流要求生产构建）。归 #60（审计 10b 已同步门禁实况与 known-red 口径，漂移细节见 `60-ci-hardening.md`）。

## 2. 五态能力表统计

### 2.1 主表（#52，59 项）

| 域 | working | partial | missing | broken | blocked | 合计 |
|---|---:|---:|---:|---:|---:|---:|
| 编辑器与评审 | 16 | 3 | 0 | 0 | 2 | 21 |
| AI 与出图 | 5 | 0 | 2 | 0 | 2 | 9 |
| 市场与桌面壳 | 8 | 4 | 2 | 0 | 2 | 16 |
| 导入导出与设置 | 10 | 2 | 1 | 0 | 0 | 13 |
| **合计** | **39** | **9** | **5** | **0** | **6** | **59** |

### 2.2 深挖后的修正（不修改 01–08 报告，汇总时标注）

| 域 | working | partial | missing | broken | blocked | 合计 | 修正 |
|---|---:|---:|---:|---:|---:|---:|---|
| 编辑器与评审 | 16 | 3 | 0 | 0 | 2 | 21 | 无 |
| AI 与出图 | 3 | 2 | 2 | 0 | 2 | 9 | B-05/B-06 working → partial |
| 市场与桌面壳 | 8 | 4 | 2 | 0 | 2 | 16 | 无（C-05 严重度加重） |
| 导入导出与设置 | 9 | 2 | 1 | 1 | 0 | 13 | D-01 partial → broken；D-10 working → partial |
| **合计** | **36** | **11** | **5** | **1** | **6** | **59** | — |

要点：

- 主路径整体可用：编辑器 13 类交互、保存/重开、市场检索与装载边界、AI 无 key 降级、ComfyUI 失败态、MCP 桩、设置/诊断均有真链路或三态门禁证据。
- 9 条 partial 是规格未达，不是「全绿」能掩盖的：评论/版本仅 localStorage、代码导出缺 HTML/Tailwind、市场三项筛选只作用当前页、D5 试跑只记计数、看板多层未上报、设计系统卡 0（#39）、导出渲染简化、跨版本 `$version` 静默接受。
- 5 条 missing 是闭环缺口：`.dfg` 外部导入、出图任务持久化（P4b）、受控 AI 写入（P5）、市场真实写入（P5）、MCP 真网关（P5）。
- 6 条 blocked 全部点名前置：REF-01、Electron 二进制、无 DeepSeek key、无 ComfyUI 8188。不能写成通过，也不能算产品缺陷。

### 2.3 全规格差距单（26 项）

| 状态 | 数量 | 内容 |
|---|---:|---|
| blocked | 6 | REF-01、术语校准、Electron、真 DeepSeek key、真 ComfyUI、digest 裁决（#39） |
| planned | 7 | MCP 真网关、市场真实写入、受控 AI 写入、D5 沙箱试跑、P1 性能、市场 v2、P6/圈外 |
| missing | 13 | 覆盖率、mutation/PBT、契约快照、axe、故障注入、flake、跨平台、供应链、branch protection、CI 门禁、三守卫、市场索引播种、文档漂移 |

质量类 missing 中：故障注入接缝（`verify:resilience`）与 MCP 契约快照已实现；其余统一归 #60。planned 项不冒充本段失败；blocked 项只在 epic/报告登记。

## 3. Findings、issue 与 epic

### 3.1 5 个 epic

| epic | 范围 | 子 issue | 链接 |
|---|---|---:|---|
| 本地服务与数据安全 | daemon IO/路径安全、并发/崩溃、损坏 `.dfg`、凭据/遥测、CORS | 10 | [#62](https://github.com/QIUZI-HONG/DesignForge/issues/62) |
| 编辑器与评审 | 13 类交互、保存/重开、评审、500 节点、axe/WCAG | 9 | [#63](https://github.com/QIUZI-HONG/DesignForge/issues/63) |
| AI 与出图 | 两态、BYOK、prompt injection、ComfyUI、任务持久化 | 8 | [#64](https://github.com/QIUZI-HONG/DesignForge/issues/64) |
| 市场、桌面壳与 MCP | 分页/过滤、索引、装载 token、壳、MCP 契约/网关 | 7 | [#65](https://github.com/QIUZI-HONG/DesignForge/issues/65) |
| 导入导出、设置与诊断 | PNG/SVG/PDF、`.dfg` 兼容、设置/诊断/遥测 | 6 | [#66](https://github.com/QIUZI-HONG/DesignForge/issues/66) |

### 3.2 本地服务与数据安全（epic #62）

| issue | finding | 五态 | 级别 | 摘要 |
|---|---|---|---|---|
| [#67](https://github.com/QIUZI-HONG/DesignForge/issues/67) | F-03-01 | broken | A | 跨进程并发建页丢失已回 201 页面 |
| [#68](https://github.com/QIUZI-HONG/DesignForge/issues/68) | F-03-02 | broken | A | CORS `Origin: null` 沙箱 iframe 越权读写删 |
| [#70](https://github.com/QIUZI-HONG/DesignForge/issues/70) | F-03-03 | broken | B | 根内软链跨文档别名读写 |
| [#71](https://github.com/QIUZI-HONG/DesignForge/issues/71) | F-03-04 | broken | B | manifest 提交失败时正文已生效（半提交） |
| [#72](https://github.com/QIUZI-HONG/DesignForge/issues/72) | F-03-05 / F-07-05 | broken | B | 20k 层嵌套页读取 500 |
| [#93](https://github.com/QIUZI-HONG/DesignForge/issues/93) | F-03-06 / F-03-12 | broken | C | 500 泄漏绝对路径；删除竞态 500 |
| [#94](https://github.com/QIUZI-HONG/DesignForge/issues/94) | F-03-07 / F-03-08 | partial | C | 孤儿 `.dfg` 不可删；崩溃遗留 `.tmp` 不清理 |
| [#95](https://github.com/QIUZI-HONG/DesignForge/issues/95) | F-03-09 / F-07-07 / F-07-08 | partial | C | 遥测自由文本泄漏；`totalTokens` 误脱敏 |
| [#96](https://github.com/QIUZI-HONG/DesignForge/issues/96) | F-03-10 / F-03-14 | partial | C | MCP 深嵌套 args 500；pending 重启丢失 |
| [#97](https://github.com/QIUZI-HONG/DesignForge/issues/97) | F-03-11 / F-07-09 | broken | C | 损坏 `credentials.key` 无复位入口 |

### 3.3 编辑器与评审（epic #63）

| issue | finding | 五态 | 级别 | 摘要 |
|---|---|---|---|---|
| [#73](https://github.com/QIUZI-HONG/DesignForge/issues/73) | F-04-01 / A-14 / A-15 | partial | B | 评论/版本仅存 localStorage，未入 `.dfg` |
| [#74](https://github.com/QIUZI-HONG/DesignForge/issues/74) | F-04-02 | broken | B | 市场类别伪 tablist（axe critical） |
| [#75](https://github.com/QIUZI-HONG/DesignForge/issues/75) | F-04-03 | broken | B | 首页 searchbox 使用 `aria-expanded`（axe critical） |
| [#76](https://github.com/QIUZI-HONG/DesignForge/issues/76) | F-04-04 | broken | B | 三页对比度未达 WCAG AA（最低 2.09:1） |
| [#77](https://github.com/QIUZI-HONG/DesignForge/issues/77) | F-04-05 | broken | B | 可访问名不含可见文本 |
| [#78](https://github.com/QIUZI-HONG/DesignForge/issues/78) | A-13 | partial | B | 代码导出缺 HTML/Tailwind |
| [#99](https://github.com/QIUZI-HONG/DesignForge/issues/99) | F-04-06 / F-04-07 / F-04-08 | partial | C | 门禁取样根/快捷键/页探测 404 |
| [#100](https://github.com/QIUZI-HONG/DesignForge/issues/100) | F-04-09 | partial | C | 画布内容无可访问替代表述 |
| [#101](https://github.com/QIUZI-HONG/DesignForge/issues/101) | F-04-10 | missing | C | 评审六态 disabled/loading/error 未实现（planned） |

补充：画布 13 类交互、保存→重开逐字段恢复、评论发布/解决/刷新、版本快照/对比/两步确认、演示键盘翻页、文本内联编辑、自动布局入口全部通过（14 交互 + 3 持久化 + 9 评审 + 2 文本/布局，0 失败）。500 节点 measure-only：rAF 中位 33.3ms、p95 50.1ms（≈30/20fps），不设预算。axe 2 critical + 5 serious，空可访问名的可交互元素为 0，Tab 无焦点陷阱。

### 3.4 AI 与出图（epic #64）

| issue | finding | 五态 | 级别 | 摘要 |
|---|---|---|---|---|
| [#83](https://github.com/QIUZI-HONG/DesignForge/issues/83) | F-06-01 | broken | B | 取消排队任务用全局 `/interrupt`，误杀运行中任务且队列未删 |
| [#84](https://github.com/QIUZI-HONG/DesignForge/issues/84) | F-06-02 | broken | B | 上游只发 `[DONE]`/坏 JSON 被判成功 |
| [#85](https://github.com/QIUZI-HONG/DesignForge/issues/85) | F-06-03 / F-06-06 | broken | B | 慢 `/object_info` 误判缺模型；重新探测受缓存影响 |
| [#90](https://github.com/QIUZI-HONG/DesignForge/issues/90) | F-06-12 / B-08 | missing | B | 出图任务持久化/崩溃恢复缺失（P4b） |
| [#91](https://github.com/QIUZI-HONG/DesignForge/issues/91) | F-06-13 / B-09 | missing | B | 受控 AI 写入/变更提案缺失（P5） |
| [#103](https://github.com/QIUZI-HONG/DesignForge/issues/103) | F-06-04 / F-06-05 | broken | C | 产物取回失败仍成功；任务失联永久 queued |
| [#104](https://github.com/QIUZI-HONG/DesignForge/issues/104) | F-06-07 / F-06-08 / F-06-09 | partial | C | 401 映射、流式丢参数、终态遥测缺段 |
| [#105](https://github.com/QIUZI-HONG/DesignForge/issues/105) | F-06-10 / F-06-11 | partial | C | 两态门禁取证边界与 mock 保真度 |

补充：无 key 降级、mock 流式四步时序、BYOK 0600/AES-GCM/掩码/重启/清除、客户端断连中止、60s 超时、未启动/缺模型/OOM/取消（运行中）均通过；prompt injection 未发现越权写入/命令执行/密钥读取，防线是「能力不存在」（B-09 missing），不是输入过滤。

### 3.5 市场、桌面壳与 MCP（epic #65）

| issue | finding | 五态 | 级别 | 摘要 |
|---|---|---|---|---|
| [#79](https://github.com/QIUZI-HONG/DesignForge/issues/79) | F-05-01 / C-05 | partial | B | 过滤只作用已加载页；首屏 0 命中时后续页不可达 |
| [#80](https://github.com/QIUZI-HONG/DesignForge/issues/80) | F-05-03 | partial | B | 索引部分损坏被静默吞掉，`verify:market` 假绿 |
| [#81](https://github.com/QIUZI-HONG/DesignForge/issues/81) | C-09 | partial | B | D5 试跑只记本地计数，未执行示例 |
| [#82](https://github.com/QIUZI-HONG/DesignForge/issues/82) | C-10 | partial | B | 看板 ODS/DWD/DWS/runId/水位未上报 |
| [#88](https://github.com/QIUZI-HONG/DesignForge/issues/88) | F-05-02 / C-08 | missing | B | 市场真实写入/卸载/更新未实现（P5） |
| [#89](https://github.com/QIUZI-HONG/DesignForge/issues/89) | F-05-05 / C-16 | missing | B | MCP 真网关与双端读写未实现（P5） |
| [#102](https://github.com/QIUZI-HONG/DesignForge/issues/102) | F-05-06 | partial | C | 装载记录册跨标签页丢更新 |

补充：不可信内容（4 条恶意索引、`<img onerror>`/`<script>`/`<svg onload>`/`javascript:` 等）在真实浏览器未发现可利用 XSS；React 转义足够，唯一 `dangerouslySetInnerHTML` 是编辑器静态主题常量。装载 token 的一次性/超时/取消/重复消费边界全过，但只守前端（真实写入不存在）。`guard:mcp-contract` 固定 7 工具 / 5 caller / TTL / 33 路由 / 5 信封组。

### 3.6 导入导出、设置与诊断（epic #66）

| issue | finding | 五态 | 级别 | 摘要 |
|---|---|---|---|---|
| [#69](https://github.com/QIUZI-HONG/DesignForge/issues/69) | F-07-01 | broken | A | 真实编辑器导出 PNG/SVG/PDF 全空白 |
| [#86](https://github.com/QIUZI-HONG/DesignForge/issues/86) | F-07-02 | partial | B | 导出保真不足：文本/位图/圆角/透明度/多页 |
| [#87](https://github.com/QIUZI-HONG/DesignForge/issues/87) | F-07-04 | partial | B | 未来/非法 `$version` 被静默接受 |
| [#92](https://github.com/QIUZI-HONG/DesignForge/issues/92) | F-07-03 / D-03 | missing | B | `.dfg` 外部导入/打包导出缺失（planned） |
| [#98](https://github.com/QIUZI-HONG/DesignForge/issues/98) | F-03-13 / F-07-06 | broken | C | 导出尺寸无上限/无预检 |
| [#106](https://github.com/QIUZI-HONG/DesignForge/issues/106) | F-07-10 | partial | C | 路径/URL 不 trim、ComfyUI URL 拼接错误、`ai.baseUrl` 外送面 |

补充：设置主路径可用（工作目录切换/回滚、哨兵 key 无明文、ComfyUI scheme 校验、连通性三项、遥测开关/查看/删除）；导出简化渲染器对树状载荷子集正确（PNG/PDF 可外部打开，PDF 无透明度、文本跳过），但真实页信封完全不适配（A 级）。

### 3.7 只登记、不建 issue（10 条）

| ID | 条目 | 处置 |
|---|---|---|
| N-01 | REF-01 参照集未冻结（A-03/A-19/G-01/G-02） | 链接 [#28](https://github.com/QIUZI-HONG/DesignForge/issues/28)；冻结后复跑 figma/canvas/review/shell |
| N-02 | Electron 二进制缺失（C-13/C-14/F-05-04/G-03） | epic 正文登记；`fetch-electron` 后复跑 `verify:shell-parity` |
| N-03 | 真实 DeepSeek key 未注入（B-03/G-04） | 一次性安全注入后手工验收；不进聊天/日志/CI |
| N-04 | 真实 ComfyUI 8188 不可达（B-07/G-05） | 服务+模型可用后复验 F-06-01/F-06-03 |
| N-05 | digest 口径待裁决（C-11/G-06） | 链接 [#39](https://github.com/QIUZI-HONG/DesignForge/issues/39) |
| N-06 | 剩余未实现守卫 `guard:deps` / `guard:channel-pairing` | 归 [#60](https://github.com/QIUZI-HONG/DesignForge/issues/60) |
| N-07 | 覆盖率/mutation/PBT/契约快照/axe/flake/跨平台/供应链/CI 门禁/市场播种/文档漂移 | 归 #60 |
| N-08 | #46 批次 5、#47 Mimosa、#48/#49 未合并分支 | 只链接，不新建同类；#48/#49 只做增量风险审查 |
| N-09 | Windows/macOS 与网络文件系统未覆盖 | 按 blocked 记账；矩阵归 #60 |
| N-10 | flake 观察：并行 vitest 共享 `.vitest-cache` 触发 ENOTEMPTY | 非产品缺陷；归 #60（flake/JUnit/隔离） |

### 3.8 去重映射

- F-03-05 + F-07-05 → **F-03-05**（数据/安全；导入导出 epic 交叉引用）。
- F-03-09 + F-07-07 + F-07-08 → **F-03-09**（遥测脱敏）。
- F-03-11 + F-07-09 → **F-03-11**（凭据复位）。
- F-03-13 + F-07-06 → **F-03-13**（导出尺寸；归导入导出 epic）。
- #52 A-14/A-15 + #54 F-04-01 → **F-04-01**（评审数据持久化；采用 #54 的 B 级判定，保留 A 级数据不可恢复风险注记）。
- #52 C-05 + #55 F-05-01 → **F-05-01**（过滤×分页）。
- #52 C-08 + #55 F-05-02 → **F-05-02**（市场真实写入）；#52 C-16 + #55 F-05-05 → **F-05-05**（MCP 真网关）。
- #52 C-13/C-14 + #55 F-05-04 → 只登记 blocked（Electron/REF-01）。
- #52 B-08 + #56 F-06-12 → **F-06-12**；#52 B-09 + #56 F-06-13 → **F-06-13**。
- #52 D-01 + #57 F-07-01/F-07-02 → **F-07-01（A）/ F-07-02（B）**；D-03 + F-07-03 → **F-07-03**；D-04 + F-07-04 → **F-07-04**。
- F-03-02（CORS `Origin: null`）与 F-07-10（`ai.baseUrl` 外送面）分别登记，在安全/导入导出 epic 互相引用。

## 4. 回归与门禁现状

### 4.1 e2e：110 pass / 4 fail

`e2e:smoke` 现为 6 场景 / 114 步（canvas 10、editor 34、home 8、market-pagination 13、nav 21、settings 21），**110 pass / 4 fail / 0 blocked，exit 1**。4 条红全部是真实缺陷：

| # | 红步骤 | 缺陷 |
|---:|---|---|
| 1 | 导出 PNG 含设计内容（页面底色 + 矩形像素） | F-07-01（#69） |
| 2 | 导出 SVG 含设计节点（背景之外） | F-07-01（#69） |
| 3 | 导出 PDF 含设计内容（外部渲染/内容流填充） | F-07-01（#69） |
| 4 | 首屏 0 命中但已加载 < 总数时「加载更多」不得消失 | F-05-01（#79） |

四类不变量成立：无 pageerror；请求只在同源网关（editor 204 / market 43 / settings 99 次，无 3000/4318 直连）；无 console 错误（editor 仅 1 条已登记的 `page-{N}` 探测 404，按 URL 精确放行）；持久化往返逐字段一致。

### 4.2 韧性：31 pass / 9 fail / 0 blocked / 7 observe

`node scripts/verify-resilience.mjs` = **47 步，exit 1**；9 个 fail 全部对应 A/B 缺陷（跨进程丢页、根内软链、半提交、深嵌套页读取、CORS `null` 等），不是环境阻塞。缺 C 编译器时故障注入段按 `exit 2` 点名；**存在其它断言失败时按违规 `exit 1` 优先**（违规优先于阻塞）。该门禁**仅本地、未接 CI**；自测 10 例已随 `test:scripts` 进 CI。

### 4.3 MCP 契约：已实现并接 CI

`guard:mcp-contract` 退出 0：7 工具 / 5 caller / TTL / 33 路由 / 5 信封组与快照一致；快照 `scripts/snapshots/mcp-contract.v1.json`；有意变更必须 `--update` 并审阅 diff。CI 已有必过步骤。P5 换实现不得改快照形状。

### 4.4 市场门禁假绿

- 空根 → exit 2（`index-missing`）；索引损坏 → exit 2（`index-invalid`）；检索索引损坏 → exit 2（`search-index-invalid`）：三态语义正确。
- **部分损坏**（1/344 缺 `source.repo`）→ `total=343`、`counts.total=344`、`warnings=[]`、`verify:market` **exit 0**：静默丢卡 + 计数不一致 + 门禁假绿（#80）。

### 4.5 CI 现状（#107/#108 合并后）

**已进 CI（必过或定时）**：lint / typecheck / `test:coverage`（9 包采集 + 9 包阈值，测试在覆盖率步骤内执行，不重复跑 `pnpm test`）/ web 生产构建 / `test:scripts` / 五个守卫 / `verify:engine` / 参照集阻塞语义断言；CodeQL advanced workflow 首轮 pass；`dependency-audit` weekly（不进 PR 必过）；Dependabot 配置已提交（仓库设置待管理员）。CI 顶层 `permissions: contents: read`，`verify` job id/name 不变（branch protection context 仍是 `verify`）。

**仍未进 CI（不得当绿）**：

- `test:mutation` 与 `audit:a11y`：选择性 / 需生产构建 + Chromium，仅本地；axe 审计期 2 critical / 5 serious（#74–#77）为 known-red。
- `e2e:smoke`：6 场景 114 步 = 110 pass / 4 known-red（F-07-01×3 #69 + F-05-01×1 #79）；修复前不接必过。
- `verify:resilience`：47 步 / 9 known-red（#67 等 A/B 缺陷），仅本地。
- 浏览器门禁（`verify:figma-*` / `verify:canvas` / `verify:shell-parity`）：仍为挂点（REF-01 / Electron block）。
- `guard:deps` / `guard:channel-pairing`：未实现桩（exit 2），不接 CI。
- dependency-review：仓库依赖图未启用，workflow 仅手动触发（阻塞登记）。
- `main` 无 branch protection（人工项）；`#49` 因 base 非 main 零 CI 检查。

### 4.6 一次性审计脚本（保留可复现性，不进 CI）

`scripts/audit/editor-review-audit.mjs`（约 1531 行）与 `scripts/audit/io-settings-audit.mjs`（约 2358 行）是审计 04 / 07 的**一次性取证脚本**，不是门禁：依赖仓外证据与人工裁决，跑一次产出证据 JSON 即完成使命。保留在仓库是为了可复现性，**不接 CI、不设阈值、不继续扩功能**；新增门禁走 `scripts/lib/**` 复用与独立门禁脚本。

## 5. #60 CI/门禁改造清单（按优先级）

> 原则：先修已知红或建立**显式 known-red 清单 + 到期日**，再接必过门禁；不得用重试/跳过/放宽断言掩盖。覆盖率/Mutation 先建基线再设阈值。
>
> **现状注记**：本节是审计 09 时点的改造清单（「现状」列不再维护）；实际落地状态以 §1.2 / §4.5 为准——覆盖率（9 包阈值）、web 生产构建、CodeQL 已进 CI；mutation / axe / e2e / resilience / 浏览器门禁仍未进 CI。

### P0（先做，否则 CI 仍不是门禁）

| # | 项 | 现状 | 目标 |
|---:|---|---|---|
| 1 | 已知红处置 | e2e 4 红（F-07-01×3 + F-05-01）；resilience 9 红 | 修复 #69/#79 与 A/B 缺陷后转绿；修复前 e2e/resilience 不得接必过 CI；如要提前接，必须显式 known-red 清单（含到期日），禁止静默跳过 |
| 2 | 覆盖率 + mutation | 无覆盖率门禁；mutation/PBT 缺失 | 按包采集覆盖率并设阈值（先 engine/daemon/contracts）；至少对核心引擎与 daemon 写路径做 mutation；阈值不得低于基线 |
| 3 | axe | 只有一次性审计脚本；jsdom 键盘断言不是 axe | 接入现有 e2e/浏览器门禁：先断言 critical=0；修复 #74–#77 后 serious=0；上传 axe JSON 证据 |
| 4 | flake/JUnit | e2e runner 无 JUnit；并行 vitest 共享 `.vitest-cache` 曾触发 ENOTEMPTY | e2e 输出 JUnit/尝试记录；按失败分类隔离，禁止盲目重试；隔离 vitest 缓存或串行化共享缓存 |
| 5 | 生产构建 + e2e 进 CI | 均只在本地 | CI 增加 `next build` + `e2e:smoke`（6 场景 114 步）；上传 `fe-02/e2e/<stamp>` 证据与导出产物；按场景设超时 |
| 6 | 供应链 | 只有手工 `pnpm audit --prod` | 增加依赖审计（含重试）、CodeQL、dependency-review；配置 Dependabot；「0 漏洞」必须可复现 |
| 7 | branch protection（人工） | main 无保护；#49 零检查 | 启用必需检查（至少 `verify`；build/e2e 稳定后加入），禁止绕过；管理员授权项 |

### P1（紧随其后）

| # | 项 | 现状 | 目标 |
|---:|---|---|---|
| 8 | 契约快照 | MCP 已有；daemon↔web↔CLI、market schema 无 | 补契约快照；有意变更 `--update` + 同 PR 审阅 diff |
| 9 | 剩余守卫 | `guard:deps` / `guard:channel-pairing` 仍是 exit 2 桩 | 实现并接 CI；实现前保持阻塞语义，不得当绿 |
| 10 | `verify:market` 部分损坏 | 1/344 坏卡静默 + exit 0 | daemon 返回 `index-partial` + counts 对账；门禁断言 `currentTotal == counts.total` 或显式 warning；CI 用冻结夹具索引播种 |
| 11 | `verify:resilience` 接 CI | 仅本地、exit 1 | A/B 修复后转 0；缺 C 编译器且无其它断言失败时按 exit 2 点名，有断言失败时 exit 1 优先；评估 CI 安装 shim 工具链 |
| 12 | 桌面壳门禁 | Electron/REF-01 blocked | 保持显式 exit 2；环境允许时跑 smoke/alive/parity；不得用静态结论冒充运行态 |
| 13 | 文档漂移 | e2e 10 vs 114、canvas 6 vs 7+15、`next dev` vs 生产构建 | #60 同步 `AGENTS.md` 与 `docs/agents/implementation-workflow.md`；门禁实况两处同源 |

### P2（后续）

| # | 项 | 现状 | 目标 |
|---:|---|---|---|
| 14 | 跨浏览器/平台 | 仅 Linux + Chromium；Windows/macOS 未覆盖 | Windows 冒烟、macOS 发布前人工；跨浏览器矩阵按环境 blocked |
| 15 | 视觉基线 | REF-01 未冻结 | #28 冻结后接逐页/逐组件对照；视觉段从 exit 2 转正式判定 |
| 16 | 性能预算 | 500 节点 only measure（rAF 中位 33.3ms） | 性能预算票落地后设阈值；当前只记录 |
| 17 | 安全 PBT/fuzz | engine 固定种子子集 | 扩大固定种子 fuzz/PBT 到 daemon 写路径与序列化边界 |

## 6. Blocked / human 项

| 项 | 类型 | 前置/动作 | 关联 |
|---|---|---|---|
| REF-01 参照集冻结 | blocked | 完成 Figma 中文界面采集（1440×900、DPR1.5、浅/深双版）并冻结哈希 | #28；A-03/A-19/G-01/G-02；#60 P2 |
| Electron 二进制 | blocked | `pnpm --filter @dforge/desktop fetch-electron`（可配镜像）后复跑 shell 三段 | C-13/C-14/F-05-04；#65 |
| 真实 DeepSeek key | blocked | 用户安全注入后一次性手工验收；不进聊天/日志/CI | B-03/G-04；#64 |
| 真实 ComfyUI | blocked | 启动 ComfyUI + 模型；复验取消/`object_info` | B-07/G-05；#64 |
| digest 口径 | human | 裁决 §1.6 全文件摘要 vs 采集预算；设计系统卡 0 | #39；C-11/G-06 |
| branch protection | human（管理员） | 启用必需检查并禁止绕过 | #60 P0-7 |
| CodeQL/Dependabot | human（管理员） | 仓库设置与 workflow 启用 | #60 P0-6 |
| Mimosa 提交门禁策略 | human | 7 条已知误报的处置 | #47 |
| 批次 5 可测性 | human | 可达性门禁/转发回归/选择器导航等 | #46 |
| #48/#49 未合并分支 | 增量风险 | 只做增量审查，不作主判定；#49 无 CI | #48/#49 |
| 真实磁盘 ENOSPC/EIO/掉电、NFS/SMB | 环境 | 本环境不可复现；以 syscall 注入记账 | 审计 03 §6 |
| Windows/macOS 路径与保留名 | 环境 | 后续矩阵 | #60 P2 |
| `/proc/1/*` 工作目录 | 环境 | WSL2 下 Node recursive mkdir 无限挂起，未判定 | 审计 07 §9 |

## 7. 证据索引

| 内容 | 路径 |
|---|---|
| 01 基线 | `docs/quality/audit-v1/01-baseline.md`；`~/df-evidence/audit-50/aud-01/`（`baseline.json`、29 条日志、`results.tsv`） |
| 02 能力表 | `docs/quality/audit-v1/02-capability.md`；`~/df-evidence/audit-50/aud-02/` |
| 03 数据/安全 | `docs/quality/audit-v1/03-data-security.md`；`~/df-evidence/audit-50/aud-03/`（probe1–6、`verify-resilience.evidence.json`） |
| 04 编辑器/评审 | `docs/quality/audit-v1/04-editor-review.md`；`~/df-evidence/audit-50/aud-04/`（`editor-review-*.json`、`axe/`、`shots/`） |
| 05 市场/壳/MCP | `docs/quality/audit-v1/05-market-shell-mcp.md`；`~/df-evidence/audit-50/aud-05/`（`browser-*.json`、`market-probe-*.json`、`data/`） |
| 06 AI/出图 | `docs/quality/audit-v1/06-ai-image.md`；`~/df-evidence/audit-50/aud-06/`（`probes/`、`fe-10/`） |
| 07 导入导出/设置 | `docs/quality/audit-v1/07-io-settings.md`；`~/df-evidence/audit-50/aud-07/`（`io-settings-audit.evidence.json`、`artifacts/`、`probes/`） |
| 08 跨域 e2e | `docs/quality/audit-v1/08-cross-domain.md`；`~/df-evidence/audit-50/aud-08/`（`fe-02/e2e/2026-10-17T13-37-56/`、`cors-probe/`、`baseline-fake-green/`） |
| 本票登记表 | `~/df-evidence/audit-50/aud-09/register.json`、`register.md`、`created.json`、`create-issues.log` |
| CI 工作流 | `.github/workflows/ci.yml`（当前版本） |
| 导出内容判定 | `scripts/lib/export-artifact.mjs`、`scripts/tests/export-artifact.test.mjs`、`scripts/e2e/scenarios/editor.mjs` |
| 韧性接缝 | `scripts/verify-resilience.mjs`、`scripts/tests/verify-resilience.test.mjs`、`scripts/fixtures/fs-fault-shim.c` |
| MCP 契约 | `scripts/guard-mcp-contract.mjs`、`scripts/snapshots/mcp-contract.v1.json`、`scripts/tests/guard-mcp-contract.test.mjs` |
| 市场过滤×分页 | `scripts/e2e/scenarios/market-pagination.mjs` |
| 设置/诊断 | `scripts/e2e/scenarios/settings.mjs` |

## 8. 关联 issue

- 审计规格：[#50](https://github.com/QIUZI-HONG/DesignForge/issues/50)；本票 [#59](https://github.com/QIUZI-HONG/DesignForge/issues/59)；CI/门禁硬化 [#60](https://github.com/QIUZI-HONG/DesignForge/issues/60)；集成 PR [#61](https://github.com/QIUZI-HONG/DesignForge/pull/61)。
- 5 个 epic：[#62](https://github.com/QIUZI-HONG/DesignForge/issues/62)、[#63](https://github.com/QIUZI-HONG/DesignForge/issues/63)、[#64](https://github.com/QIUZI-HONG/DesignForge/issues/64)、[#65](https://github.com/QIUZI-HONG/DesignForge/issues/65)、[#66](https://github.com/QIUZI-HONG/DesignForge/issues/66)。
- 40 个子 issue：#67–#106（见 §3 各表；全部 `needs-triage`；A/B 缺陷 `bug`，a11y 加 `accessibility`，缺口 `enhancement`）。
- 只链接、不重复：#28（REF-01）、#39（digest）、#46（批次 5）、#47（Mimosa）、#48/#49（未合并分支）。
- 未关闭：#50、#61 保持打开；#61 仍为 draft/由负责人决定。

## 9. 最终结论

审计完成，A/B 缺陷与缺口已登记，放行判断由负责人按分级决定。

- **A 级 3 条**是放行前必须决策的不可逆风险：静默丢页（#67）、CORS null 越权（#68）、导出空白（#69）。
- **B 级 23 条**（18 缺陷 + 5 planned）默认阻断但可书面豁免；其中 a11y 4 条、评审持久化、导出保真、市场过滤/索引、AI 出图契约是主要风险面。
- **C 级 14 条**（13 观察 + 1 planned）进 backlog；同类已合并，避免碎片化。
- **blocked 6 项**（REF-01、术语、Electron、真 DeepSeek、真 ComfyUI、digest）保持阻塞记账，不写成通过。
- **CI 已覆盖常规链路、覆盖率（9 包阈值）、web 生产构建、非浏览器守卫与 CodeQL**；仍不是完整门禁：mutation / axe / e2e（4 known-red）/ resilience（9 known-red）/ 浏览器门禁未进 CI，dependency-review 因依赖图未启用改手动，branch protection 仍是人工项。修复已知红之前不得把 e2e/resilience 接成必过。
- 本报告不作发布放行结论；审计阶段未修产品代码，修复按 issue 逐项确认。
