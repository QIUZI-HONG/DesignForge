# PR_BATCH_6 — D-05 保存冲突检测：revision/If-Match→409 + 刷新恢复（audit-d06）

- **分支**：`fix/save-conflict-409`（工作树 `/home/QIU/df-wt/audit-d06`）→ **已合并 main**（merge `e9e8469`，4 提交 `465bc56`(contracts)→`6c47555`(daemon)→`9b57630`(web)→`b9c976b`(biome 格式)，基 `d8ebb84`，28 文件 +1353/−76；分支侧先并入 main tip `f79181c`（批8/批9）**零冲突**再重跑全量门禁；合并后 main 复验 `pnpm verify`=0 · `test:scripts`=0 · `verify:mcp-stub`=0 · `e2e:smoke`=0 · `audit` 三口径=0）
- **依据**：`docs/audit/DEFECTS.md` D-05（双页并发保存静默丢更新：J8 双页先后保存均 200、无 409，page1 位移被 page2 旧基线整页覆盖）· `docs/audit/OPTIMIZATION_PLAN.md` §6 / §6-Q2 **决策=A**（409 拒绝 + 手动刷新；自动合并复杂度高，本期不做）

## 变更说明（4 commits）

| 提交 | 文件 | 变更 |
|---|---|---|
| `465bc56` contracts | `ipc/errors.ts`（新错误码 `doc_revision_conflict`→**409**）+ `documents/index.ts`（`DocumentSummary.revision`、`DF_REVISION_HEADER='if-match'`、`formatRevisionHeader`/`parseRevisionHeader` 单一判据）+ 测试 | 保存冲突检测契约：revision 字段 + If-Match 头格式/解析**单一判据**（含引号实体标签形态），contracts 层钉住 |
| `6c47555` daemon | `documents/store.ts`（`savePage`/`createPage` 可选 `expectedRevision`，**提交锁内**比对）+ `routes/documents.ts`（If-Match 解析：非法头/`*` 通配→**400**；条件保存冲突→409；GET 读页带 revision）+ 新测试 `documents.revision.test.ts`（6 例） | 服务端条件保存：基线过期拒绝（不覆盖先写者），无版本头走旧行为 |
| `9b57630` web | `documents-client.ts`（请求层透出错误码 `ClientResult.code`；`savePage`/`createPage` 支持 `ifMatchRevision`；`saveDesignDocument` 增 `baselineRevision` 沿多写保存链**串行推进**基线，冲突即中止后续页）+ `page-set.ts`（载入结果带 revision=基线来源）+ `document-bridge.ts`（载入记基线 / 成功推进 / **冲突保持旧基线**——不刷新重存仍 409，确定性拒绝；首次落盘/导入替换=无基线走旧行为）+ `save-control.tsx`（409→独立冲突文案 + 「刷新载入最新版本」按钮，不落网络族/通用失败形态）+ `messages/zh-CN.json`/`en.json` 各 2 键（`editor.save.conflict` / `editor.save.conflict.refresh`）+ 新测试 `save-conflict.test.ts`（7 例）+ `save-control.test.tsx`（冲突渲染/恢复 2 例）+ 8 处既有夹具补 revision | 客户端条件保存全链 + 冲突恢复路径（刷新载入最新版本再继续） |
| `b9c976b` | biome `check --write` 格式修正（web 5 文件 + daemon 4 文件） | 纯格式，语义不变 |

**兼容双钉**（协议变更不破旧面）：
1. **无 If-Match 走旧行为**（last-write-wins）——旧客户端 / e2e 脚本 / verify-perf 零感知（daemon 钉：不带版本头的保存，文档被他人改过后仍 200）；
2. **新客户端连旧 daemon 自动降级**——响应缺 revision → 基线 `revision=null` 不谎报，未给基线不发 If-Match（web 钉：旧 daemon 保存仍成功）。

## J8 双层红转绿（证据 `~/df-evidence/audit-d06/`）

| 层 | 修复前（红证） | 修复后（绿证） |
|---|---|---|
| daemon HTTP 层 | `red-daemon-revision-before.log`：**4 failed** | `green-daemon-revision-after.log`：**6/6 passed**（`documents.revision.test.ts`） |
| web app 层 | `red-web-conflict-before.log`：**9 failed** | `green-web-conflict-after.log`：**14/14 passed**（批4 既有钉 5 全绿保住 + 新增 9） |

红转绿场景（两层同构）：J8 双「窗口」先后条件保存——后写者（旧基线）收到 **409 `doc_revision_conflict`** 而非静默覆盖，先写者内容不被覆盖；恢复路径——冲突后刷新（读最新 revision）再条件保存 → 200。

## 兼容与信封

- **公共 API 信封 `{ok,result,error}` 不变**；409 信封 raw 实录（`envelope-conflict-409.json`）：`code=doc_revision_conflict`、人话中文 message、`details` 含 `expectedRevision`/`currentRevision`（另有 first-200 / create-201 / legacy-200 / readback 四份对照实录）。
- 既有 409 明确拒绝钉（`doc_exists` 不入网络族）保绿；save-control 的冲突态不落批4 收敛的网络族/通用失败形态（独立文案语义）。

## 测试结果（合并后 main 复验，逐条真实退出码）

| 验收 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | **exit 0**（批9 动过 lockfile，主树复核一致） |
| `pnpm verify` | **exit 0**（daemon 24 文件 212 例全过，含本批 6 例） |
| `pnpm test:scripts` | **exit 0**（139 例） |
| `NODE_OPTIONS=--experimental-strip-types pnpm verify:mcp-stub` | **exit 0**（16 步 0 失败） |
| `pnpm e2e:smoke`（真 Chromium + 生产构建 + 临时数据根仓外） | **exit 0**——保存链改动后的最终实证：拖画→持久化→导出/导入往返 + 首页全链路 + 导航携端点 + 编辑器渲染门禁全过（分支侧未跑过 smoke，main 复验真跑补上） |
| `pnpm audit` / `--prod` / `--dev` 三口径 | **exit 0 × 3**（"No known vulnerabilities found"） |
| 分支侧门禁（并入 tip 后重跑） | verify=0 · test:scripts=0（139）· guard:vocab=0 · guard:feature-boundaries=0 |

## 风险

- 协议面：If-Match 头格式走 contracts 单一判据（客户端与服务端共用 format/parse，无第二实现）；非法头 400 快速拒绝（含 `*` 通配），不给歧义行为留口。
- 冲突恢复的 UI 语义：刷新载入最新版本会**放弃本窗口未保存的修改**（文案已明示）；自动合并按 Q2=A 决策明确不做。

## 回滚

`git revert -m 1 e9e8469`（合并提交）；回滚后即恢复 last-write-wins 旧行为，无数据迁移面（revision 仅请求/响应字段，不落盘 schema）。

## 遗留

- **浏览器级双标签页 J8 旅程仍为挂点**（随浏览器门禁票接入）——本票以 daemon HTTP 层 + web app 层两层恢复场景覆盖；e2e:smoke 的保存主路径（单窗口）已真跑保绿。
- `guard:deps` / `guard:mcp-contract` / `guard:channel-pairing` 仍为桩（`exit 2` 阻塞），与本票无关，随各自票收口。
