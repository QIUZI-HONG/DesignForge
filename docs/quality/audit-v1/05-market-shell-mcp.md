# 审计 05 · 市场、桌面壳与 MCP 深挖（含契约快照）

- **状态**：已完成（本票证据根 `~/df-evidence/audit-50/aud-05/`；机器可读结果见 §12）
- **日期**：2026-10-17（UTC 12:5x–13:1x；本地 UTC+8）
- **代码基线**：`main` @ `c6b1654`（= 审计 01 基线）；本票基于 `integration/audit-v1` @ `433b520`（#52 合并后 tip），
  收尾 merge `8c21da6`（#53/#54 合并后 tip）
- **本票分支/工作树**：`audit/05-market-shell-mcp` / `/home/QIU/df-wt/aud-05`
- **上游**：审计 01 `01-baseline.md`、审计 02 `02-capability.md`（重点 C-05 / C-08 / C-10 / C-11 / C-13）
- **范围**：市场增量分页/过滤×分页/索引缺失与损坏/部分失败/不可信内容/装载 token/真实写入缺口；
  桌面壳静态与运行态；MCP 桩与契约快照接缝（本票唯一代码接缝）。

## 0. 判定口径

- 五态：`working` / `partial` / `missing` / `broken` / `blocked`（定义同 #50 规格与审计 02 §0.1）。
- 分级：A 阻断（主路径不可用、安全或数据丢失）；B 严重（功能不可达/规格未达）；C 一般/观察。
- 证据纪律：每条结论有可复核 JSON/日志/截图；阻塞（`exit 2`）不写成通过；未实现只登记缺口。
- 数据纪律：所有 daemon/web 实例使用**临时数据根 + 空闲端口**；未触碰常驻 3000/4318 与 `~/.dforge`；
  `TMPDIR` 指向证据目录（`~/df-evidence/audit-50/aud-05/tmp`），未使用 `/tmp`；未使用 `pkill -f`，
  临时进程按精确 PID 回收。

## 1. 环境

| 项 | 值 |
|---|---|
| Node / pnpm | v24.9.0 / 10.33.2（根 `packageManager`） |
| Chromium | `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`（playwright-core 1.63.0） |
| 市场数据 | MK-05 真实批次：`~/df-evidence/mk-05/batch/data/ads/`（index 344 卡 / search index；design-system 0） |
| Web | 生产构建 `pnpm --filter @dforge/web build`（exit 0），`next start` 空闲端口 |
| 显示 | `DISPLAY=:0` / `WAYLAND_DISPLAY=wayland-0`（WSLg 可用） |
| Electron | **二进制缺失**：`apps/desktop/node_modules/electron/dist/electron` 不存在（未下载 123MB） |

## 2. 门禁结果（真实退出码）

| 门禁 | 命令/数据根 | 退出码 | 证据（`~/df-evidence/audit-50/aud-05/`） | 结论 |
|---|---|---:|---|---|
| verify-market（MK-05 播种） | `pnpm verify:market`，`gate-evidence/fe-11/verify-market-2026-10-17T13-01-36.json` | **0** | `logs/verify-market-seeded.log` | 令牌 + 六态 + 真数据面 + E1–E3 全过（searchTotal 78） |
| verify-market（索引缺失） | 空数据根，`…13-01-39.json` | **2** | `logs/verify-market-missing.log` | `warnings:[index-missing]`；阻塞语义正确 |
| verify-market（索引损坏） | 截断 JSON，`…13-01-40.json` | **2** | `logs/verify-market-corrupt-index.log` | `warnings:[index-invalid]`；阻塞语义正确 |
| verify-market（检索索引损坏） | 市场索引正常 + search index 截断，`…13-01-41.json` | **2** | `logs/verify-market-corrupt-search.log` | 市场查询 pass（字面兜底）；E1 因 `search-index-invalid` 阻塞 |
| verify-market（索引部分损坏） | 1/344 卡缺 `source.repo`，`…13-09-58.json` | **0** | `logs/verify-market-partial.log`；`gate-evidence/aud-05/market-probe-partial.json` | **门禁假绿**：静默丢卡 + 计数不一致仍通过（F-05-03） |
| 市场数据面探针 | 真实前端纯函数 + 真实 daemon | 0 | `gate-evidence/aud-05/market-probe-good.json` / `…partial.json` | C-05、token、C-08 的结构化证据 |
| 浏览器审计（正常索引） | 生产构建 + Chromium | 0 | `gate-evidence/aud-05/browser-good.json` + 3 张截图 | C-05 过滤×分页、装载闭环 |
| 浏览器审计（恶意索引） | 生产构建 + Chromium | 0 | `gate-evidence/aud-05/browser-malicious.json` + 2 张截图 | XSS/HTML 注入面 |
| verify-shell-parity | `pnpm verify:shell-parity` | **2** | `logs/verify-shell-parity.log`；`gate-evidence/fe-12/shell-parity-2026-10-17T13-07-22Z/evidence.json` | smoke/alive：Electron 缺失；parity：参照集未冻结 |
| guard-electron-baseline | `pnpm guard:electron-baseline` | **0** | `logs/guard-electron-baseline.log` | 安全五项静态通过 |
| desktop 单测 | `pnpm --filter @dforge/desktop test` | **0** | `logs/desktop-test.log` | 13 文件 / **122 例**全过 |
| desktop 构建 | `pnpm --filter @dforge/desktop build` | 0 | `logs/build-desktop.log` | `tsc` 通过 |
| verify-mcp-stub | `pnpm verify:mcp-stub` | **0** | `logs/verify-mcp-stub.log`；`gate-evidence/fe-10/verify-mcp-stub.json` | 16/16 步；真实进程 + 短 TTL 注入 |
| guard-mcp-contract（新实现） | `pnpm guard:mcp-contract` | **0** | `logs/guard-mcp-contract.log`；`gate-evidence/aud-05/guard-mcp-contract.json` | 7 工具 / 5 caller / TTL / 33 路由 / 5 信封组与快照一致 |
| test:scripts | `pnpm test:scripts` | **0** | `logs/test-scripts.log` | 63 例（新增 7 例契约守卫检出强度） |
| verify（全量） | `pnpm verify` | **0** | `logs/verify.log` | lint + typecheck + 9 包单测全绿 |
| web 生产构建 | `pnpm --filter @dforge/web build` | 0 | `logs/build-web.log` | 13 路由生成成功 |

汇总：**17 次执行 = 退出码 0 共 13 次 / 1 共 0 次 / 2 共 4 次**（shell 段内部三段各为 2，stage 级共 6 个阻塞）。
4 个 `exit 2` 全部门禁级点名前置（Electron、REF-01、索引缺失、索引损坏、检索索引损坏）；
其中「索引部分损坏」反而 exit 0，是本节唯一的假绿。

收尾 merge 后复跑：`pnpm verify` 首次因 `pnpm -r test` 并行共享
`node_modules/.vitest-cache` 触发 `ENOTEMPTY` 启动错误（engine 包，非用例失败）；单包重跑 312/312
通过、二次 `pnpm verify` exit 0。属测试工装 flake（共享缓存竞争），记入观察并交 #59（flake 观测/隔离），
证据 `logs/verify-after-merge.log`（失败）与 `logs/verify-after-merge-2.log`（通过）。

## 3. Findings

### 3.1 汇总（6 条）

| ID | 能力/域 | 五态 | 级别 | 一句话 | 证据 |
|---|---|---|---|---|---|
| F-05-01 | 市场 D3 过滤×分页（C-05） | partial | **B** | 三项客户端过滤只作用于已加载页；首屏 0 命中时「加载更多」消失，后续页不可达 | `browser-good.json`；`market-probe-good.json` |
| F-05-02 | 市场真实写入/卸载（C-08） | missing | **B** | 装载闭环止于 localStorage 记录；daemon 无写路由/无落盘/无审计 | `browser-good.json` loadFlow；`market-probe-good.json` c08 |
| F-05-03 | 市场索引部分失败 | partial | **B** | 1 条坏卡被静默跳过；`total=343` 与 `counts.total=344` 不一致且无 warning，`verify:market` 仍 exit 0 | `market-probe-partial.json`；`…13-09-58.json` |
| F-05-04 | 桌面壳运行态（C-13/C-14） | blocked | **B** | Electron 二进制缺失 + REF-01 未冻结：冒烟/存活/对照三段均不可判 | `gate-evidence/fe-12/…/evidence.json` |
| F-05-05 | MCP 真网关/双端（C-16） | missing | **B** | 当前为显式桩（`stub:true` / `applied:false`），ZCode/WorkBuddy 真实读写未实现 | `verify-mcp-stub.json`；`apps/daemon/src/mcp/stub.ts` |
| F-05-06 | 装载记录跨标签页一致性 | partial | **C** | `localStorage` 记录册为读改写，两个标签页并发装载会丢更新；token 仅存模块内存（不共享） | `load-store.ts`；`market-probe-good.json` crossTabNote |

统计：**partial 3 / missing 2 / blocked 1 / broken 0 / working 0**；**B 5 / C 1 / A 0**。

### 3.2 详情

#### F-05-01（B）过滤只作用于当前已加载页；首屏 0 命中时后续页不可达

- **复现**（真实生产构建 + Chromium + MK-05 索引；344 卡，首页 limit=60）：
  1. 打开 `/market?daemon=http://127.0.0.1:<port>`，首屏 `已加载 60 / 344`。
  2. 许可档选「仅看」：首屏 **4 张**；点 5 次「加载更多」后 **46 张**（真实全量 = 46）。
  3. 新会话在「来源仓库」输入 `vineetu/simple-host`（该仓库 18 条，全部在第 2 页之后）：
     页面进入 **空态「无结果」**，`pagination` DOM **不存在**，无法加载更多。
  4. 新会话预置 284 条「已装载」记录（全部来自第 2–6 页）：切「已装载」同样空态、无加载更多。
- **根因**：`applyClientFilters(allItems, …)` 只过滤已加载项；`renderPagination()` 在
  `visible.length === 0` 时直接返回 `null`（`apps/web/src/app/market/page.tsx:176`），
  于是「客户端过滤后为 0」与「服务端真的没有」在 UI 上不可区分。
- **实测数据**：许可档 `view-only` 首屏 4 → 全量 46（42 条需加载更多）；来源仓库首屏 0 / 全量 18；
  `loadedOnly` 首屏 0 / 全量 284。纯函数层与浏览器层结论一致。
- **影响**：用户被告知「无结果」，实际存在资产；过滤结果不完整且分页入口被移除（不是仅「作用域小」）。
- **建议**：把 `licenseGate`/`repo`（以及可下沉的 `loadedOnly`）下沉 daemon 查询并进入分页 total；
  最低限度在「客户端过滤命中 0 且已加载 < total」时保留「加载更多」并明确空态文案为
  「已加载页无匹配，继续加载」。回归候选见 §10。
- **证据**：`gate-evidence/aud-05/browser-good.json`（`c05.viewOnly` / `repoOnlyOnLaterPages` /
  `loadedOnly`）；截图 `c05-view-only.png`、`c05-repo-filter.png`；`market-probe-good.json` `c05`。

#### F-05-02（B）市场真实写入缺失：闭环止于 localStorage

- **复现**：正常索引下走 UI 装载（首张可装载卡）：dryRun 预览 → 批准并签发一次性 token（120s）→
  确认写入。浏览器 `localStorage['dfg.market.loaded.v1']` 出现 1 条 `LoadRecord`；目标落点
  `.dfg/market/skill/x-research/` 仅存在于文案与记录里。
- **实测**：数据根 `market/` 下只有 `ads`；`skill|plugin|design-system|template` 四个落点目录均为 0；
  `/mcp/audit` 0 条；浏览器捕获的 daemon 请求只有 `GET /market/query` 与 `POST /market/load-plan`，
  `writeRequestSeen=false`。
- **影响**：装载/卸载/更新均不落盘、无审计，刷新/清站点数据即丢失「已装载」状态；与规格 §7.3/§7.4
  的「单事务写入 + 审计」不符。
- **建议**：归 P5 MCP 网关 + daemon 市场写路由；写入前做 digest/许可复核，写后审计 JSONL；
  落地后把本探针升级为必红回归（当前只登记缺口）。
- **证据**：`browser-good.json` `loadFlow`；`market-probe-good.json` `c08`；`load-flow-done.png`。

#### F-05-03（B）索引「部分损坏」被静默吞掉，计数不一致且门禁假绿

- **复现**：复制 MK-05 索引，删掉最后一条资产的 `source.repo`（其余 343 条完好），播种临时数据根。
- **实测**：`/market/query` 返回 `state=ok,total=343,counts.total=344,counts.loadable=298,warnings=[]`；
  `q=幻灯片` 命中 77（正常索引 78）；`verify:market` **exit 0**，E3 只断言 `current ≤ global`，
  因此 `343 ≤ 344` 未触发任何失败。
- **根因**：`parseMarketplaceIndex` 返回 `skipped`，`createMarketService` 只取 `ok/index`，
  丢弃 `skipped`；`counts` 直接透传索引原值，未与解析结果对账。
- **影响**：坏卡从检索/详情中消失且无提示；看板显示 344 而市场只能取到 343；门禁无法发现。
  与规格 D3「部分失败态」不符。
- **建议**：daemon 在 `skipped>0` 时返回 warning（如 `index-partial`，含 skipped 计数），
  并用解析后的实际数量对账 `counts`；`verify-market` 增加
  「currentTotal == counts.total 或存在 index-partial warning」断言，否则 exit 1/2。
- **证据**：`market-probe-partial.json`；`gate-evidence/fe-11/verify-market-2026-10-17T13-09-58.json`；
  `logs/verify-market-partial.log`。

#### F-05-04（B · blocked）桌面壳运行态不可判

- `verify-shell-parity` 三段全 `exit 2`：smoke/alive 因
  `apps/desktop/node_modules/electron/dist/electron` 缺失；parity 因 `~/df-evidence/reference-v1` 未冻结。
- 显示环境实际可用、壳已构建（`tsc -p tsconfig.build.json` exit 0），阻塞是环境前置而非产品失败。
- 静态面有效：`guard-electron-baseline` exit 0（五项安全开关）；desktop 13 文件 / 122 例全过，
  覆盖 external-links 白名单、static-server 对抗、窗口选项、装载落点、存活门禁常量同步。
- **解除**：`pnpm --filter @dforge/desktop fetch-electron`（可配镜像）+ REF-01 冻结后复跑三段。
- **证据**：`gate-evidence/fe-12/shell-parity-2026-10-17T13-07-22Z/evidence.json`；
  `logs/verify-shell-parity.log`、`logs/desktop-test.log`、`logs/build-desktop.log`。

#### F-05-05（B · missing）MCP 真网关与双端读写未实现

- 桩行为完整且显式：`stub:true`、`applied:false`、审计 note 含「桩」；`verify:mcp-stub` 16/16
  （dryRun、TTL 120s、批准、重放 403、拒绝、未知工具 400、审计 pending/approved/rejected、
  token 只存哈希、过期 410 + `decision=expired`、前端状态机同判、UI 桩角标）。
- 真网关（ZCode / WorkBuddy 真实读写同一份 `.dfg` 真值）仍缺；提案登记在进程内存，重启即丢（桩已知边界）。
- **建议**：P5 网关接管；契约形状已被本票快照固定，P5 换实现不得改快照（有意变更走 `--update` 审阅）。
- **证据**：`gate-evidence/fe-10/verify-mcp-stub.json`；`apps/daemon/src/mcp/stub.ts`；
  `scripts/snapshots/mcp-contract.v1.json`。

#### F-05-06（C）装载记录册跨标签页丢更新

- `writeLoadRecord` / `removeLoadRecord` 为 `read → filter → setItem` 读改写；两个标签页并发装载不同
  资产时后写者覆盖先写者（最后写入胜）。装载 token 仅存于模块内存（不共享），跨标签页无法看到/批准同一 token。
- **影响**：本地「已装载」徽标/审计记录可能少条目；不影响 daemon 真值（本段本来也没有真实写入）。
- **建议**：记录写入改为按 assetId 的合并（读最新后重试）或用 `storage` 事件同步；真实写入落地后
  以 daemon 审计为真源。观察项，不阻断。
- **证据**：`apps/web/src/features/market/load-store.ts`；`market-probe-good.json` `loadToken.crossTabNote`。

## 4. C-05 / C-08 专项结论

### 4.1 C-05（过滤 × 增量分页）：**partial 确认，且比审计 02 判断更严重**

- 审计 02 只写「三项只作用于当前页」；本轮实测出**二级失效**：首屏 0 命中时加载更多按钮被移除，
  用户没有任何路径加载后续页（不是「多翻几页就能看到」）。
- 数字证据：许可档首屏 4/全量 46；来源仓库首屏 0/全量 18；已装载首屏 0/全量 284；
  页面计数始终显示服务端 total（344/298），与过滤器无关。
- 页面 footer 有「客户端补充过滤」声明，但空态仍写「无结果」——声明不足以消除误导。

### 4.2 C-08（市场真实写入）：**missing 确认**

- daemon 只有 `/market/query`、`/market/assets/:id`、`/market/load-plan` 三条读/提案路由；
  没有任何写入/卸载/更新路由。UI 的批准/消费只生成前端 `LoadRecord` 并写 localStorage。
- 数据根无 `market/<kind>` 落点，MCP 审计 0 条，浏览器请求无写方法。
- 结论：装载闭环最后一跳（单事务写入 + 审计）未实现；与 C-15 桩配套，归 P5。

## 5. 不可信内容（XSS / HTML 注入面）

**结论：本轮未发现可利用的 XSS/HTML 注入。React 文本转义在现有渲染面上足够。**

- 注入面覆盖：`displayName.zh-CN/en`、`summary.zh-CN/en`、`description`、`facets.tags`、
  `facets.scenes`、`capabilities`、`installGate.reasons`、`ackRequired`、`yanked.reason`、
  `source.homepage`、`source.upstream`（恶意索引 4 条资产，payload 含 `<img onerror>`、
  `<script>`、`<svg/onload>`、`<iframe srcdoc>`、`javascript:` 链接、`{{…}}` 模板探针）。
- 浏览器实测（列表 + 详情）：`window.__dfXss` 始终 `undefined`；市场网格与详情容器内
  `script/iframe/object/embed/img` 与 `a[href^="javascript:"]` 计数全为 0；文本按字面渲染
  （如卡片名即 `<img src=x onerror="window.__dfXss=1">恶意卡片`）；无 console/page error。
- 「查看来源」恒为 `https://github.com/<repo>/tree/<ref>/<path>`：恶意 `homepage/upstream` 未被使用，
  `window.open` 捕获值仍是 github.com（`https://github.com/aud05/xss-probe/tree/main/probes/xss-probe-1`）。
- 代码面：市场 `features/market` 无 `dangerouslySetInnerHTML`/`innerHTML`；全仓唯一
  `dangerouslySetInnerHTML` 在 `apps/web/src/app/editor/layout.tsx`，内容为静态主题引导常量，与本域无关。
- **残余观察（C，不单列 finding）**：`buildSourceUrl` 对 `repo/ref/path` 直接插值（未编码）进固定
  github.com URL。当前不构成 XSS（host 固定），但可能生成形态异常的 GitHub 路径；建议后续编码。
- **证据**：`gate-evidence/aud-05/browser-malicious.json`；`xss-market-list.png`、`xss-market-detail.png`。

## 6. 装载 token 边界（D4 前端状态机，真实模块）

| 场景 | 结果 | 判定 |
|---|---|---|
| 可装载 → 提案 | `preview`，无 token | 通过 |
| 批准 | `approved`，token 120s（= `MCP_ACK_TTL_MS`） | 通过 |
| 重复批准 | `load_already_approved` | 通过 |
| 消费 | `consumed`，产出 `LoadRecord`，会话 token 置 null | 通过 |
| 重放消费 | `load_token_used` | 通过 |
| 超时消费（TTL 后 1ms） | `load_token_expired`，状态 `expired` | 通过 |
| 用户取消（preview） | `rejected`，不签发 token | 通过 |
| 不可装载资产强行开提案 | `load_not_loadable`（第二道闸） | 通过 |
| 无提案批准 | `load_not_approved` | 通过 |
| 跨标签页 | token 只在模块内存；另一标签页不可见/不可批准 | 符合「绑定本次操作」；记录册一致性见 F-05-06 |

- 观察：过期判定为 `nowMs > expiresAtMs`（恰在到期毫秒仍可消费 1ms 窗口）；影响可忽略。
- 一次性/超时/取消边界均可复核；**但 token 只守前端，真实写入尚不存在**（F-05-02）。

## 7. 域内能力表（C-01…C-16，基于审计 02 主表更新）

| ID | 能力 | 原判定 | 本轮 | 说明 |
|---|---|---|---|---|
| C-01 | 采集线六环 | working | working | 沿用 MK 线证据；本轮以其真实索引播种 |
| C-02 | D1 首页/卡片/增量分页 | working | working | 344 卡 6 页无重复、无截断；`已加载 N/344` 正确 |
| C-03 | D2 详情/三态 | working | working | 详情、not-found、装载三态真实浏览器通过 |
| C-04 | D3 BM25 检索 | working | working | `q=幻灯片` 78 命中（正常索引）；检索索引损坏时字面兜底 + warning |
| C-05 | D3 过滤全量语义 | partial | **partial（确认+加重）** | 首屏 0 命中时后续页不可达（F-05-01） |
| C-06 | 空态/错误/索引缺失/损坏/检索降级 | working | working | 缺失/损坏/检索损坏均按三态阻塞；部分损坏被静默（F-05-03 另列） |
| C-07 | D4 确认/能力清单/一次性 token | working | working | 边界全过（§6） |
| C-08 | 真实写入/卸载/更新 | missing | **missing（确认）** | 无写路由/无落盘/无审计（F-05-02） |
| C-09 | D5 面板/试跑/计数 | partial | partial | 沿用审计 02；本轮未改判 |
| C-10 | D6 数据看板 | partial | partial | `metrics.ts` 仍以「未上报」表达 ODS/DWD/DWS/runId/ODS 水位 |
| C-11 | 数据质量/digest | partial | partial | MK-05 真实批次 design-system 卡仍为 **0**；#39 仍 OPEN |
| C-12 | 壳静态安全/菜单/外链/静态服务 | working | working | guard exit 0 + desktop 122 例 |
| C-13 | 壳运行态装载/存活 | blocked | blocked | Electron 缺失（F-05-04） |
| C-14 | 壳内视觉对照 | blocked | blocked | Electron 缺失 + REF-01 |
| C-15 | MCP 确认桩 | working | working | 16/16 步 |
| C-16 | MCP 真网关/双端 | missing | missing | F-05-05 |

域内五态：**working 8 / partial 4 / missing 2 / blocked 2 / broken 0**（与审计 02 一致；
C-05 的严重度判断加重，见 F-05-01）。

## 8. 本票代码变更：MCP 契约快照接缝（唯一代码接缝）

- **实现**：`scripts/guard-mcp-contract.mjs` 不再是 `exit 2` 桩，改为 TypeScript AST 静态提取 +
  快照比对，三态退出码：
  - 0：源与快照一致；
  - 1：漂移（工具集 / caller / TTL / 审计决策词表 / 6 组 MCP 接口字段 / 33 条 `DAEMON_ROUTES` /
    5 组跨进程信封字段），逐项点名；
  - 2：快照缺失/损坏/schema 不匹配，或契约源无法静态判定（禁止假绿也禁止误报）。
- **快照提交物**：`scripts/snapshots/mcp-contract.v1.json`（schema `df.mcp-contract.snapshot/v1`）。
- **更新方式**：`node scripts/guard-mcp-contract.mjs --update`（有意变更时与快照 diff 同 PR 审阅）。
- **单测**：`scripts/tests/guard-mcp-contract.test.mjs` 7 例（真实契约正例含非空断言；工具/路由/信封
  三组漂移；快照缺失/损坏；正例不得把源判红）。夹具在 `scripts/tests/fixtures/mcp-contract/`。
- **CI**：`.github/workflows/ci.yml` 新增 `pnpm guard:mcp-contract` 必过步骤；
  `docs/agents/implementation-workflow.md` 守卫实况同步（仅 `guard:deps` / `guard:channel-pairing` 仍为桩）。
- **状态**：本票实现时源与快照一致（exit 0，0 violations / 0 undetermined）；`pnpm test:scripts` 63 例全过。
- **范围说明**：本快照固定的是**形状**（工具集/字段/路由/信封），不代表真实网关已实现（C-16 仍 missing）；
  P5 换实现不得改契约，否则该守卫会在 CI 红。

## 9. 回归候选（修复时落测试）

1. F-05-01：daemon 侧 `licenseGate`/`repo` 过滤 × offset 全量语义（page 1 与 page N 同源）；
   UI 断言「客户端过滤 0 命中且 loaded<total 时仍可加载更多」；「已装载空态」不再移除分页。
2. F-05-03：部分损坏索引 → warning `index-partial` + `counts` 对账；`verify-market` 断言
   `currentTotal == counts.total`（或显式 warning），坏条目不得静默。
3. F-05-02：真实写入路由的 dryRun→ack→单事务落盘→审计链路；未确认前不写必红测试（缺口票）。
4. F-05-06：多标签页并发 `writeLoadRecord` 的合并语义（storage 事件/重试）。
5. XSS：保留恶意索引夹具的浏览器断言（当前为审计脚本；可在 #54/#55 收口时并入浏览器门禁）。
6. MCP：契约有意变更必须 `--update` + 快照 diff；新增/删除工具或路由不得绕过。

## 10. Blocked 与后续

| 阻塞/缺口 | 原因 | 解除 |
|---|---|---|
| C-13/C-14 壳运行态/壳内对照 | Electron 二进制缺失；REF-01 未冻结 | `fetch-electron` + 冻结参照集后复跑 `verify:shell-parity` |
| C-16 真 MCP 网关 | P5 未实现；当前桩 `applied=false` | P5 网关接管，契约形状由本票快照固定 |
| C-08 真实写入 | 同上 | P5 + daemon 市场写路由 |
| C-10/C-11 看板/质量 | daemon 未上报 collector 字段；#39 OPEN | #39 裁决 + 看板数据面扩展 |

## 11. 证据索引（`~/df-evidence/audit-50/aud-05/`）

| 内容 | 路径 |
|---|---|
| 门禁日志 | `logs/`（`verify-market-*`、`verify-shell-parity.log`、`verify-mcp-stub.log`、`guard-*`、`desktop-test.log`、`build-*.log`、`verify.log`） |
| 退出码/耗时/数据根 | `results.tsv` |
| 市场真数据面探针 | `gate-evidence/aud-05/market-probe-good.json`、`market-probe-partial.json` |
| 浏览器审计 JSON/截图 | `gate-evidence/aud-05/browser-good.json`、`browser-malicious.json`、`c05-*.png`、`xss-*.png`、`load-flow-done.png` |
| verify-market 证据 | `gate-evidence/fe-11/`：`verify-market-2026-10-17T13-01-36.json`（播种通过）、`…13-01-39.json`（缺失）、`…13-01-40.json`（损坏）、`…13-01-41.json`（检索索引损坏）、`…13-09-58.json`（部分损坏仍通过） |
| 壳三段证据 | `gate-evidence/fe-12/shell-parity-2026-10-17T13-07-22Z/evidence.json` |
| MCP 桩证据 | `gate-evidence/fe-10/verify-mcp-stub.json` |
| 契约快照 JSON 报告 | `gate-evidence/aud-05/guard-mcp-contract.json` |
| 运行器/探针脚本 | `run-with-daemon.sh`、`run-browser-audit.sh`、`market-probe.mjs`、`browser-market-audit.mjs` |
| 数据根（可重放） | `data/seed-good|seed-missing|seed-corrupt-index|seed-corrupt-search|seed-partial|seed-malicious/` |

## 12. 边界声明

- 未改产品代码；唯一代码变更是 MCP 契约守卫/快照/单测/CI 接线（测试与 CI 工装，规格允许）。
- 未下载 Electron；壳运行态结论按 blocked 记账，未用静态结论冒充运行态。
- 未使用真实 MCP 客户端（ZCode/WorkBuddy）连接；契约快照针对 `@dforge/contracts` 源码形状，
  行为证据由 `verify:mcp-stub` 的真实 HTTP 链路提供。
- 视觉对照类结论仍归 REF-01，本票不拿自截图当验收判据；浏览器截图仅作 XSS/分页行为证据。

---

*审计 05 完 · 2026-10-17*
