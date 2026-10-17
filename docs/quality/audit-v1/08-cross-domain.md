# 审计 08 · 跨域 e2e 与回归资产

- **状态**：已完成（证据根 `~/df-evidence/audit-50/aud-08/`；机器可读汇总 `fe-02/e2e/2026-10-17T13-37-56/e2e-smoke-2026-10-17T13-37-56.json` 与 `…/scenarios/editor/export-artifacts/export-verification.json`）
- **日期**：2026-10-17（UTC 13:31–13:42；本地 UTC+8）
- **代码基线**：`integration/audit-v1` @ `dd36aef`（已含审计 01–07）；**产品代码未改**
- **本票分支/工作树**：`audit/08-cross-domain` / `/home/QIU/df-wt/aud-08`
- **范围**：生产构建 + 真 Chromium + 同源网关的跨域关键路径；F-07-01 / F-05-01 的假绿复现与回归资产固化；桌面壳运行态（环境不足则 blocked）。

## 0. 结论摘要

1. **F-07-01 如实复现，旧 e2e 是假绿**：基线 `pnpm e2e:smoke --scenario editor` **exit 0（24/24 步）**，但真实编辑器文档导出的 PNG 1440×900 全白（矩形中心 `[255,255,255,255]`，0/17600 像素匹配 `#D9D9D9`）、SVG 仅 1 个背景 rect（262 B）、PDF 仅 `1 1 1 rg` 背景填充（459 B，`pdftoppm` 外部渲染全白）。旧断言只检查「已导出 …」文案与文件名。
2. **回归资产已固化**：扩展 `scripts/e2e/scenarios/editor.mjs`，捕获 UI 实际收到的 `POST /export` 响应并落盘产物，做 PNG 像素 / SVG 节点结构 / PDF 结构 + 外部渲染像素断言；新增 `scripts/lib/export-artifact.mjs` 判定纯函数与 `scripts/tests/export-artifact.test.mjs`（6 例，`pnpm test:scripts` 79/79 通过）。
3. **新增两条跨域场景**：`market-pagination.mjs` 复验 F-05-01（13 步，1 红）；`settings.mjs` 覆盖工作目录/哨兵 key/ComfyUI/诊断/`ai.baseUrl` 只读（21 步，全绿）。
4. **当前 e2e 总账（6 场景）**：**114 步 = 110 pass / 4 fail / 0 blocked，exit 1**。4 条红全部是本票要钉住的真实缺陷：3 条对应 F-07-01，1 条对应 F-05-01。没有放宽断言，也没有用完成文案/空产物换取通过。
5. **四类不变量成立**：新增/扩展场景全程请求只在同源网关（editor 204 次、market 43 次、settings 99 次），无 3000/4318 直连；无 pageerror；唯一 console 错误是已登记的「文档页 `page-{N}` 探测 404」（审计 04 观察），单独放行并计数；持久化往返（几何、工作目录、掩码凭据、ComfyUI 地址）逐字段一致。
6. **F-05-01 在跨域上下文复验通过（复现缺陷）**：首屏 60/130，来源仓库过滤 `later/repo` 首屏 0 命中；分页节点与「加载更多」均为 0，用户被告知「没有匹配的资源」。daemon `offset=60` 证明后续页确有 70 条匹配；未过滤时分页可到 130，全量后同一过滤命中 70——缺的是入口，不是数据或过滤条件。
7. **F-03-02（CORS `Origin: null`）在跨域上下文中仍是越权面**：e2e 页面流量全部同源，不经过 CORS；独立探针确认 `Origin: null` 可读列表、DELETE 文档（HTTP 200），与审计 03 结论一致。
8. **桌面壳 blocked**：`pnpm verify:shell-parity` 三段均 exit 2——Electron 二进制缺失（`apps/desktop/node_modules/electron/dist/electron`）+ REF-01 参照集未冻结；本机无 `xvfb-run`。记 blocked，不写通过。
9. **CI 影响**：`ci.yml` 当前不跑 e2e，主 CI 不受本票红影响；但本地/后续 e2e 门禁**必须按红处理**，修复 F-07-01 / F-05-01 前不得把 `e2e:smoke` 当绿，也不得在修复前把 e2e 直接接成必过 CI（否则长期红）。

## 1. 环境与门禁复跑（真实退出码）

| 门禁 | 命令 | 退出码 | 结果 | 证据（`~/df-evidence/audit-50/aud-08/`） |
|---|---|---:|---|---|
| 依赖安装 | `pnpm install --frozen-lockfile` | 0 | pnpm 10.33.2 / Node 24.9.0；新增根 devDependency `pngjs` 可用 | `install.log` |
| 基线 e2e（旧断言） | `pnpm e2e:smoke --scenario editor` | **0** | 24/24 步；导出产物全空白（假绿） | `logs/e2e-baseline.log`；`fe-02/e2e/2026-10-17T13-32-54/` |
| 加固后 e2e（6 场景） | `pnpm e2e:smoke` | **1** | **114 = 110 pass / 4 fail / 0 blocked** | `logs/e2e-all-content-red.log`；`fe-02/e2e/2026-10-17T13-37-56/` |
| scripts 测试 | `pnpm test:scripts` | 0 | 79/79（含本票新增 6 例） | `logs/test-scripts.log` |
| scripts lint | `pnpm lint:scripts` | 0 | 123 文件；仅 `nav.mjs` 1 条既有 warning | `logs/lint-scripts.log` |
| 桌面壳门禁 | `pnpm verify:shell-parity` | **2** | smoke/alive：Electron 缺失；parity：REF-01 未冻结 | `logs/verify-shell-parity.log`；`fe-12/shell-parity-2026-10-17T13-40-08Z/evidence.json` |
| CORS 探针 | `node ~/df-evidence/audit-50/aud-08/cors-probe.mjs` | 0（探针完成） | `Origin: null` 读/删除均放行（F-03-02 复现） | `cors-probe/cors-probe.result.json` |

环境：Linux（WSL2），Node 24.9.0，pnpm 10.33.2，Chromium 1243（playwright-core 1.63.0），`pdfinfo`/`pdftoppm`/`file` 可用。全部场景使用独立临时数据根、空闲端口与同源网关；**未触碰 3000/4318 与 `~/.dforge`**，未使用 `/tmp` 作工作树/缓存，未使用 `pkill -f`。

> **合并后复核**：收尾把 `integration/audit-v1`（仍为 `dd36aef`，已是最新，`Already up to date`）并入本分支后复跑 `pnpm verify` = **0**：9 包 / 292 文件 / 2765 例全绿；`test:scripts` = 79/79；`lint:scripts` = 0（123 文件，仅 `nav.mjs` 既有 warning）。日志 `logs/verify-postmerge.log`；带显式退出标记的复跑见 `logs/verify-postmerge-2.log`（尾部 `VERIFY_EXIT=0`）。合并未改产品代码，§3–§7 结论沿用。

## 2. 回归资产（本票核心）

| 资产 | 接缝 | 断言口径 | 当前 |
|---|---|---|---|
| `scripts/e2e/scenarios/editor.mjs`（扩展） | 生产构建 `/editor` 的导出页签 → UI 实际 `POST /export` 响应 | PNG：1440×900 + 页面底色 + 矩形中心/面积像素；SVG：尺寸 + 背景 rect + 节点矩形尺寸/填充；PDF：`%PDF`/单页/MediaBox + `pdfinfo` + `pdftoppm` 外部渲染像素 | 3 红（F-07-01） |
| `scripts/lib/export-artifact.mjs`（新增） | 纯函数判定层 | `decodeArtifactPayload`（base64/length/sha256 自洽）、`inspectPng`、`inspectSvg`、`inspectPdf`、`pdfHasFillColor`、`pdfInfo`、`renderPdfPage` | 被 e2e 与单测共同使用 |
| `scripts/tests/export-artifact.test.mjs`（新增） | 判定器自测 | 合成 PNG/SVG/PDF 的正反两面；空白产物必须 false；白底 vs `#F5F5F5` 必须判「背景未生效」 | 6/6 通过 |
| `scripts/e2e/scenarios/market-pagination.mjs`（新增） | 生产构建 `/market` 的过滤 × 分页 | 130 条夹具索引；首屏 60/130；首屏 0 命中时分页入口必须仍在；未过滤分页到 130；全量后过滤命中 70 | 13 步，1 红（F-05-01） |
| `scripts/e2e/scenarios/settings.mjs`（新增） | 生产构建 `/settings` + 诊断抽屉 | 工作目录切换/保存/刷新恢复；哨兵 key 掩码、响应/DOM/磁盘无明文；ComfyUI 本地 fixture 探测；诊断环境行与三项连通性；`ai.baseUrl` 前后不变、无 `/chat/completions` | 21 步全绿 |

运行方式（runner 自动发现场景）：

```bash
DF_EVIDENCE_DIR=~/df-evidence/audit-50/aud-08 pnpm e2e:smoke                    # 6 场景
DF_EVIDENCE_DIR=~/df-evidence/audit-50/aud-08 pnpm e2e:smoke --scenario editor  # 单场景
pnpm test:scripts                                                              # 判定器自测（79 例）
```

证据落盘约定：runner 写 `<DF_EVIDENCE_DIR>/fe-02/e2e/<时间戳>/e2e-smoke-<时间戳>.json`；editor 场景另写 `<场景数据根>/../export-artifacts/`（三格式产物 + `pdf-page-1.png` + `export-verification.json`）。

## 3. F-07-01 复现：真实文档导出空白与旧 e2e 假绿

### 3.1 基线（旧断言，exit 0）

夹具：首页 UI 新建「编辑器场景稿」→ `/editor` 拖画矩形（`x=240, y=320, 160×110`）→ 保存 → 重开。daemon 页面正文为真实信封：

```json
{ "$format": "dforge.canvas.page", "$version": 1,
  "page": { "backgroundColor": "#F5F5F5",
            "rootIds": ["n_…"],
            "nodes": { "n_…": { "type": "rect", "x": 240, "y": 320, "width": 160, "height": 110,
                                "fills": [{ "type": "solid", "color": "#D9D9D9", "opacity": 1 }] } } } }
```

| 格式 | 服务端 | 产物事实 | 旧 e2e |
|---|---|---|---|
| PNG | 200 | 1440×900 全白；角落与矩形中心 `[255,255,255,255]`；7164 B；sha `405d2cf6…` | 绿（只看「已导出 .png」） |
| SVG | 200 | 262 B；仅 `<rect width="1440" height="900" fill="#FFFFFF"/>`；可绘制元素 1 个 | 绿 |
| PDF | 200 | 459 B；`MediaBox [0 0 1440 900]`；内容流仅 `1 1 1 rg` + 背景 `re f`；`pdftoppm` 渲染全白 | 绿 |

基线证据：`~/df-evidence/audit-50/aud-08/baseline-fake-green/summary.json`（含页面信封、期望节点、PNG 采样、SVG 文本、PDF 填充色）与同目录三格式产物；原始运行 `fe-02/e2e/2026-10-17T13-32-54/`。

### 3.2 加固后（内容断言，如实红）

| 步骤 | 结果 | detail |
|---|---|---|
| 导出 PNG 完成态（UI 文案，非产物判定） | pass | 已导出 …（7164 字节） |
| 导出 PNG 尺寸正确（1440×900） | pass | 1440×900 |
| **导出 PNG 含设计内容（页面底色 + 矩形填充像素）** | **fail** | 背景 `[255,255,255,255]` ≠ `#F5F5F5`；矩形中心 `[255,255,255,255]`，0/17600 像素匹配 `#D9D9D9`；全图与背景同色 |
| 导出 SVG 尺寸正确（1440×900） | pass | 1440×900 |
| **导出 SVG 含设计节点（背景之外）** | **fail** | 背景 rect 填充 `#FFFFFF` ≠ `#F5F5F5`；无 160×110 / `#D9D9D9` 节点；可绘制元素仅 1 |
| 导出 PDF 结构/页尺寸正确（单页 1440×900） | pass | `pdfinfo` Pages=1，1440×900 |
| **导出 PDF 含设计内容（外部渲染像素或内容流填充色）** | **fail** | `pdftoppm` 渲染 1440×900 全白；矩形中心 `[255,255,255,255]`，0/17600 匹配 |

证据：`fe-02/e2e/2026-10-17T13-37-56/scenarios/editor/export-artifacts/export-verification.json`（期望值、base64 解码结果、sha256、各格式判定）与同目录产物。三格式 sha256：PNG `405d2cf620d64ed2514da4af56c1b79c169aceb7e8989983f4c6994aef116281`、SVG `df6dd03ce69bc1f4610ad2592f6bd8cb32181bb79b4b0b69b2bf8d923a93c69c`、PDF `68f44784328cf3c17352574bd0a6bdf764fa2d9e4d5de76cd1c7189560cbdc38`。

### 3.3 根因与修复建议（不改产品代码，仅建议）

- 根因与审计 07 一致：`apps/daemon/src/routes/export.ts:58` 把 `page.value.body` 原样交给 `extractScene`；`apps/daemon/src/export/scene.ts:161-191` 只认顶层 `children|nodes` 数组与 `background`，不展开 `dforge.canvas.page` 信封，也不识别 `ScenePage` 的扁平 `nodes` + `rootIds` 与 `backgroundColor`。
- 建议 1：在 daemon 增加 `ScenePage → RenderScene` 适配层（展开 `page`；按 `rootIds` 深度遍历 `nodes`；映射 `fills[0].color`、`cornerRadius`、`opacity`、`backgroundColor`、文本/位图；默认 1440×900）。修复后本票 3 条内容断言应转绿。
- 建议 2：**不要删除/放宽本票断言**。`导出 … 完成态（UI 文案，非产物判定）` 这一条保留，用于区分「UI 收到响应」与「产物有内容」。
- 建议 3：PDF 的文本/位图/圆角/透明度/多页保真仍属 F-07-02，本票只要求「设计节点进入产物」；修复 F-07-01 后不要顺带把这部分误判为已完成。

## 4. F-05-01 复验：过滤 × 分页边界

夹具（场景自播种，130 条，合法 `df.marketplace.index/v1`）：

- 前 60 条：`source.repo = first/batch`，`quality.score = 90`（首屏）；
- 后 70 条：`source.repo = later/repo`，`quality.score = 50`（第 2–3 页）。

| 步骤 | 结果 | detail |
|---|---|---|
| 夹具索引经 daemon 读链可见 | pass | total=130 / items=130 / later=70 |
| 首屏加载一页（60 张） | pass | cards=60 |
| 首屏分页显示「已加载 60 / 130」 | pass | `已加载 60 / 130` +「加载更多」 |
| 首屏过滤命中 0：显示「没有匹配的资源」 | pass | cards=0，`data-df-empty="no-result"` |
| **F-05-01：首屏 0 命中但已加载 < 总数时，「加载更多」不得消失** | **fail** | `paginationNodes=0`、`loadMoreButtons=0`、`emptyStateShown=true`（loaded 60 < total 130） |
| 后续页确实含 70 条匹配资产 | pass | `offset=60` 的 70 条均为 `later/repo` |
| 「加载更多」追加第二页（120 张） | pass | cards=120 |
| 增量分页到终点（130 张 + 已全部加载） | pass | cards=130，`已全部加载（130）` |
| 全量加载后过滤 `later/repo` 命中 70 | pass | cards=70 |

结论：缺陷是**过滤后 0 命中时 `renderPagination()` 直接返回 null**（`apps/web/src/app/market/page.tsx:176`），不是数据缺失或过滤条件失效。修复建议：客户端过滤命中 0 且 `allItems.length < response.total` 时保留「加载更多」，空态文案改为「已加载页无匹配，继续加载」；或把 `licenseGate`/`repo` 下沉 daemon 查询并进入分页 total。证据：`logs/e2e-all-content-red.log`；`fe-02/e2e/2026-10-17T13-37-56/`（`market-pagination` 场景）。

## 5. 跨域关键路径结果

| 路径 | 结果 | 证据 |
|---|---|---|
| 首页新建 → 编辑器 → 拖画 → 改属性 → 保存 → 重开逐字段恢复 | **通过**（几何往返、daemon 页面正文含节点、卡片页数/更新时间） | editor 场景 34 步中除 3 条导出内容外全绿 |
| 编辑器 → 导出 PNG/SVG/PDF（内容断言） | **失败**（F-07-01，3 条红） | 同上 |
| 市场列表 → 详情 → 返回（同源网关、端点参数不丢） | **通过**（nav 21/21） | `logs/e2e-all-content-red.log` |
| 市场过滤 × 分页边界 | **失败**（F-05-01，1 条红） | market-pagination 13 步 |
| 设置：工作目录读/切换/保存/刷新恢复 | **通过** | settings 21 步 |
| 设置：DeepSeek 哨兵 key（不触云） | **通过**：写入响应只回 `sk-…cdef`；DOM/`credentials.json` 无明文；从未发 AI 请求 | settings 步骤与 `cors-probe` 同根证据 |
| 设置：ComfyUI 连通性 | **通过**：保存 fixture 地址 + 重新探测；fixture 收到 `/system_stats`、`/object_info`；诊断 `comfyui=ok` | settings 步骤 |
| 诊断面板 | **通过**：环境行 data-root/workspace 与 daemon `/health` 一致；daemon/comfyui/ai 三项 `ok`；无错误横幅 | settings 步骤 |
| `ai.baseUrl` 外送面（只读核对） | **通过**：全程 `https://api.deepseek.com` 未变；fixture 未收到 `/chat/completions` | settings 步骤 |
| 桌面壳运行态 | **blocked**：Electron 二进制缺失 + REF-01 未冻结（exit 2） | `fe-12/shell-parity-2026-10-17T13-40-08Z/evidence.json` |

### 5.1 CORS `Origin: null`（F-03-02）交叉核对

e2e 页面流量全部走同源网关（`/df/*` → daemon），浏览器不触发跨源预检；因此 CORS 面**不能**由本票浏览器场景覆盖。独立探针（临时 daemon + 临时数据根）确认：

- `GET /documents` + `Origin: null` → 200，`access-control-allow-origin: null`，可读到文档；
- `OPTIONS /documents/:id` + `Origin: null` + `Access-Control-Request-Method: DELETE` → 204，允许 `GET,POST,PUT,PATCH,DELETE`；
- `DELETE /documents/:id` + `Origin: null` → 200，文档被删除。

与审计 03 F-03-02 一致，本票不改变结论。证据：`cors-probe/cors-probe.result.json`。

## 6. 四类不变量（本票新增/扩展场景）

| 不变量 | editor | market-pagination | settings |
|---|---|---|---|
| 无 pageerror | 0 | 0 | 0 |
| 无 console 错误 | 1 条，全部是已登记的文档页 `page-{N}` 探测 404（审计 04 观察），其余 0 | 0 | 0 |
| 请求只在同源网关 | 204 次全部 = 网关 origin；无 3000/4318 | 43 次全部 = 网关；无 3000/4318 | 99 次全部 = 网关；无 3000/4318 |
| 持久化往返一致 | 几何逐字段恢复；daemon 页面正文含节点 | 分页 60→120→130；过滤 70 | 工作目录 / 掩码 key / ComfyUI 地址刷新后逐字段恢复 |
| 通过不来自完成文案/空产物 | 导出内容断言独立；完成态文案明确标注「非产物判定」 | 过滤断言与 API 独立证据 | 响应/DOM/磁盘三处无明文；连通性由 fixture 请求证明 |

说明：editor 场景的 console 404 是既有的「读取页面前按 `page-{N}` 顺序探测」行为（F-04 观察），本票按 URL 精确放行并计 1 条，不把已知 404 当新缺陷，也不让它吞掉其他 console 错误。

## 7. 红/绿清单与 CI 影响

当前 `pnpm e2e:smoke`（6 场景）**exit 1**：

| # | 红步骤 | 缺陷 | 证据 |
|---:|---|---|---|
| 1 | 导出 PNG 含设计内容（页面底色 + 矩形填充像素） | F-07-01（A） | `export-verification.json` |
| 2 | 导出 SVG 含设计节点（背景之外） | F-07-01（A） | 同上 |
| 3 | 导出 PDF 含设计内容（外部渲染像素或内容流填充色） | F-07-01（A） | 同上 |
| 4 | F-05-01：首屏 0 命中但已加载 < 总数时，「加载更多」不得消失 | F-05-01（B） | `e2e-smoke-2026-10-17T13-37-56.json` |

- **CI 影响**：`.github/workflows/ci.yml` 不跑 e2e，主 CI（lint/typecheck/test/守卫/verify:engine）不受影响；但本地/后续 e2e 必须按红处理。
- **不要在修复前把 e2e 接成必过 CI**：F-07-01 / F-05-01 修复前它必然红；#59 接 CI 时应先修缺陷，或采用「已知红清单 + 修复后转绿」的显式机制，不得用重试/跳过掩盖。
- 旧文档里「63 步 e2e」是 5 场景时代的快照；本票后为 **6 场景 / 114 步**（每场景步数：canvas 10、editor 34、home 8、market-pagination 13、nav 21、settings 21）。#60 需同步该数字。

## 8. Blocked 清单

| 项 | 原因 | 解除方式 |
|---|---|---|
| 桌面壳运行态（smoke/alive/parity） | `apps/desktop/node_modules/electron/dist/electron` 缺失；`~/df-evidence/reference-v1` 未冻结；本机无 `xvfb-run` | `pnpm --filter @dforge/desktop fetch-electron`；冻结 REF-01；提供显示环境或 xvfb |
| 视觉像素对照 | REF-01（#28）未完成 | 冻结参照集后复跑 |
| Windows/macOS 跨平台 | 本票只跑 Linux（WSL2） | 后续矩阵 |

PDF 外部校验本机可用（`pdfinfo`/`pdftoppm`），本票未降级；若后续环境缺失，`scripts/lib/export-artifact.mjs` 会降级为内容流填充色断言并在 detail 注明 `mode=降级`。

## 9. 对 #59 / #60 的输入

### #59（flake / CI 硬化）

- e2e 场景数 6、总步数 114、单次运行约 110s（含 `next build`）；新增 `market-pagination` 与 `settings` 均自带夹具（市场索引、ComfyUI HTTP fixture、独立数据根/端口），无仓外依赖。
- 建议 e2e job 上传 `fe-02/e2e/<stamp>` 整目录（证据 JSON + 导出产物 + `pdf-page-1.png`）作为 artifact；按场景设置超时（editor 导出 30s、settings 探测 20s）。
- Flake 观察点：`waitForCardCount` 轮询（120ms）、ComfyUI 探测 1.5s 超时、`pdftoppm` 子进程；禁止盲目重试，失败保留步骤 detail。
- 已知 console 404（文档页探测）已在 editor 场景按 URL 精确放行；CI 日志统计时应单独计数，不能当成无 console 错误。

### #60（文档漂移）

- 能力表 D-01「PNG/SVG/PDF 导出」应改为 **broken**（真实文档空白，F-07-01），不是「简化渲染可用」。
- e2e 口径更新：6 场景 / 114 步；新增场景路径与证据目录见 §2；旧「63 步」「10 步」快照需更正。
- `docs/agents/implementation-workflow.md` 与 `AGENTS.md` 的门禁实况行应注明：`e2e:smoke` 已包含产物内容断言，**修复 F-07-01 / F-05-01 前按红处理**；`verify:shell-parity` 仍为 blocked（Electron/REF-01）。
- 测试策略文档可引用 `scripts/lib/export-artifact.mjs` 作为「导出产物内容判定」的唯一实现，避免各门禁再写一份像素/结构断言。

## 10. 证据索引（`~/df-evidence/audit-50/aud-08/`）

| 证据 | 路径 |
|---|---|
| 依赖安装 | `install.log` |
| 基线假绿（旧 e2e exit 0） | `logs/e2e-baseline.log`；`fe-02/e2e/2026-10-17T13-32-54/`；`baseline-fake-green/`（summary + 三格式产物 + `pdf-page-1.png` 外部渲染） |
| 加固后 e2e（exit 1） | `logs/e2e-all-content-red.log`；`fe-02/e2e/2026-10-17T13-37-56/` |
| 导出产物与判定 | `fe-02/e2e/2026-10-17T13-37-56/scenarios/editor/export-artifacts/`（`export-verification.json`、PNG/SVG/PDF、`pdf-page-1.png`） |
| 市场过滤×分页 | `fe-02/e2e/2026-10-17T13-37-56/scenarios/market-pagination/`；`e2e-smoke-2026-10-17T13-37-56.json` |
| 设置/诊断 | `fe-02/e2e/2026-10-17T13-37-56/scenarios/settings/`；同上证据 JSON |
| 桌面壳 blocked | `logs/verify-shell-parity.log`；`fe-12/shell-parity-2026-10-17T13-40-08Z/evidence.json` |
| CORS `Origin: null` | `cors-probe/cors-probe.result.json`；探针 `cors-probe.mjs` |
| scripts 测试 / lint | `logs/test-scripts.log`；`logs/lint-scripts.log` |

## 11. 局限

- 未跑 Windows/macOS；桌面壳运行态 blocked（见 §8）。
- PDF 保真只断言「节点进入产物」；文本/位图/圆角/透明度/多页仍属 F-07-02，不在本票通过口径内。
- CORS `Origin: null` 用独立探针（Node）复核，不经浏览器；浏览器侧同源网关不触发 CORS。
- 审计阶段未改产品代码；红色断言是修复后的验收目标，不是本轮要修的内容。
