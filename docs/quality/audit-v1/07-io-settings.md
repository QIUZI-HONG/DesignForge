# 审计 07 · 导入导出、设置与诊断深挖

- **状态**：已完成（证据根 `~/df-evidence/audit-50/aud-07/`；机器可读汇总 `io-settings-audit.evidence.json`）
- **日期**：2026-10-17（UTC 13:18–13:25；本地 UTC+8）
- **代码基线**：`integration/audit-v1` @ `8c21da6`（已并入 `9079f02` 之后的审计 01–04；产品代码未改）
- **本票分支/工作树**：`audit/07-io-settings` / `/home/QIU/df-wt/aud-07`
- **范围**：PNG/SVG/PDF 导出保真与边界、`.dfg` 导入导出与跨版本兼容、设置（工作目录/DeepSeek/ComfyUI/埋点）、诊断连通性、凭据复位、遥测开关/脱敏/删除。
- **一次性审计脚本**：`scripts/audit/io-settings-audit.mjs`（不是门禁；148 条断言/观察，见 §2）。
- **结论口径**：三态退出码 `0 通过 / 1 真违规 / 2 阻塞`；脚本内 `pass` 表示「断言成立」——对缺陷型断言（如尺寸上限缺失）`pass` 意味着**缺陷已复现**，以 detail 文字为准。

## 0. 结论摘要

1. **真实编辑器文档导出是空白产物（A 级，broken）**：web 保存的页正文是 `{ $format: 'dforge.canvas.page', $version, page, tokens }`（`apps/web/src/features/canvas/persistence/documents-client.ts:190`），而 daemon 导出只读**顶层** `width/height/background/children|nodes`（`apps/daemon/src/export/scene.ts:161`）。实测真实信封导出：PNG 1440×900 全白（矩形中心 `[255,255,255,255]`）、SVG 仅 1 个背景 rect（265 字节）、PDF 仅背景填充（459 字节）；页面 `backgroundColor: '#112233'` 也未生效。`e2e` 只断言「导出完成」文案（`scripts/e2e/scenarios/editor.mjs:315-331`），因此绿并不代表产物有内容。
2. **简化渲染器只在「非编辑器真实格式」的树状载荷上工作**：矩形/椭圆/圆角/透明度/透明背景/缩放夹取/三格式外部可打开均通过（`file`/`pdfinfo`/`pdftoppm`/XML 解析）；但 PNG/PDF 跳过文本与位图、PDF 不表达圆角与透明度、SVG 图片是占位框、无多页导出。这部分是 D-01 的既有 partial，被 F-07-01 的「整页空白」掩盖。
3. **`.dfg` 外部导入/打包导出仍是 missing**：无导入路由（`POST /import`、`POST /documents/import` 均 404）、无 `<input type=file>`/FileReader/文件选择器、无 zip/tar 依赖；唯一「导入」入口是 `/_canvas` 取样页从剪贴板读 IR（`canvas-studio.tsx:469`），且调试句柄 `importIr` 缺省返回「未接入导入」（`canvas-debug.ts:144`）。
4. **跨版本策略只对 manifest 严格**：未来 `$format` 被拒；未来 manifest `schema` → 422 + 列表告警（符合纪律）。但引擎 `parseDocument` 接受 `$version = 2/99/0/-1/1.5/1e9`（非数字静默折回 1）；页信封 `$version: 99` 被 daemon 原样存取、web `decodePageBody` 不拒绝——未来页格式没有拒绝/迁移闸门（D-04 partial）。
5. **设置/诊断/凭据主路径可用**：工作目录切换（合法/非法/不可写/被占用/软链）、保存回滚、DeepSeek 哨兵 key（响应/磁盘/日志/遥测无明文，0600）、ComfyUI 地址 scheme 校验、连通性三项（不触达云端）、遥测开关/查看/删除均按设计工作。剩余问题：损坏主密钥无复位入口（F-03-11 复现）、遥测自由文本 key 原样落盘（F-03-09）、脱敏把合法指标 `totalTokens` 误杀、路径/URL 不做 trim、URL 字符串拼接破坏带路径/查询的地址、`ai.baseUrl` 可指向任意 http(s) 并把 Bearer key 发过去（与 F-03-02 组合有越权面）。
6. **导入边界与导出尺寸**：20k 层嵌套页（外部放入）读取仍 500（F-03-05 复现）；30k×30k PNG 在 10GiB 地址空间限制下 17ms 返回 500 `export_render_failed`（`RangeError: Array buffer allocation failed`），进程存活——F-03-13 从「blocked/静态」升级为**安全复现**，仍属 C 级可用性风险（无尺寸预检 4xx）。

## 1. 范围与方法

- **门禁基线**：复跑 `pnpm verify`、`pnpm test:scripts`、`pnpm verify:engine`、`pnpm verify:daemon`，另跑 settings/diagnostics/ExportPanel 定向 web 测试。
- **一次性审计脚本**：`scripts/audit/io-settings-audit.mjs`（新增；`node scripts/audit/io-settings-audit.mjs`）：
  - 自起临时 daemon（临时数据根 + 空闲端口 + 证据目录为 cwd），另起 4 个隔离 daemon：损坏主密钥、损坏 `credentials.json`、env key、10GiB `ulimit -v` 子进程；
  - 自起本地 fixture HTTP 服务（记录 `/system_stats`、`/object_info`、`/chat/completions` 的请求与 `Authorization` 头）；
  - 产物落 `artifacts/`，daemon 侧产物落 `runtime/<runId>/data/exports/`；
  - **未触碰 3000/4318 与 `~/.dforge`**；临时目录/`TMPDIR` 全在证据根，未用 `/tmp`；未使用 `pkill -f`（只按子进程句柄/精确 PID 回收）。
- **真实产物外部校验**：`file`（魔数/尺寸）、`pdfinfo`（页数/MediaBox）、`pdftoppm`（PDF 外部渲染后取像素）、Python `xml.etree`（SVG 良构与文本）。本机无 `rsvg-convert`/ImageMagick，SVG 像素级外部渲染未跑。
- **真实凭证/服务**：只用哨兵 key（运行时拼接）与本地 fixture；未使用真实 DeepSeek/ComfyUI，符合审计规格。

## 2. 门禁与测试复跑（真实退出码）

| 门禁 | 命令 | 退出码 | 结果 | 证据（`~/df-evidence/audit-50/aud-07/`） |
|---|---|---:|---|---|
| 全量 verify | `pnpm verify` | 0 | 9 包、292 文件、2765 例全绿（web 1343 / ingest 579 / engine 312 / ui 165 / desktop 122 / daemon 118 / contracts 80 / cli 45 / comfy 1） | `logs/verify.log` |
| scripts 测试 | `pnpm test:scripts` | 0 | 66 例全过 | `logs/test-scripts.log` |
| 引擎门禁 | `pnpm verify:engine` | 0 | 23 文件 / 312 例；快照哈希一致 | `logs/verify-engine.log` |
| daemon 冒烟 | `pnpm verify:daemon` | 0 | 37 步 0 失败；日志无 key 明文 | `logs/verify-daemon.log` |
| 定向 web 测试 | `vitest run src/features/settings src/features/diagnostics src/features/inspect-export/components/ExportPanel.test.tsx` | 0 | 13 文件 / 109 例（保存态、设置页/引导、凭据纪律、诊断面板、导出失败态） | `logs/web-settings-targeted.log` |
| **一次性审计** | `node scripts/audit/io-settings-audit.mjs` | 0 | **148 = 122 pass / 6 fail / 19 observe / 1 blocked**；6 个 fail 全部对应 §6 的缺陷（导出空白 ×4 断言、深嵌套 500、遥测自由文本） | `io-settings-audit.evidence.json`；`logs/audit-final.log` |

> 脚本退出码 0 表示「审计完成」，不表示产品全绿；1 blocked 是 WSL2 `/proc` 环境限制（§9），不计为产品结论。
>
> **合并后复核**：并入 `integration/audit-v1` @ `7c0dec0`（审计 05/06）后复跑：`pnpm verify` = 0、`pnpm test:scripts` = **73/73**（审计 05 新增 MCP 契约自测）、`verify:engine` = 0、`verify:daemon` = 37/37、审计脚本计数不变（148 = 122/6/19/1）。日志：`logs/verify-postmerge.log`、`logs/test-scripts-postmerge.log`、`logs/verify-engine-postmerge.log`、`logs/verify-daemon-postmerge.log`、`logs/audit-postmerge.log`。合并只改了设置页一条测试等待，未改产品代码。

## 3. 导出：产物、保真与外部可用性

### 3.1 真实编辑器文档（P0 缺陷）

夹具：`audit-engine` 文档的 `page-1` 保存与 web 完全相同的页信封（`dforge.canvas.page` + `ScenePage`：`nodes` 扁平表、`rootIds`、`backgroundColor: '#112233'`、一个 120×80 红色矩形）。

| 格式 | 服务端结果 | 产物事实 | 判定 |
|---|---|---|---|
| PNG | 200 | 1440×900 全白；矩形中心 (100,80)=`[255,255,255,255]`；`skippedNodes=0`；sha `405d2cf6…`，7164 B | **fail（F-07-01）** |
| SVG | 200 | 仅 `<rect width="1440" height="900" fill="#FFFFFF">`；无节点、无 `#FF0000`；265 B | **fail** |
| PDF | 200 | `MediaBox [0 0 1440 900]`，只有背景 `1 1 1 rg`；无红色；459 B | **fail** |

根因链：`apps/daemon/src/routes/export.ts:58` 把 `page.value.body` 原样交给 `extractScene`；`scene.ts:161-191` 只认顶层 `children`/`nodes` 数组与 `background`，**不展开 `page` 信封**；即便展开，`ScenePage.nodes` 是 `Record<id, node>` + `rootIds` 的扁平表，`backgroundColor` 也不是 `background`——渲染器与真实格式之间没有适配层。`scene.ts` 模块头声明的「引擎序列化接入后替换」尚未发生。

**影响**：用户从编辑器导出得到的三个文件都能打开、都「成功」，但**没有任何设计内容**；这比报错更危险（静默错误产物）。e2e 的「导出成功」只检查完成文案与文件名，无法发现。

### 3.2 简化渲染器自身能力（树状载荷）

夹具：`audit-legacy`（200×120；圆角红矩形、50% 蓝椭圆、中文文本 `<07> & "文本"`、图片节点、未知节点、负坐标矩形）。

| 检查 | 结果 | 证据 |
|---|---|---|
| PNG 尺寸/背景/矩形像素 | 200×120；角落白；矩形中心 `[255,0,0,255]` | `legacy.png.*` |
| PNG 圆角 | 圆角外 `(11,11)` 仍为背景 | `legacy.png.rounded-corner` |
| PNG 椭圆透明度 | `[128,128,255,255]`（50% 混合） | `legacy.png.ellipse-opacity` |
| PNG 文本 | 文本位置为空白（**跳过文本**） | `legacy.png.text-skipped` |
| PNG 透明背景/半透明 | 背景 alpha=0；矩形 alpha=128 | `transparent.*` |
| PNG scale | 2→400×240；5/1e9 夹到 4（800×480）；0/-1/"2"/null → 400 | `png.scale*` |
| PNG 空文档 | 1440×900 白底 | `empty.png` |
| PNG 负值/零值 | 200×120 夹具外的 `-10×0` → 1×1 | `negative.dims` |
| SVG 结构 | 尺寸/椭圆/`rx=8`/`opacity=0.5`/图片占位框 `stroke="#B3B3B3"` | `legacy.svg.*` |
| SVG 文本/转义 | `<text>` 存在，`审计&lt;07&gt; &amp; &quot;文本&quot;`；XML 良构 | `legacy.svg.text`、`svg.xml` |
| PDF 结构 | `%PDF-1.4`、`/Count 1`、`MediaBox [0 0 200 120]`、startxref 指向 `xref` | `legacy.pdf.*` |
| PDF 外部查看器 | `file` 识别 PDF 1.4 1 页；`pdfinfo` Pages=1、200×120 | `external-pdfinfo` |
| PDF 外部渲染像素 | `pdftoppm` → 200×120；红矩形 `[255,0,0]`、蓝椭圆 `[0,0,255]`（**PDF 未表达 50% 透明度**） | `external-render` |
| PDF 文本 | 无文本（跳过） | `legacy.pdf.no-text` |
| 产物落盘 | 数据根 `exports/` 内，文件名 `<docId>-<pageId>.<fmt>`；sha/length 与 base64 自洽 | `artifact.*` |

结论：渲染器对自己支持的子集是正确且可被外部程序打开的；缺口是**格式保真**（文本/位图/圆角/透明度/多页）与**真实页面结构适配**（F-07-01）。

### 3.3 失败态与边界

| 场景 | 结果 |
|---|---|
| `format=jpg` | 400 `export_unsupported_format` |
| 文档不存在 / 页不存在 | 404 `doc_not_found` / `export_page_not_found` |
| `documentId=../evil` / `pageId=../page-1` / 300 字符 pageId | 400 `doc_invalid_id`（无越界落盘） |
| `width/height = 1e308` | 500 `export_render_failed`（`RangeError`），daemon 存活 |
| `100000×100000` | 500 `export_render_failed`（超过 TypedArray 上限） |
| `30000×30000`（10GiB `ulimit -v` 子进程） | **17ms 返回 500**（`RangeError: Array buffer allocation failed`），RSS 116MB→104MB，进程存活；**无尺寸预检**（F-07-06） |
| 错误消息 | `message` 含原始异常类型（`渲染失败：RangeError: …`），与 F-03-06 同类（C 观察） |

`extractScene` 只保证 `width/height ≥ 1`；`rasterizeScene` 直接 `new Uint8Array(width * height * 4)`（`apps/daemon/src/export/png.ts:128`）。本次**没有**在无限制进程上触发 GB 级分配；限制法复现足以证明「先分配、后失败」，而不是 4xx 拒绝。

## 4. 导入、往返与跨版本兼容

| 项 | 结果 | 判定 |
|---|---|---|
| `.dfg` 外部导入路由 | `POST /import`、`POST /documents/import` → 404 | **missing（F-07-03）** |
| 导入 UI | web/desktop 无 `<input type=file>`/FileReader/文件选择器（0 处）；desktop 无 `dialog.showOpenDialog` | missing |
| 打包导出 | 无 zip/tar/archiver 依赖与路由 | missing |
| 剪贴板 IR 导入 | `/_canvas` 取样页有按钮，从 `navigator.clipboard.readText()` 读 IR；调试句柄缺省 `importIr` 返回「未接入导入」 | observe（非文件/非 `.dfg`） |
| 真实页信封往返 | 未知字段 + `$version: 99` PUT→GET **逐字节一致**（daemon 只做 opaque JSON） | 通过（但见版本门） |
| 引擎 `$version` | `1/2/99/0/-1/1.5/1e9` 全部接受并原样返回；`"1"`/`null`/缺省静默折回 1；未知 `$format` 拒绝 | **partial（F-07-04）** |
| manifest 未来 schema | `df.dfg.manifest/v2` → 422 `doc_invalid_manifest`；列表告警 `manifest_invalid` | 通过（严格版本门） |
| manifest 修订号 | `version: 999` 接受（修订号，非格式版本）；`1.5` → 422 | 通过 |
| manifest id 与目录名不一致 | 被接受（`manifest.id` 未与请求路径交叉校验；摘要用请求 id） | observe |
| 损坏页 JSON | GET → 400 `doc_invalid_body` | 通过 |
| 20k 层嵌套页（外部放入） | GET → **500 `internal`**，`Maximum call stack size exceeded`（写入侧有 1024 层上限，读取侧没有） | **broken（F-07-05，复现 F-03-05）** |
| 深嵌套页导出 | 200（不遍历深层；2000 节点预算） | 通过 |
| 正文 >1.2MiB | 400 `bad_request`（Fastify body limit） | 通过 |
| 正文 2000 层保存 | 400 `doc_invalid_body` | 通过 |
| `body: null` | 400 `doc_invalid_body` | 通过 |
| 未知字段保存 | 200，读取原样保留 | 通过 |
| 缺 manifest 的 `.dfg` | 列表告警 `manifest_unreadable`；DELETE → 404 `doc_not_found`（F-03-07 交叉引用） | observe（既有 C） |

## 5. 设置、诊断与遥测

### 5.1 工作目录

| 场景 | 结果 |
|---|---|
| 切到第二工作目录 | 200；列表只显示新目录文档；`/health.workspaceDir` 跟随；旧目录文件未动（只改指针，无迁移/复制） |
| 切回 | 200；旧文档重新可见 |
| 空 / 纯空白 / 路径落在文件下 / 路径本身是文件 / NUL / 5000 字符 / `/dev/null/sub` / 只读目录（0500） | 全部 400 `config_invalid`；配置保持原值 |
| 软链目录 | 200 接受，列表经 realpath 工作 |
| 首尾空白路径 `"padded-ws "` | 200，按**相对 daemon cwd** 创建带尾随空格的目录（API 不 trim；web 表单会 trim） |
| `/proc/1/*` | 本环境阻塞：WSL2 下 Node recursive mkdir 无限挂起（纯 shell `mkdir` 立即 ENOENT）；请求无响应、无超时，按环境不可判定记录（§9） |

### 5.2 DeepSeek 凭据（哨兵）

- 写入：200，响应只回 `maskedKey: sk-…cdef`；`credentials.json` 为 AES-256-GCM 密文、`credentials.json`/`credentials.key` 均 0600；GET /config、遥测、daemon 日志均无明文/显著片段。
- 形态拒绝：无 `sk-` 前缀、过短、尾随换行、尾随空格、非 ASCII → 400 `credential_invalid`。
- 清除：200，`hasKey=false`，`credentials.json` 删除。
- env key：`source=env`、只回掩码；写入本地 key 后摘要仍 `env`（env 优先）；DELETE 后 env key 仍在；日志无明文。
- **损坏主密钥**：PUT → 400「本地加密主密钥不可用」；DELETE → 200 但 `credentials.key` 不删/不重建；再次 PUT 仍 400；路由表无复位路由（**F-07-09，F-03-11 复现**）。
- 损坏 `credentials.json`：视为空库，重设 key 200（可恢复）。

### 5.3 ComfyUI 与连通性

| 场景 | 结果 |
|---|---|
| `ftp://` / `javascript:` / `http://`（无 host）/ 非 URL | 400 `config_invalid` |
| 首尾空格 URL | 200 原样保存（未 trim） |
| 带路径/查询 `http://host/prefix?token=1` | 接受；探测请求为 `/prefix?token=1/system_stats`（字符串拼接，路径/查询位置错误）→ `unavailable` |
| 本地 fixture 正常 | `comfy=ok`，请求 `/system_stats` + `/object_info`；device/checkpoint 解析成功 |
| 未启动端口 | 200 响应内 `comfyui.status=unavailable`、`code=comfy_unreachable`、actions `retry-probe/set-base-url`；`installPath` 非空时追加 `launch` |
| 不可路由地址 | 1.5s 超时后 `unavailable`（探测超时符合设计） |
| AI 项 | 无 key → `not-configured`；有 key → `ok`（只显示掩码）；**连通性对配置的 `ai.baseUrl` 零上游请求**（fixture 未收到 `/chat/completions`） |
| **`ai.baseUrl` 任意 http(s)** | 200 接受；随后 `POST /ai/chat` 把 `Authorization: Bearer <哨兵>` 发往该地址（fixture 实测 1 次）。自定义端点属设计能力，但与 F-03-02（`Origin: null` 可写配置）组合存在 key 外送面；归 #56/安全票处理 |

### 5.4 诊断与遥测

- `/health`：name/version/uptimeMs/dataRoot/workspaceDir 齐全；诊断面板数据源（health + connectivity + telemetry tail）可用；`settings` 13 文件/109 例定向测试全绿。
- 连通性报告：三项（daemon/comfyui/ai）+ `checkedAt`；响应不含 key。
- 遥测：写入落 `<dataRoot>/telemetry/events.jsonl`（0600）；开关关闭时 `stored=false, reason=disabled` 且 total 不变；`limit` 下界 1、上界 1000；未知事件名 400；DELETE 清空；导出成功追加 `export.completed`（只含 doc/page/format/length，无 base64）。
- 脱敏：`apiKey`/`authorization`/`token`/`password` 嵌套键均替换为 `[redacted]`；**自由文本 `prompt` 中的哨兵 key 原样落盘**（F-07-07，F-03-09 复现）；**`totalTokens` 因键名含 `token` 被误脱敏**（F-07-08，实测 `ai.run` 事件 payload 中 `"totalTokens":"[redacted]"`）。

## 6. Findings

> 分级：A = 阻断（主路径不可用/安全/数据丢失）；B = 严重（功能不可达或规格未达）；C = 一般/观察。
> 五态：working / partial / missing / broken / blocked。

| ID | 级别 | 五态 | 结论 | 证据（`$EV = ~/df-evidence/audit-50/aud-07`） |
|---|---|---|---|---|
| F-07-01 | **A** | **broken** | 真实编辑器文档导出为空白（PNG/SVG/PDF 全部无节点、背景色不生效） | `$EV/io-settings-audit.evidence.json`（`export.engine.*`）；`$EV/artifacts/审计07-真实信封-page-1-*`；`apps/daemon/src/export/scene.ts:161`、`apps/web/src/features/canvas/persistence/documents-client.ts:190` |
| F-07-02 | B | partial | 简化渲染器保真不足：PNG/PDF 跳文本与位图、PDF 无圆角/透明度、SVG 图片占位、无多页 | `$EV/io-settings-audit.evidence.json`（`export.legacy.*`）；`$EV/artifacts/`；`apps/daemon/src/export/{png,pdf,svg}.ts` |
| F-07-03 | B | missing | `.dfg` 外部导入/打包导出缺失（无路由/UI/zip；仅剪贴板 IR） | `$EV/io-settings-audit.evidence.json`（`importCompat.import.*`）；`packages/contracts/src/ipc/routes.ts`；`apps/web/src/features/canvas/debug/canvas-debug.ts:144` |
| F-07-04 | B | partial | 未来/非法 `$version` 静默接受（引擎 + 页信封）；manifest 是唯一严格版本门 | `$EV/probes/engine-version-probe.json`；`$EV/io-settings-audit.evidence.json`（`engine.*`、`page-envelope.future-version`）；`packages/engine/src/serialize/serialize.ts:136` |
| F-07-05 | B | broken | 20k 层嵌套页（导入件）读取 500，错误泄漏内部异常 | `$EV/io-settings-audit.evidence.json`（`deep.page-read-4xx`）；`apps/daemon/src/documents/store.ts:473`（仅写侧限深） |
| F-07-06 | C | broken | 导出尺寸无上限/无预检；3.6GB 分配直接尝试，失败为 500 | `$EV/io-settings-audit.evidence.json`（`size-limit.*`）；`apps/daemon/src/export/png.ts:128` |
| F-07-07 | C | partial | 遥测自由文本中的 key 原样落盘（F-03-09） | `$EV/probes/telemetry-events-before-clear.jsonl:43`；`evidence.json`（`telemetry.free-text-secret`） |
| F-07-08 | C | partial | 遥测脱敏按子串匹配，合法指标 `totalTokens` 被误杀 | `$EV/probes/telemetry-events-before-clear.jsonl:41`；`packages/contracts/src/telemetry/index.ts:76` |
| F-07-09 | C | broken | 损坏主密钥无复位入口（F-03-11） | `$EV/io-settings-audit.evidence.json`（`credentials.corrupt-key-*`）；`apps/daemon/src/credentials/store.ts:109` |
| F-07-10 | C | partial | 路径/URL 不 trim；ComfyUI URL 字符串拼接破坏带路径/查询地址 | `$EV/io-settings-audit.evidence.json`（`workspace.whitespace-not-trimmed`、`comfy.url-not-trimmed`、`comfy.url-path-query`）；`apps/daemon/src/config/store.ts:126,193`；`apps/daemon/src/image/client.ts:150` |

### A 级详情：F-07-01 · 真实文档导出空白

- **复现**：创建文档 → `PUT /documents/<id>/pages/page-1` 写入 web 同款页信封（含红色矩形与 `backgroundColor:#112233`）→ `POST /export {format: png|svg|pdf}`。三格式均 200；PNG 1440×900 全白、SVG 只有背景 `<rect>`、PDF 只有背景填充。
- **根因**：`routes/export.ts:58` 直接传 `body`；`export/scene.ts` 不识别 `dforge.canvas.page` 信封，也不识别 `ScenePage` 的扁平 `nodes` + `rootIds` 结构与 `backgroundColor` 字段。
- **影响**：所有从编辑器导出的产物都是空白；失败不可见（API 200、UI 显示完成、文件可打开）。
- **建议**：
  1. 在 daemon 增加 `ScenePage → RenderScene` 适配层（展开 `page`；按 `rootIds` 深度遍历 `nodes`；映射 `fills[0].color`/`characters`/`cornerRadius`/`opacity`/`backgroundColor`）；或把渲染统一收进共享包，由引擎序列化直接产出场景；
  2. e2e 导出步骤补**内容断言**（PNG 非白像素、SVG 含节点/文本、PDF 含 `re f` 填充），不再只看「done」文案；
  3. 增加像素级回归（同页 PNG/SVG/PDF 三格式断言），修复前先以本票证据为基线。
- **回归候选**：R-07-01。

### B 级详情与建议处置

- **F-07-02**：先做 F-07-01 的适配；文本需字体/度量（CanvasKit 或引擎文本布局），位图需嵌入（SVG data URI / PDF XObject），PDF 圆角用贝塞尔路径、透明度用 ExtGState；多页需扩契约（当前 `ExportRequest` 只有单页）。回归 R-07-02。
- **F-07-03**：导入需要文件选择器 → 解包/校验（路径穿越、软链、manifest/页面 id、大小/深度）→ 落盘冲突策略（同名覆盖/重命名/取消）；导出打包需要 zip 与下载入口。与 F-03-03/F-03-05 的不可信 `.dfg` 防护一并设计。回归 R-07-03。
- **F-07-04**：`parseDocument` 对 `$version > DESIGN_IR_VERSION` 明确拒绝（错误码 + 当前/文件版本），对旧版本走迁移表；非数字/缺失不再静默折回；页信封 `$version` 同口径；补版本矩阵测试。回归 R-07-04。
- **F-07-05**：读取路径与写入同口径做深度上限（超限 422 `doc_invalid_body`）或改为受控序列化；错误消息只回稳定码。回归 R-07-05（与 R-03-05 同源）。

### C 级详情与建议处置

- **F-07-06**：在 `extractScene`/路由层做 `MAX_EXPORT_PIXELS`（如 16384×16384 或按内存预算）预检，超限 4xx；分块渲染或按倍率降采样；错误消息不回内部异常类型。R-07-06。
- **F-07-07**：对字符串值增加模式脱敏（如 `sk-[A-Za-z0-9_-]{16,}`）或在契约中禁用自由文本字段。R-07-07（与 R-03-09 同源）。
- **F-07-08**：敏感键改为精确匹配/白名单（`apiKey`、`authorization`、`password`、`access_token`…），保留 `totalTokens`；补单测。R-07-08。
- **F-07-09**：提供显式「重置本地凭据库」危险动作（二次确认，销毁旧密文并重建主密钥）；当前只能手工删 `credentials.key`。R-07-09。
- **F-07-10**：`workspaceDir`/`baseUrl` 读入即 trim；URL 用 `new URL()` 拼接路径（`new URL('/system_stats', baseUrl)`）而不是字符串相加；`ai.baseUrl` 至少提示「key 将发送到该地址」，并按 F-03-02 的会话令牌收口跨源写配置。R-07-10。

## 7. 导入导出与设置域五态判定（本票实测）

| ID | 能力 | 判定 | 依据 |
|---|---|---|---|
| D-01 | PNG/SVG/PDF 导出 | **broken** | 真实文档空白（F-07-01）；简化渲染器子集可用但保真不足（F-07-02） |
| D-02 | `.dfg` 保存/重开/跨会话恢复 | working | 真实页信封 PUT→GET 逐字节往返；既有 e2e/daemon 证据 |
| D-03 | `.dfg` 外部导入/打包导出 | **missing** | 无路由/UI/zip；仅剪贴板 IR |
| D-04 | 跨版本兼容 | **partial** | manifest schema 严格（422）；引擎/页信封 `$version` 静默接受 |
| D-05 | 设置四分区 + 保存态/校验 | working | 工作目录/凭据/ComfyUI/遥测读写与三态保存；13 文件/109 例定向测试 |
| D-06 | 凭据注入/掩码/清除 | working | 哨兵全链路无明文；0600；清除可恢复；损坏主密钥复位归 F-07-09 |
| D-07 | 四步引导 | working | 本轮未重跑浏览器；沿用 FE-09/04 证据 |
| D-08 | 空库冷启动 | working | 同上 |
| D-09 | 诊断面板 | working | health/connectivity/logs 三源可用；连通性不触达云端 |
| D-10 | 本地遥测 | **partial** | 开关/查看/删除工作；自由文本泄漏（F-07-07）与过度脱敏（F-07-08） |
| D-11 | 导出失败分类/行动建议/重试 | working | ExportPanel 10 例（定向套件 13 文件/109 例）；daemon 错误消息内部细节另记观察 |
| D-12 | 配置/工作目录持久化与可写校验 | working | 非法/不可写/被占用全部 400 且回滚；切换生效 |
| D-13 | 连接错误占位/中文 404 | working | 沿用 #52 证据（本票未重跑） |

## 8. 回归候选（修复后转绿；不是本票新增的必红测试）

| ID | 用例 | 当前状态 | 应落到 |
|---|---|---|---|
| R-07-01 | 真实页信封导出：PNG 非白像素 / SVG 含节点 / PDF 含填充 | fail | daemon 单测 + e2e 内容断言 |
| R-07-02 | 文本/位图/圆角/透明度/多页保真 | fail | daemon/引擎渲染单测 + 快照 |
| R-07-03 | `.dfg` 导入（文件选择/冲突/路径安全）与打包导出往返 | missing | e2e + daemon 单测 |
| R-07-04 | 未来 `$version` 拒绝、旧版本迁移矩阵（engine + 页信封） | fail | engine/contracts 单测 |
| R-07-05 | 深嵌套页读取 4xx（与 R-03-05 同源） | fail | daemon 单测 + `verify-resilience` |
| R-07-06 | 导出尺寸上限 4xx（`ulimit -v` 安全回归） | fail | daemon 单测 |
| R-07-07 | 遥测自由文本模式脱敏（与 R-03-09 同源） | fail | contracts 单测 |
| R-07-08 | `totalTokens` 不被误脱敏 | fail | contracts 单测 |
| R-07-09 | 凭据库显式重置（与 R-03-11 同源） | fail | daemon 单测 + 设置页 |
| R-07-10 | 路径/URL trim 与 URL 拼接 | fail | daemon 单测 |
| R-07-11 | 导出 500 不回内部异常类型 | observe | daemon 单测 |

## 9. 阻塞与未覆盖

| 项 | 状态 | 理由/替代 |
|---|---|---|
| `/proc/1/*` 作为工作目录 | **本环境阻塞** | WSL2 下 Node recursive `mkdir` 对 `/proc/1/*` 无限挂起（shell `mkdir` 立即 ENOENT）；请求无超时，按环境不可判定，不写成产品通过/失败 |
| 真实 GB 级 OOM | **有意未执行** | 共享主机；用 10GiB `ulimit -v` 子进程安全复现分配失败（F-07-06） |
| 真实 DeepSeek/ComfyUI | **按规格未使用** | 哨兵 key + 本地 fixture；真实 key 只允许用户安全注入后一次性手工验收 |
| SVG 像素级外部渲染 | **未执行** | 本机无 `rsvg-convert`/ImageMagick；已用 XML 良构 + 结构断言；PNG/PDF 有像素级外部校验 |
| 多页导出 | **missing** | 契约单页；归 F-07-02/后续票 |
| Windows/macOS 路径/NFC/保留名 | **沿用审计规格 blocked** | 本机 Linux 主判；本票未做跨平台矩阵 |
| 桌面壳文件对话框 | **missing（无实现）** | Electron 二进制缺失且代码无对话框；导入缺失结论不依赖运行态 |

## 10. 证据索引

`$EV = ~/df-evidence/audit-50/aud-07`

| 内容 | 路径 |
|---|---|
| 机器可读汇总（148 条，含 staticFacts/daemons/artifacts） | `$EV/io-settings-audit.evidence.json`（sha256 `e9b06072…`） |
| 最终运行日志 | `$EV/logs/audit-final.log` |
| 导出产物（PNG/SVG/PDF/PPM） | `$EV/artifacts/`（真实信封 PNG `405d2cf6…`、SVG `a7643e21…`、PDF `68f44784…`） |
| 引擎版本探查原始结果 | `$EV/probes/engine-version-probe.json` |
| 遥测原始 JSONL（清除前快照） | `$EV/probes/telemetry-events-before-clear.jsonl`（第 41/43 行） |
| 本地 fixture 请求记录（含 Authorization 头） | `$EV/probes/fixture-requests.json` |
| daemon 日志（主/损坏主密钥/损坏 JSON/env/ulimit） | `$EV/logs/daemon-{main,corrupt,corrupt-json,env,ulimit}.log` |
| 门禁日志 | `$EV/logs/{verify,test-scripts,verify-engine,verify-daemon,web-settings-targeted}.log` |
| daemon 侧导出物 | `$EV/runtime/2026-10-17T13-28-11/data/exports/` |
| 审计脚本（仓内） | `scripts/audit/io-settings-audit.mjs` |

## 11. 对后续票的输入

- **#58（跨域复验）**：导出主路径的 e2e 必须改为**内容断言**（当前只验完成文案）；`.dfg` 导入闭环落地后补「导入→编辑→保存→导出」全链路。
- **#56（AI/出图）**：`ai.baseUrl` 任意 http(s) 会把 Bearer key 发往该主机（本票 fixture 实证），与 prompt injection/上游契约一并评估；遥测 `totalTokens` 误脱敏影响 AI 用量观测。
- **#59（CI 改造）**：本票的 R-07-01/04/05/06/07/08/10 适合先进包级单测；导出像素/深嵌套/尺寸上限可进 `verify-resilience` 或独立导出门禁。`scripts/audit/io-settings-audit.mjs` 保持**仅本地一次性**，不接 CI。
- **#55（桌面壳/安全）**：F-03-02 的 `Origin: null` 与 F-07-10 的 `ai.baseUrl` 组合是凭据外送路径，建议壳会话令牌方案优先。
- **#60（文档漂移）**：能力表 D-01 的「简化渲染」需更正为「真实格式空白（F-07-01）」；e2e 导出步数/口径说明同步。
