# 缺陷分级与根因（DEFECTS）— 阶段3 · 2026-11-06

依据：BASELINE（静态/依赖）· TEST_REPORT（覆盖率/安全专项）· E2E_REPORT（浏览器门禁/旅程）。**P0：无**。

## 0. 分级总览

| 级 | 数量 | 缺陷 |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | D-01 canvas 持久化往返断裂 · D-02 daemon 本地特权面 · D-03 /editor 导入未接线 |
| P2 | 9 | D-04~D-12 |
| P3 | 5 | D-13~D-17 |

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

## 4. 修复优先级矩阵（影响 × 紧迫）

| | 高紧迫 | 中紧迫 | 低紧迫 |
|---|---|---|---|
| **高影响** | D-01（主工作页数据丢失风险）· D-02（本地数据可被任意网页读取） | D-03（导入不可用）· D-05（并发丢更新） | D-08（大文档上限） |
| **中影响** | D-04（保存挂死观感） | D-06/D-07（数据面健壮）· D-09（门禁可信度）· D-10（文案一致性） | D-11（覆盖率）· D-12（依赖） |
| **低影响** | — | D-17（卫生） | D-13~D-16 |

## 5. 阻塞与规避

- 无执行阻塞。D-02/D-05 的修复方向涉及既有架构取舍（ADR-0004）与设计决策 → 在 OPTIMIZATION_PLAN 中列为**需用户确认项**，其余按批推进。
