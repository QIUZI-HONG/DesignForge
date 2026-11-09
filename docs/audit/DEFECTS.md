# 缺陷分级与根因（DEFECTS）— 阶段3 · 2026-11-06（quality-p1 批 2026-11-10 清账：D-18 全清、D-19 修四收窄、D-20 新登记）

依据：BASELINE（静态/依赖）· TEST_REPORT（覆盖率/安全专项）· E2E_REPORT（浏览器门禁/旅程）。**P0：无**。

## 0. 分级总览

| 级 | 数量 | 缺陷 |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | D-01 canvas 持久化往返断裂 · D-02 daemon 本地特权面 · D-03 /editor 导入未接线 |
| P2 | 9 | D-04~D-12 |
| P3 | 7 | D-13~D-19 |

## 1. P1 缺陷（含 5 Whys）

### D-01 canvas 页持久化往返断裂（产品缺陷 A+B 叠加）
- **影响面**：`/_canvas` 宿主页保存后刷新**内容丢失**（恢复到空页）；verify-canvas A6 恒红、e2e-smoke canvas 场景恒超时。/editor 主路径**不受影响**（editor/layers/导出链路全绿）。
- **复现**：`node scripts/verify-canvas.mjs`（自包含）→ A6 `afterReload:null`；或 e2e:smoke canvas 场景 45s 超时。磁盘铁证：夹具数据根 manifest 含两页 `[page-1, page_1]` 且两页体均为 `{}`。
- **5 Whys**：
  1. 为何恢复失败？重载后当前页=`pages[0]`=空占位页 page-1（session.ts:335 + page-set.ts:124-151 空体排前）→ n_1 不存在。
  2. 为何 manifest 两页？`/_canvas` 夹具硬编码页 id `'page_1'`（canvas-studio.tsx:124），daemon 建档占位页是 `page-1`（daemon store.ts:386）；`isPageFileId('page_1')` 为真 → 保存计划把它当**合法新页**新建（page-set.ts:266-272/341-342），page-1 沦为孤儿。
  3. 为何两页体都是 `{}`？`bridge.save()` 在 createDocument 后**立即**暴露 documentId（document-bridge.ts:215），内容 PUT 在其后（:219）——缺陷 B：保存身份先于内容落盘可见。
  4. 为何门禁没等到内容？门禁等 `documentId()` 可见即导航重载（verify-canvas.mjs:658-674、canvas.mjs:97-107）——等错信号，中止在途 PUT（脚本缺陷，放大器）。
  5. 根因：夹具页 id 硬编码旧引擎缺省，与 daemon 页集约定分叉（page-set.ts:4-7 明文记载该历史缺陷）＋保存身份暴露时序缺陷＋门禁等待信号错误。
- **证据**：`gate-browser/fe-06/verify-canvas-*.json` · `gate-browser/fe-02/e2e/*/scenarios/canvas/`（manifest+页体）· 根因全链 file:line 见根因报告（gate-browser/）。
- **建议**：①canvas-studio.tsx:124 改用引擎/contracts 缺省页 id；②documentId 投影/URL 同步延后至内容保存完成；③门禁改等 `[data-df-save-state="saved"]`（对齐 editor.mjs:218）；④verify-canvas.mjs:912 补空守卫（当前 `undefined.indexOf` 崩溃掩盖真因）。

### D-02 daemon 本地特权面（沙箱 iframe 全读 + 跨源写）
- **影响面**：本机浏览器内任意网页可借**沙箱 iframe（Origin 恒 null）完整读取本地设计文档**（CORS 全授予），并可触发跨源写（建/删/改，简单请求即达）；响应读取限于 CORS 放行面。
- **复现**：`bash ~/df-evidence/audit-2026-11/h1-probe.sh`（临时实例）→ P2：`Origin: null` 返回 `access-control-allow-origin: null` + 200 全量数据；P4：恶意 Origin POST 照常进业务处理。
- **5 Whys**：①为何可读？`Origin: null` 恒放行（cors.ts:64-67）；②为何放行？为打包壳 file:// 形态（注释自述）；③为何 shell 能被伪造？沙箱 iframe 天然发送 `Origin: null`，不可区分真壳与攻击页；④为何仍有写？非白名单 Origin「不加头但照常处理」（cors.ts:13-19 取舍：访问控制=回环+未来令牌）；⑤根因：**「Origin:null 恒放行」的不可区分性 + 无任何请求级鉴权**，威胁模型低估了沙箱 iframe 这条浏览器标准路径。
- **建议**（不擅改架构，进计划）：`null` 改为显式登记（壳启动时带一次性令牌或白名单真实来源）；写路径加本地令牌（daemon 首启生成、壳经启动参数注入）；至少对 DELETE/PUT 加 `Origin` 硬校验。风险与 ADR-0004 取舍相关，需用户确认方向。

### D-03 /editor 导入未接线（E2E J5 红）
- **影响面**：编辑器主页面导入功能不可用（导出→刷新→导入旅程断裂）；导出/持久化正常。
- **复现**：J5 旅程（journeys/J5/r1/steps.json）：`importIr` 恒回 `{"ok":false,"error":"未接入导入"}`。
- **根因**：导入仅在 `/_canvas` 接线（canvas-studio.tsx:391），/editor 走兜底（canvas-debug.ts:165）——功能接线只落在夹具页，主页面漏接。
- **建议**：/editor 复用同一 importIr 接线；E2E J5 红转绿作验收。

## 2. P2 缺陷

| ID | 缺陷 | 根因/证据 | 建议 |
|---|---|---|---|
| D-04 | 保存链路无超时：请求挂 30s 顶栏恒「保存中…」 | web fetch 无 AbortController（documents-client.ts:98、daemon-client.ts:108）；对比 daemon 探测有 3s 超时（daemon-endpoint.ts:200）；J9 三轮实证 | 复用 gateway-timeout 模式加 AbortSignal+用户可重试 |
| D-05 | 双页并发保存静默丢更新（last-write-wins） | J8：双页先后保存均 200、无 409，page1 位移被 page2 旧基线整页覆盖（final-daemon-nodes.json） | 引入版本号/If-Match 冲突检测（设计决策，需确认） |
| D-06 | ingest 损坏 JSON 列整批炸 | store.ts:74 裸 JSON.parse；红测实证（q8-q9-red.log） | 坏格降级 null+告警；红测转绿 |
| D-07 | ingest 坏 JSONL 行整批炸 | client.ts:530 裸 JSON.parse；红测实证 | 跳坏行+行号告警；红测转绿 |
| D-08 | daemon bodyLimit 1MB 拒大文档（perf @5k 实证 `Request body is too large`） | Fastify 缺省 bodyLimit 未调（app.ts） | 上调+可配置（如 32MB）+413 人话文案 |
| D-09 | 门禁脚本缺陷组：等错保存信号（verify-canvas.mjs:658、canvas.mjs:98）；runWiring 空守卫缺失（:912→`undefined.indexOf` 崩溃掩因）；verify-perf 用 puppeteer API `evaluateOnNewDocument`（Playwright 应为 addInitScript）；DF_WEB_URL 复用与 release() 回收语义冲突（layers 门禁误杀外部站点） | 根因报告 + E2E_REPORT §1/§4 | 逐项修正；回收逻辑仅作用于自起子进程 |
| D-10 | i18n 落差：保存失败文案双形态（502 技术直出 vs abort 人话）+ HomeView.tsx:179 等 8 处硬编码 | J7/J9 截图 + 质量审计 Q1-Q3 | 统一走 `editor.save.failed.network` 形态；补 i18n 条目 |
| D-11 | 覆盖率基建未常设化；分支覆盖差口（daemon 70.3%/cli 67.5%/web 77.5%，目标 90%） | 全仓无 coverage 配置；TEST_REPORT §2 | coverage 配置入仓+CI 报数；差口补测 |
| D-12 | 依赖：fast-uri 8 条 moderate/low（随 fastify）；electron dev 面 1 high（<44.9.1）；18 项过时 | pnpm audit/outdated | 补丁升级+overrides；不升大版本 |

## 3. P3 缺陷

| ID | 缺陷 | 证据 |
|---|---|---|
| D-13 | useDocumentSnapshot.ts 逐字节三份复制 | diff 实证（inspector/inspect-export/editor-components） |
| D-14 | 本机 .env.local 真实 VERCEL_OIDC_TOKEN 长驻（未入库） | apps/web/.env.local；建议轮换 |
| D-15 | `.scratch/` 未 gitignore（12 项草稿滞留） | git check-ignore exit 1 |
| D-16 | 半截 `'use client'` 修复未提交（use-draft-commit.ts，同目录 use-overlay.ts 未同步） | git diff |
| D-17 | 10 条 biome-ignore 例外待单人复核登记；用户 daemon 内 3 个 `ux-audit-*` 旧测试文档残留（2026-10-30，建议清理） | 质量审计 + contamination-4318.txt |

### D-18 市场线总案 v2 评审 Nit 汇总（低影响代码卫生 · 状态：**已清账（quality-p1 批 2026-11-10）**）

- **来源**：市场线总案 v2 集成分支评审轮（2026-11-09，`integration/market-program`）——两名独立
  verifier 确认的 7 项 Important（F1~F7）当批已修（见 `docs/audit/` 外的修复轮提交记录）；
  以下 Nit 类别评审已登记、当批**不修**，留待后续批次收口。
- **Nit 清单**（quality-p1 批逐条清账：#1/#3/#4/#5/#6/#7 修复，#2 文档化关闭）：

| # | Nit | 位置 | 处置 |
|---|---|---|---|
| 1 | raw 下载 URL 直接拼 Trees 清单 `fullPath`，未做 URL 编码（含空格/`#`/非 ASCII 的仓库路径会 404） | `apps/daemon/src/market/install.ts` fetchAssetFiles | **已修（quality-p1 · 票A · 66b12cc）**：段级 `encodeURIComponent`（保留 `/` 分隔符），含编码往返用例 |
| 2 | `UPDATABLE_SNAPSHOT_LIMIT=200` 单页快照：索引超 200 条时「可更新 N」少算（取舍已注释、未文档化） | `apps/web/src/features/market/use-market.ts` useUpdatableCount | **关闭（文档化取舍）**：代码注释（use-market.ts:352）+ 本条登记两处在位（quality-p1 · 票C 核实）；索引量级远超 200 时再立案 |
| 3 | 两把 switch 需人工同步漂移：`loadErrorCopyKey`（LoadConfirmDialog）与 `mapInstallErrorCode`（load-token）是双真源 | `apps/web/src/features/market/` | **已修（quality-p1 · 票C · 906cf87）**：合并 `LOAD_ERROR_TABLE` 单一映射表，copy key 零变化，词表契约用例钉住 |
| 4 | `telemetryCalls` 测试辅助多处复制 | `load-confirm.test.tsx` 等测试文件 | **已修（quality-p1 · 票C · 5f5d88b）**：提取 `__fixtures__/telemetry-calls.ts` 共享工具（marketTestUtils 命名空间），三处去重断言零变化 |
| 5 | 装载侧不校验 `source.ref` 40-hex 形态（ingest schema `COMMIT_RE` 有此口径），畸形 ref 直接进 Trees/raw URL | `apps/daemon/src/market/install.ts` | **已修（quality-p1 · 票A · f95fd77）**：装载前 40-hex 校验（与 ingest schema 同源字面量并注释出处），畸形 ref 零网络请求走既有错误族 |
| 6 | 装载文件名未显式拒绝控制字符（`resolveWithin` 拒 NUL/非 NFC，0x01–0x1F 其余控制字符不在段级词法内） | `apps/daemon/src/path-safety.ts` isSafeSegment | **已修（quality-p1 · 票A · 8d8d9b4）**：`hasControlChar`（0x00–0x1F+DEL）整体替换仅拒 NUL 的旧判据；documents 文档链路全量回归过 |
| 7 | 注释失实（如 LoadConfirmDialog「第二次打开不复用旧 token」与实现不符） | `apps/web/src/features/market/` | **已修**：F1 一处（当批）+ 票C 四处（8de31f2）+ 票D 最后一处 load-store.ts 头注释（0b65991） |

### D-19 arch-v1 集成分支评审 Nit 汇总（低影响代码卫生 · 状态：**quality-p1 批修四、余项收窄**）

- **来源**：架构深化批 v1 集成分支评审轮（2026-11-09，`integration/arch-v1`）——两名独立
  verifier 确认的 5 项 Important（F1~F5）当批已修（见集成分支修复轮提交记录）；以下 Nit
  类别评审已登记、当批**不修**，留待后续批次收口。
- **R2 修复轮（2026-11-09，评审 Round 2）**：新增 Important F6（`openStream` 非 2xx 错误
  正文无时限）当批已修（#1）；同根因 Nit R2-N2（一元 `text()` 回退分支无 race）与
  R2-N5（transport 注释「消费方创建时已解析一次」失实）同批已修。其余 Nit 保留开放。
- **quality-p1 批（2026-11-10）**：#2/#3/#5/#6 已修，#4 注释如实化（收窄为 Phase 2 收敛项），
  评审 F3（冷缓存并发探测 N×33）已修。
- **Nit 清单**：

| # | Nit | 位置 | 处置 |
|---|---|---|---|
| 1 | `openStream` 非 2xx 的失败信封正文读取**无时限**（`readJson` 直接读文本，正文滴流挂死会一直等下去） | `apps/web/src/lib/daemon-transport.ts` openStream / readJson | **已修（F6）**：非 2xx 错误正文读取并入同一总预算（`fetchWithinTotalDeadline` 句柄 + 自有 reader + `race(deadline.timeout)`），超时/调用方取消即 cancel 上游并按 `http_<status>` 失败；见 arch-v1 评审 R2 修复轮 |
| 2 | ADS 产物读入无 realpath 校验、无文件大小上限（`readFile` 按 `<dir>` 拼名整读） | `services/ingest/src/index/read.ts` readAdsArtifacts | **已修（quality-p1 · 票A · 70c8b23）**：`readArtifactWithin` 双侧 realpath 限定产物目录内（软链逃逸即拒、dir 本身位置不受限）+ 单文件 16MB 上限；检索索引「缺失=null、逃逸/超限/不可读=ok:false」收严 |
| 3 | tags 逗号 join/decode 可拆项：含逗号的单个 tag 在解码侧被拆成多个 | `packages/contracts/src/market/query.ts`（encode `tags.join(',')` / decode `split(',')`） | **已修（quality-p1 · 票A · 8535517）**：encode 逐项 `encodeURIComponent` 后 join（**签名不变、web 零改动**），decode 逐项解码、非法序列丢该项（对齐既有容忍哲学）；旧 wire 输入向后兼容有专测 |
| 4 | 注释过界：transport 头注释写「单一访问 module」，`read.ts` 写「读+校验+归一化收成一处」——实际 telemetry / inspect-export / daemon service / search-cmd 仍自建访问或读入路径 | `apps/web/src/lib/daemon-transport.ts` 模块头；`services/ingest/src/index/read.ts`、`index/index.ts`（#3 三读者收敛） | **注释已如实化（quality-p1 · 票B · 46c7557/dc48087）**：两处头注释改现状枚举；**实质收敛（三读者合一、transport 剩余自建点收编）留 Phase 2** |
| 5 | ai 2xx 无 body 的错误码/文案变化未入测试（旧客户端与传输层对 2xx 空 body 的失败形状不同） | `apps/web/src/features/ai/client.ts` + `daemon-transport.ts` openStream | **已修（quality-p1 · 票B · 4673585）**：三条 2xx 空 body 契约用例钉住现状传输层形状 |
| 6 | `TransportInit.validate` 签名是 `(value: unknown) => boolean`，与设计简报的 `v is T` 谓词签名不一致（调用方无法收窄，且市场层另在 `readEnvelope` 做形状校验） | `apps/web/src/lib/daemon-transport.ts` TransportInit.validate | **已修（quality-p1 · 票B · 46c7557）**：`TransportInit<T>` 泛型 + `validate?: (value: unknown) => value is T` 谓词，调用方守卫函数收窄 |
| F3 | `resolveBaseUrl` 冷缓存并发探测无 in-flight 合并：daemon 停机时市场页 N×33 `/health`，每波 ~2.4s（arch-v1 评审 R2 登记） | `apps/web/src/lib/daemon-transport.ts` | **已修（quality-p1 · 票B · 46c7557）**：`endpointProbesInFlight` 并发窗口共享同一探测 promise；落定即摘除、失败不缓存（失败语义不变）；契约用例钉「并发一波 + 失败重探测」 |

### D-20 quality-p1 批新发现（2026-11-10 · 状态：一项已修、两项立案）

- **来源**：quality-p1 批收尾全量门禁（verify:perf 正式判定连续红）与票 B 的 M3 剖析取证。
- **D-20 #1（已修）**：`scene-fonts` 字体取回 6 路并行化（票 B · B9「快修」）在本机**稳定吸引
  ~400ms 首帧停顿**——verify:perf @1k M1 830ms 超阈（阈值 691.5），且同树连续两轮 451↔832
  双峰翻转。定责链：main 对照同机同段 0/16 干净 → merge 点二分收敛到票 B → 提交内探针二分
  收敛到 B9 单因子（4/8 中招，transport-only 0/10）；相位探针（`~/df-evidence/p1-b-web/
  probe-boot-phases.mjs`）证明停顿落在 canvasKitReady→首帧之间（字体请求本身仅 5-14ms）。
  **修复 = 取回归还串行、保留 10s 超时加固**（73721e9；串行+超时探针 8/8 干净，全量
  verify:perf exit 0：@1k 397ms / @5k 361ms / @20k 463ms）。机制根因（Chromium/SwiftShader
  内部对 10MB ArrayBuffer 突发的响应）不在本批展开；**教训：多代理批的「性能快修」必须过
  verify:perf 正式判定才算数**——并行期禁跑全量门禁的纪律让该回归漏到了收尾期。
- **D-20 #2（立案，Phase 2）**：M3 选中→Inspector 反映 p95 结构性剖析（票 B · B6）——
  5k 图层树 5000 行全量渲染（无虚拟化、无行级 memo）+ 原生布局绘制 + 画布整帧重绘；
  根治（虚拟化）远超 100 行预算，本轮 p95=215ms vs 阈值 811.5ms（余量 4-7×）非违规。
  证据：`~/df-evidence/p1-b-web/m3-profile-report.json`（三轮 run + .cpuprofile）。
  cheap-fix 线索：i18n `t()` 每调用 `new IntlMessageFormat` 无缓存（~15 行，~3ms/提交级联）。
- **D-20 #3（登记）**：verify:perf 的 M1 为**单发测量**，对本机 ~400ms 级偶发停顿（M2 p99
  偶现 366-400ms，main 上亦存在）脆弱；基线标定注记已备证据层处置（时段标注/多轮取中位/
  暖机轮剥离）——后续若再遇「跳档超阈」按该注记处置，不得上调阈值系数。

## 4. 修复优先级矩阵（影响 × 紧迫）

| | 高紧迫 | 中紧迫 | 低紧迫 |
|---|---|---|---|
| **高影响** | D-01（主工作页数据丢失风险）· D-02（本地数据可被任意网页读取） | D-03（导入不可用）· D-05（并发丢更新） | D-08（大文档上限） |
| **中影响** | D-04（保存挂死观感） | D-06/D-07（数据面健壮）· D-09（门禁可信度）· D-10（文案一致性） | D-11（覆盖率）· D-12（依赖） |
| **低影响** | — | D-17（卫生） | D-13~D-16 · D-20 #2/#3（quality-p1 立案/登记）；~~D-18/D-19~~（已清账/收窄，2026-11-10） |

## 5. 阻塞与规避

- 无执行阻塞。D-02/D-05 的修复方向涉及既有架构取舍（ADR-0004）与设计决策 → 在 OPTIMIZATION_PLAN 中列为**需用户确认项**，其余按批推进。
