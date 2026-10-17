# 审计 03 · 数据完整性与安全深挖（含韧性接缝）

- **状态**：已完成（审计阶段；**未改产品代码**，只新增测试工装与文档）
- **日期**：2026-10-17（UTC+8 20:52–21:05）
- **代码基线**：`integration/audit-v1` @ `9079f02`（= 审计 01 合并点）
- **本票分支/工作树**：`audit/03-data-security` / `/home/QIU/df-wt/aud-03`
- **范围**：daemon 文件 IO/路径穿越、并发写、进程崩溃、ENOSPC/EACCES/EIO、fsync/rename 失败、损坏 `.dfg`、导入导出边界、凭据与遥测。
- **证据根**：`~/df-evidence/audit-50/aud-03/`（下称 `$EV`；**全部证据在仓库外**）
- **韧性接缝**：`scripts/verify-resilience.mjs`（新增；47 步真实链路）+ `scripts/tests/verify-resilience.test.mjs`（10 例纯函数自测）
- **结论口径**：三态退出码 `0 通过 / 1 真违规 / 2 阻塞`；本文「阻塞」与「本环境不可复现」严格区分，不把注入故障写成真实硬件故障。

## 1. 执行摘要

正常态防护**总体成立**：越界读写删、出根软链、删除守卫、标识符边界、原子写、SIGKILL 后的 JSON 完整性、损坏 manifest 的 4xx/告警、凭据 0600 与掩码、遥测关闭均按纪律工作。

但本地真值仍存在**可复现的 A/B 级缺陷**：

| 级别 | 缺陷 | 后果 |
|---|---|---|
| **A** | 两个 daemon 共享同一工作目录时，并发建页会丢已回 201 的页面（20 个 201 → manifest 仅 11 页） | **静默数据丢失**（跨进程互斥缺失） |
| **A** | `Origin: null` 被 CORS 放行，本地页面中的沙箱 iframe（不透明源）可**读取并删除**任意文档（浏览器实证） | 本地真值可被不可信页面越权读写删 |
| **B** | 根内软链（`evil.dfg/pages -> ../victim.dfg/pages`）被跟随，保存 evil 会覆盖 victim | 克隆来的不可信 `.dfg` 可跨文档篡改 |
| **B** | manifest 提交失败（ENOSPC/EIO/rename/EACCES）时正文已落盘：接口回 500，但重开读到**新正文**、manifest 仍是旧版本 | 失败语义与真实状态不一致（半提交） |
| **B** | 20k 层嵌套页 JSON（克隆/手工放入的 `.dfg`）使 `GET .../pages/:pageId` 返回 500（`Maximum call stack size exceeded`） | 恶意/异常导入件打开页面即失败 |

另有 9 条 C 级观察（错误消息泄漏绝对路径、孤儿目录不可删、临时文件残留、遥测自由文本不脱敏、MCP 深嵌套 500、损坏主密钥无复位、删除竞态 500、导出画布无尺寸上限、MCP pending 重启丢失）。

**韧性接缝当前实况**：`node scripts/verify-resilience.mjs` → 47 步，`pass=31 / fail=9 / blocked=0 / observe=7`，**exit 1**（9 个 fail 全部对应上表的 A/B 缺陷，是如实红灯，不是环境阻塞）。缺 C 编译器时故障注入段按 `exit 2` 点名。

## 2. 基线与既有覆盖（先跑后改）

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| daemon 单测 | `pnpm --filter @dforge/daemon test` | **118/118 通过**（13 文件） | `$EV/logs/baseline-daemon-test.log` |
| daemon 契约冒烟 | `pnpm verify:daemon` | **37/37 通过，exit 0** | `$EV/logs/baseline-verify-daemon.log` |
| engine 导入导出边界 | `pnpm verify:engine` | **312/312 通过，exit 0**（含序列化深度上限/非有限数/`__proto__` 丢弃） | `$EV/logs/verify-engine.log` |
| 脚本门禁自测 | `pnpm test:scripts` | **66/66 通过**（含本票新增 10 例） | `$EV/logs/test-scripts.log` |
| 脚本 lint | `pnpm lint:scripts` | exit 0（1 条既有 warning，与本票无关） | `$EV/logs/lint-scripts.log` |
| **韧性接缝** | `node scripts/verify-resilience.mjs` | **47 步：31 pass / 9 fail / 0 blocked / 7 observe，exit 1** | `$EV/verify-resilience.evidence.json`、`$EV/logs/verify-resilience.run2.log` |

既有套件已覆盖（本票复跑确认）：`documents.security.test.ts` 的 Q1 路径穿越/软链/删除守卫/NFC-NFD/并发建页，`adversarial.test.ts` 的并发原子写/深嵌套 4xx/凭据哨兵/CORS/导出魔数。**未被覆盖的风险面**：跨进程并发、崩溃/磁盘/权限故障、根内软链、CORS `null` 的浏览器可利用性、深层页读取。

## 3. 覆盖矩阵（故障类 → 结论）

| 故障类 | 观测结果 | 判定 | 证据 |
|---|---|---|---|
| `..%2F`、`%2E%2E`、反斜杠、双重编码、绝对路径、NUL、NFD、超长 id | 读/写/删一律 4xx，树外零副作用 | **通过** | harness `path.*`；`probe1.results.json` |
| 出根软链（pages 目录 / 页文件 / 文档目录） | 读写一律 4xx，树外正文未变 | **通过** | harness `path.symlink-*`；`documents.security.test.ts` |
| 删除守卫（数据根/祖先/根内普通文件） | 一律 4xx；删除含出根软链的文档只删链接 | **通过** | harness `path.delete-*` |
| 根内软链（跨文档 pages / 文档别名） | **被跟随并可写穿到另一文档** | **F-03-03（B）** | harness `symlink.in-root-*`；`probe6.results.json` |
| 单进程并发建页/保存/同名建文档 | 无丢失、无半截 JSON、恰一个 201 | **通过** | daemon 单测；harness `concurrency.cross-process-same-name` |
| 跨进程并发建页 | 20 个 201，manifest 仅 11 页（丢 10） | **F-03-01（A）** | `probe2.results.json`；harness `concurrency.cross-process-create-page` |
| 跨进程并发保存 | 17×200 + 3×409，无半截 JSON（有界冲突语义） | **通过（按设计）** | harness `concurrency.cross-process-save-page` |
| 删除与保存竞态 | 最终删除成功、无目录复活；竞态保存有 500（应 404/409） | **部分 / F-03-12（C）** | `probe2.results.json`；harness `concurrency.delete-race-500` |
| 写入中 SIGKILL（40×900KB 在飞） | 重启后正文是已提交版本之一、manifest 可解析、无半截 JSON | **通过** | harness `crash.sigkill-during-save`；`probe4.results.json` |
| 建页中 SIGKILL | 已回 201 的页全部在 manifest | **通过** | harness `crash.sigkill-during-create-page` |
| 崩溃/故障残留 `.tmp` | 重启不清理（原子写 temp 文件名固定模式） | **F-03-08（C）** | `probe3/probe4`；harness `fault.enospc-page-write` |
| 截断 manifest / 未来 schema / 截断页 / 2MB 页 / 同名普通文件 | 4xx 或 200；列表进入 warnings，不阻塞 | **通过** | harness `corrupt.*` |
| 20k 层嵌套页（导入件） | `GET page` → **500**；导出 200（2000 节点预算截断） | **F-03-05（B）** | `probe1.results.json`；harness `corrupt.deep-page-read` |
| 缺 manifest 的 `.dfg` | 列表告警；`DELETE` → 404，目录仍在 | **F-03-07（C）** | harness `corrupt.orphan-doc-deletable` |
| EACCES（chmod 只读） | 保存 500，旧正文保留；错误消息泄漏绝对路径 | **部分 / F-03-06（C）** | harness `fs.eacces-save`、`errors.absolute-path-leak` |
| ENOSPC / EIO / fsync / rename 失败（syscall 注入） | 页面目标：500 + 旧正文保留；**manifest 目标：500 但正文已更新** | **部分 / F-03-04（B）** | `probe3.results.json`；harness `fault.*` |
| 凭据 0600 / 掩码 / 响应+磁盘+日志无明文 | 全部成立 | **通过** | harness `secrets.mask-modes-no-leak`；verify-daemon |
| 遥测敏感键脱敏 / 关闭开关 | 成立；自由文本键不脱敏 | **部分 / F-03-09（C）** | harness `telemetry.*` |
| CORS 白名单（非 null） | 精确回显 / 非白名单不放行 | **通过** | harness `cors.whitelisted`、`cors.non-whitelisted` |
| CORS `Origin: null` | 允许读列表与 DELETE（沙箱 iframe 浏览器实证） | **F-03-02（A）** | `probe5.results.json`；harness `cors.origin-null` |
| 导入导出边界（超大/深嵌套/NaN/未来字段） | 请求体 >1MiB → 400；正文 >1024 层 → 400；未来 manifest schema → 422；未来页字段按 opaque 接受；NaN 不可能出现在合法 JSON（engine 侧显式拒绝非有限数） | **通过（daemon 侧）** | daemon 单测；`packages/engine/src/serialize/serialize.ts` |

## 4. Findings

> 分级：A = 阻断（安全或数据丢失风险）；B = 严重（规格未达/功能受损）；C = 一般/观察。
> 五态：working / partial / missing / broken / blocked。

### F-03-01 · A · broken · 跨进程并发建页丢失已回 201 的页面

- **复现**：同一 `dataRoot` + `workspace` 起两个 daemon（不同端口），并发各发 10 个 `POST /documents/:id/pages`；20 个请求全部 201，`manifest.pages` 只有 11 页（含 `page-1`）。
- **证据**：`$EV/probes/probe2.results.json`（`xproc.createPage`）；`$EV/verify-resilience.evidence.json`（`concurrency.cross-process-create-page`）；`$EV/logs/verify-resilience.run2.log`。
- **根因**：互斥是**进程内**的（`apps/daemon/src/mutex.ts`）；跨进程只有 `commitManifest` 的「写后重读比对 + 最多 3 次重试」（`apps/daemon/src/documents/store.ts:106,249`）。两个进程从同一 manifest 计算出相同 `page-N`，互相覆盖 manifest/正文，各自确认自己的写入成功后返回 201——先提交者的页面在新 manifest 中被抹掉。
- **影响**：桌面壳 + CLI / 多实例 / 崩溃后新旧实例重叠时，用户看到「保存成功」但页面消失。**静默数据丢失**。
- **建议**：工作目录级单写者锁（锁文件 + 失败退出 2 或只读模式）；或页 id 分配改为携带随机段/先占位文件 `O_EXCL`；manifest 提交加跨进程文件锁（`flock`）。
- **回归候选**：R-03-01（harness 现存断言，修复后应转绿）。

### F-03-02 · A · broken · CORS `Origin: null` 允许不可信页面读写删本地真值

- **复现**：本地 HTTP 页面内嵌 `<iframe sandbox="allow-scripts">`，iframe 内 `fetch(daemon/documents)` 与 `DELETE /documents/victim`；两者均 200，文档被删除。服务端响应 `access-control-allow-origin: null`，预检允许 `DELETE`。
- **证据**：`$EV/probes/probe5.results.json`（浏览器实测，Chromium 1243）；harness `cors.origin-null`。
- **根因**：`apps/daemon/src/cors.ts:67` 对 `Origin: null` 无条件放行（为打包壳 `file://` 设计）。`null` 同时是**任意沙箱 iframe**的不透明源；`file://` 页面直连本次未单独验证，但属同一信任缺口。
- **影响**：用户打开的本地页面只要嵌入一个沙箱 iframe，即可读取/删除/改写全部文档、切换工作目录。远端网页受 Chrome Private Network Access 限制（本次未验证远端路径），但**本地页面路径已实证**。
- **建议**：保留壳能力但加**会话令牌**（壳启动时注入随机 token，daemon 校验 `x-dforge-token`），或对 `null` 只放行 GET 且带壳专用凭证；CORS 不能作为唯一信任边界。
- **回归候选**：R-03-02（harness + 浏览器断言）。

### F-03-03 · B · broken · 根内软链导致跨文档别名读写

- **复现**：`evil.dfg/pages -> ../innocent.dfg/pages`，`PUT /documents/evil/pages/page-1` 返回 200，`GET /documents/innocent/pages/page-1` 读到 `{"pwned":true,"from":"evil"}`。`alias.dfg -> innocent2.dfg` 同样可写穿。
- **证据**：`$EV/probes/probe6.results.json`；harness `symlink.in-root-cross-doc-pages`、`symlink.in-root-doc-alias`。
- **根因**：`resolveWithin`（`apps/daemon/src/path-safety.ts:123`）只拒绝**出根**软链；根内软链被 `realpath` 视为合法目标。`readManifestAt`/`writeFileAtomic` 随后按真实路径读写。
- **影响**：克隆来的不可信 `.dfg` 可包含指向同工作目录另一文档的软链；用户打开并保存该文档即**覆盖另一文档**（跨文档数据损坏）。与「manifest 是不可信输入」同一威胁模型。
- **建议**：文档目录内**任何软链一律拒绝**（对 `manifest.json`/`pages`/页文件 `lstat`，或 `O_NOFOLLOW`）；如需支持引用，走显式契约字段而非文件系统软链。
- **回归候选**：R-03-03。

### F-03-04 · B · broken · manifest 提交失败时正文已生效（半提交）

- **复现**（syscall 注入）：ENOSPC/EIO/EACCES 命中 manifest 临时文件（或 rename manifest）时，`PUT` 返回 500；重启后 `GET page` 返回**新正文**，manifest 仍是旧版本（version 不变）。
- **证据**：`$EV/probes/probe3.results.json`；harness `fault.enospc-manifest-write`、`fault.eio-manifest-fsync`、`fault.eio-manifest-rename`、`fault.eacces-manifest-open`。
- **根因**：`savePage` 先 `writeFileAtomic(pagePath)`、后提交 manifest（`documents/store.ts` 的提交顺序注释）。页面正文与 manifest 是两个独立原子写，没有事务/回滚；manifest 失败时正文已替换。
- **影响**：客户端收到失败却看到内容变化；依赖 manifest `version/updatedAt` 的缓存/同步/评审会与服务端真实内容不一致。不丢数据，但**提交语义被破坏**。
- **建议**：页文件按版本命名（`page-N@rev.json`）+ manifest 原子切换；或先写 journal/pending，manifest 成功后切换，失败回滚正文；至少把失败响应的错误码与真实状态文档化。
- **回归候选**：R-03-04。

### F-03-05 · B · broken · 深嵌套页 JSON 读取返回 500（导入边界）

- **复现**：在 workspace 放入 `deep-page.dfg/pages/page-1.json`（20k 层 `frame.children`），`GET /documents/deep-page/pages/page-1` → 500 `internal`，`details.reason = "Maximum call stack size exceeded"`。导出同页 → 200（`MAX_NODES=2000` 截断）。
- **证据**：`$EV/probes/probe1.results.json`（`corrupt.deep-page`）；harness `corrupt.deep-page-read`。
- **根因**：`savePage` 有 1024 层写入上限，但**读取/响应序列化**没有深度上限；导入件绕过写入路径。Fastify 对响应体做递归序列化时栈溢出。
- **影响**：克隆/手工放入的异常 `.dfg` 使页面无法打开（500），错误消息暴露内部异常类型；不是进程崩溃，但属于导入不可信件的健壮性缺口。
- **建议**：读取时与写入同口径做深度校验（超限 → 422 `doc_invalid_body`），或响应改为流式/受控序列化；对 `GET page` 增加 `MAX_BODY_DEPTH` 检查。
- **回归候选**：R-03-05。

### F-03-06 · C · broken · 500 错误详情泄漏绝对路径

- **复现**：EACCES/ENOSPC/EIO 触发 500，`error.details.reason` 含完整路径（如 `EACCES: permission denied, open '/home/.../workspace/.../.tmp'`）。
- **证据**：harness `errors.absolute-path-leak`、`fs.eacces-save`；`$EV/probes/probe3.results.json`。
- **根因**：`apps/daemon/src/app.ts:200` 把原始错误消息直接放进 `details.reason`。
- **影响**：向任何能读响应的客户端（含 F-03-02 的 null 源）暴露数据根/工作目录布局；与 4xx 路径「不回显绝对路径」的纪律不一致。
- **建议**：500 对外只回稳定错误码 + 关联 id；原始消息只进本地日志（日志本身也不得含凭据）。
- **回归候选**：R-03-06。

### F-03-07 · C · broken · 缺 manifest 的 `.dfg` 目录无法通过 API 删除

- **复现**：`missing-manifest.dfg/` 无 `manifest.json`（崩溃在 mkdir 与 manifest 写之间，或中断的导入）：`GET /documents` 给出 warning；`DELETE /documents/missing-manifest` → 404 `doc_not_found`；目录永久残留。
- **证据**：`$EV/probes/probe1.results.json`（`corrupt.orphan-deletable`）；harness `corrupt.orphan-doc-deletable`。
- **影响**：崩溃/中断导入留下用户无法在应用内清理的目录；列表长期带 warning。
- **建议**：删除守卫允许「数据根直接子级、名字符合 `.dfg`、`lstat` 为真实目录」的目标在 manifest 缺失时删除；或提供诊断页的显式清理动作。
- **回归候选**：R-03-07。

### F-03-08 · C · partial · 崩溃/故障遗留原子写临时文件且重启不清理

- **复现**：`fault.enospc-page-write` / `fault.eio-page-fsync` 失败后留下 `pages/.<hex>.tmp`；SIGKILL 时机命中写入阶段时同样残留（`probe4` 观测到 1 个）。重启后仍在。
- **证据**：`$EV/probes/probe3.results.json`、`probe4.results.json`；harness `fault.*` 的 `temp-leftover` 观察。
- **影响**：磁盘缓慢泄漏；不影响读取（读只认目标名）。
- **建议**：启动时清理 `.dfg/pages` 与文档根下匹配 `^\.[0-9a-f]{12}\.tmp$` 的孤儿 temp（注意避免误删其它进程正在写的文件——可加年龄阈值）。
- **回归候选**：R-03-08。

### F-03-09 · C · partial · 遥测只按「敏感键名」脱敏，自由文本中的密钥原样落盘

- **复现**：`POST /telemetry/events` 的 payload 中 `apiKey/token/password` 被替换为 `[redacted]`；`prompt: <哨兵 key>` 原样写入 `telemetry/events.jsonl`。
- **证据**：harness `telemetry.sensitive-keys-redacted`、`telemetry.free-text-secret`；`$EV/probes/probe1.results.json`。
- **影响**：用户把 key 粘进 prompt/备注时，遥测会违背「key/token 永不落盘」的绝对表述。
- **建议**：对字符串值增加 `sk-[A-Za-z0-9_-]{16,}` 一类模式脱敏；或在遥测契约里明确「自由文本不保证脱敏」并禁止自由文本字段。
- **回归候选**：R-03-09。

### F-03-10 · C · partial · MCP 提案深嵌套 args 返回 500

- **复现**：`POST /mcp/proposals` 的 `args` 为 20k 层嵌套对象 → 500（`JSON.stringify(input.args)` 栈溢出，`apps/daemon/src/mcp/stub.ts` 的 `argsDigest`）。
- **证据**：harness `mcp.deep-args`；`$EV/probes/probe1.results.json`。
- **影响**：本地客户端可稳定触发 500；无数据损失，但错误未映射为 4xx。
- **建议**：提案入口做 JSON 深度/大小上限（与 `exceedsJsonDepth` 同口径），超限 400。
- **回归候选**：R-03-10。

### F-03-11 · C · blocked · `credentials.key` 损坏后无 API 复位路径

- **复现**：写坏 `credentials.key`（非 32 字节 base64）后重启，`PUT /config/credentials` → 400 `credential_invalid`（「主密钥不可用」）；`DELETE /config/credentials` 不会删除/重建 key 文件。
- **证据**：`$EV/probes/probe4.results.json`；harness `recovery.corrupt-credentials-key`。
- **影响**：BYOK 功能被永久阻塞，直到用户手工删除 `~/.dforge/credentials.key`（普通设置页无入口）。
- **建议**：提供显式的「重置本地凭据库（销毁旧密文）」危险操作（二次确认），而不是建议手工改文件。
- **回归候选**：R-03-11。

### F-03-12 · C · partial · 删除与保存竞态返回 500

- **复现**：一个进程持续保存、另一个进程删除同一文档；竞态中的保存返回 500（`ENOENT`），而不是 404/409。
- **证据**：`$EV/probes/probe2.results.json`（`xproc.delete-vs-save`，状态含 500）；harness `concurrency.delete-race-500`。
- **影响**：客户端收到不可重试语义的错误；无数据复活。
- **建议**：写路径捕获 `ENOENT` → `doc_not_found`（404）或 `conflict`（409）。
- **回归候选**：R-03-12。

### F-03-13 · C · blocked · 导出画布尺寸无上限（本环境未实测内存耗尽）

- **静态结论**：`extractScene` 只保证 `width/height ≥ 1`，`rasterizeScene` 直接 `new Uint8Array(width * height * 4)`（`apps/daemon/src/export/png.ts:128`）。`1e6×1e6` 会因超过 TypedArray 上限被 `export_render_failed` 捕获（既有测试），但 `30000×30000`（约 3.6GB）在分配成功/失败之间可能触发进程级 OOM。
- **未测理由**：本机为共享 WSL2，主动触发 GB 级分配或 OOM 会波及用户会话（硬约束：不干扰常驻实例），故只做静态判定并登记为 blocked。
- **建议**：对导出尺寸设硬上限（如 16384×16384，超限 4xx），或按内存预算分块。
- **回归候选**：R-03-13（修复后以 `ulimit -v` 限制子进程内存做安全回归）。

### F-03-14 · C · missing · MCP pending 提案重启后丢失（桩的已知边界）

- **复现**：`POST /mcp/proposals` 拿 token → 重启 daemon → `POST /mcp/ack` → 403 `mcp_ack_invalid`；审计中留下永久 `pending` 记录。
- **证据**：`$EV/probes/probe4.results.json`；harness `recovery.mcp-pending-after-restart`。
- **影响**：本段是桩（不真实写入），影响有限；但 P5 真写事务必须做持久化/幂等恢复，否则重启即丢失确认态。
- **建议**：P5 落地时把 pending/token 持久化（或明确「重启即作废」并在审计补 `expired` 终态）。
- **回归候选**：R-03-14。

## 5. 已确认的非缺陷 / 设计取舍

- 文档正文 `0644`、目录 `0755`：为 Git/用户直接读取设计（本地优先）；凭据/配置/遥测/审计均为 `0600`。多用户主机上的文档机密性不在当前威胁模型内——如要收窄，另开票定义 umask/目录权限策略。
- `GET /documents` 返回绝对 `directory`、`/health` 返回 `dataRoot`：契约明确为本地应用展示；与 F-03-02 组合时风险被放大，修复 CORS 后维持现状可接受。
- 跨进程保存返回 409：`MAX_COMMIT_ATTEMPTS=3` 的**有界冲突**语义，本次 17×200+3×409 无半截 JSON；不按缺陷计，但客户端必须处理 409。
- 未来 manifest schema → 422：不做静默迁移，符合「版本化导入」纪律。未来**页字段**按 opaque 保留（daemon 不解析节点语义）。
- engine 侧 `$version` 未来值仍被接受（`parseDocument` 返回 version 但无拒绝）——属 #57 导入导出域，本票只标注交叉引用，不重复计缺陷。

## 6. 本环境不可复现 / 阻塞项

| 项 | 状态 | 理由 / 替代 |
|---|---|---|
| 真实磁盘写满（ext4 ENOSPC） | **不可复现** | 无 root/CAP_SYS_ADMIN（`sudo -n` 需交互），无法挂载小容量 loop 文件系统；`/home` 尚有 897G。以 `LD_PRELOAD` 在 `open/write` syscall 层注入 ENOSPC（harness `fault.enospc-*`），并在本文标注为**注入**而非真实磁盘故障。 |
| 硬件 EIO / 坏道 | **不可复现** | 无故障块设备；以 shim 注入 EIO（`fault.eio-*`）。 |
| 物理掉电 / fsync 持久性 | **不可复现** | WSL2 虚拟盘，无法做受控掉电；`syncDir` 对不支持目录 fsync 的平台静默降级（代码注释），真实持久性只能靠 ext4 语义推断。 |
| Windows / macOS 路径与 NFC 行为、Windows 保留名（`CON.dfg`） | **不可复现** | 本机 Linux 主判；跨平台矩阵按审计规格属 blocked，未在本票执行。 |
| Electron 壳运行态（真实 `Origin: null`） | **阻塞** | 基线已记录 Electron 二进制缺失；本票用 Chromium 沙箱 iframe 复现同一不透明源行为，壳内具体装载路径待桌面壳票。 |
| 远端网页 → 127.0.0.1 的 Private Network Access 实际拦截 | **未验证** | 只实证本地页面/沙箱 iframe；Chrome PNA 对公网→本地的限制未做跨浏览器矩阵。 |
| 导出 GB 级画布 OOM | **未执行（有意）** | 避免干扰共享主机；见 F-03-13。 |
| 网络文件系统（NFS/SMB）上的 rename/并发语义 | **未覆盖** | 本机 ext4；工作流假定本地盘。 |

**门禁阻塞项**：本次 `verify-resilience` 0 blocked。若机器缺 C 编译器，故障注入段会逐条 `exit 2` 并点名——**不得当作通过**。

## 7. 回归候选清单（修复后转绿）

| ID | 用例 | 当前状态 | 应落到 |
|---|---|---|---|
| R-03-01 | 跨进程建页 201 不丢失 | fail | `verify-resilience`（修复后转 `pass`，再考虑接 CI） |
| R-03-02 | `Origin: null` 越权读写删 | fail | `verify-resilience` + 壳/浏览器门禁 |
| R-03-03 | 根内软链拒绝（pages/页文件/文档别名） | fail | daemon 单测 + harness |
| R-03-04 | manifest 失败不暴露新正文 | fail | daemon 单测（故障注入）+ harness |
| R-03-05 | 深嵌套页读取 4xx | fail | daemon 单测 + harness |
| R-03-06 | 500 错误不含绝对路径 | observe | daemon 单测 + harness |
| R-03-07 | 孤儿 `.dfg` 可删 | observe | daemon 单测 + harness |
| R-03-08 | 启动清理孤儿 `.tmp` | observe | daemon 单测 + harness |
| R-03-09 | 遥测值模式脱敏 | observe | contracts/telemetry 单测 |
| R-03-10 | MCP args 深度上限 4xx | observe | daemon 单测 |
| R-03-11 | 凭据库显式重置 | observe | daemon 单测 |
| R-03-12 | 删除竞态 404/409 | observe | daemon 单测 |
| R-03-13 | 导出尺寸上限 | blocked | daemon 单测（`ulimit -v`） |
| R-03-14 | MCP pending 恢复/作废终态 | observe | P5 |

## 8. 证据索引

| 内容 | 路径（`$EV = ~/df-evidence/audit-50/aud-03`） | sha256（前 16） |
|---|---|---|
| 基线：daemon 118 例 | `$EV/logs/baseline-daemon-test.log` | — |
| 基线：verify-daemon 37 步 | `$EV/logs/baseline-verify-daemon.log` | — |
| 基线：engine 312 例 | `$EV/logs/verify-engine.log` | — |
| probe1（路径/软链/损坏 `.dfg`/凭据/遥测/MCP/EACCES） | `$EV/probes/probe1.results.json` | `da68894d9ec411a7` |
| probe2（跨进程并发/删除竞态） | `$EV/probes/probe2.results.json` | `1a351dd2b036dded` |
| probe3（ENOSPC/EIO/fsync/rename 注入） | `$EV/probes/probe3.results.json` | `f095effd4de1dc66` |
| probe4（SIGKILL/重启/损坏配置） | `$EV/probes/probe4.results.json` | `2508ca8f0b7e2f01` |
| probe5（CORS `null` 浏览器实证） | `$EV/probes/probe5.results.json` | `3b1310d4aae72307` |
| probe6（根内软链跨文档写） | `$EV/probes/probe6.results.json` | `933ffe441862b4bf` |
| 韧性接缝证据（47 步） | `$EV/verify-resilience.evidence.json` | `11d5a49f5d22fd9d` |
| 韧性接缝运行日志（含 pass/fail/observe 明细） | `$EV/logs/verify-resilience.run2.log` | — |
| 各 daemon 子进程日志 | `$EV/logs/resilience-*.log` | — |
| 失败现场（临时数据根，便于复核） | `$EV/tmp/*` | — |
| 故障注入 shim（仓内） | `scripts/fixtures/fs-fault-shim.c` | 编译产物 sha256 见证据 JSON |

## 9. 方法与限制

- 所有 daemon 均以**临时数据根 + 空闲端口**启动，未触碰 `~/.dforge` 与常驻 3000/4318；临时根固定 `$EV/tmp`（拒绝 `/tmp`）；只按**精确 PID** 回收子进程，未使用 `pkill -f`。
- `verify-resilience` 是可重复执行的仓内接缝；probe1–6 是本次审计的一次性取证脚本（仓库外保存），用于浏览器实证与更细的状态对照。
- 故障注入是**syscall 级**（LD_PRELOAD）与真实信号/权限的组合；它能证明 daemon 在这些错误码下的行为，但不能替代真实硬件/掉电验证。
- 未改产品代码：本票提交只含 `scripts/verify-resilience.mjs`、shim、自测、`package.json` 命令与两处门禁实况文档；findings 的修复按 #50 纪律逐项确认后另票处理。

## 10. 对后续票的输入

- **#54（编辑器/评审）**：跨进程丢页（F-03-01）会直接影响「保存后重开」在双实例场景的可信度；评审/版本若依赖 `manifest.version`，F-03-04 会造成版本漂移。
- **#55（市场/桌面壳/MCP）**：CORS `null`（F-03-02）是壳安全边界的前置；壳应改为注入会话令牌。MCP 深嵌套（F-03-10）与 pending 恢复（F-03-14）归 MCP 契约/桌面壳票。
- **#56（AI/出图）**：`comfy.installPath` 仅用于提示 `launch` 动作，不执行命令（已核对），本票无新增注入面；遥测自由文本（F-03-09）与 AI prompt 日志相关。
- **#57（导入导出/设置）**：深嵌套页读取（F-03-05）、未来 `$version`（engine，交叉引用）、导出尺寸上限（F-03-13）、凭据重置（F-03-11）应在该域收口。
- **#59（CI 改造）**：`verify-resilience` 修复 A/B 缺陷后从 `exit 1` 转 `exit 0`，再评估接 CI；当前自测（10 例）已随 `test:scripts` 进 CI，**真实链路 47 步不接 CI**（避免长期红灯，但不是假绿——脚本如实 exit 1 并点名）。
- **#60（文档漂移）**：本次已同步 `AGENTS.md` 与 `docs/agents/implementation-workflow.md` 的门禁实况；`verify-resilience` 标记为「仅本地、审计期 exit 1」。
