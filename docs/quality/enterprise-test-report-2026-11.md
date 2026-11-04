# 企业级测试报告（2026-11-04）

- 对象：`integration/test-execution-phase1` @ `c8c9894`（阶段 1 五票 tp1-01…05 + code-review 修复 6 提交；基线=战役 A `c76819a`）
- 环境：WSL2 · node v22.16.0（ZCode runtime）· pnpm 10.33.2 · 无 Chromium 系统库（libnspr4 缺）· 无 Electron 二进制
- 依据：`docs/quality/enterprise-test-protocol-2026-11.md`（E1–E5）；《测试设计》§10.1 G1–G4
- 证据：`~/df-evidence/enterprise-final/`（e4-result.json、e4-fuzz-and-origin.mjs）+ 各票 `~/df-evidence/tp1-*/`

## 摘要（一屏）

| 轮 | 结论 |
|---|---|
| E1 常规链全量 | **exit 0**：lint+typecheck+test 全包绿（daemon 147 · web 1697 · ingest 579 · cli 45 · engine 386 等） |
| E2 门禁矩阵 | 期望态全部符合；**1 项继承违规**（feature-boundaries，战役 A 遗留）+ 1 项环境中断（verify:canvas，浏览器不可用）；运行口径教训 1 条（node 22.16 须 `--experimental-strip-types`，CI 已设） |
| E3 P0 销号 | 自动化守护 11 例全绿；TC-SEC-01/02 黑盒**实证完成**（证实暴露，见缺陷 D-0）；浏览器级 2 项未执行（环境） |
| E4 对抗抽查 | 36 请求 **0×5xx、0 崩溃**；**R-1 实证升级**（恶意 Origin/伪造 Host 可建/删/读）；新缺陷 1 条（P3） |
| G 判定 | G1 ✅ · G2 ✅（带 R-1 实证注记）· G3 ⛔ 未解冻（需 REF 冻结/perf 转正）· G4 部分（见 §5） |

## 1. E1 常规链全量

`pnpm verify`（lint → typecheck → test 全 workspace）exit 0。分包抽样：daemon 17 文件/147 例（4.8s）· web 184 文件/1697 例 · ingest 52 文件/579 例 · cli 9 文件/45 例 · engine（verify:engine 口径）27 文件/386 例 + 序列化快照哈希一致。

## 2. E2 门禁矩阵（逐项实跑记码）

| 门禁 | exit | 判定 | 说明 |
|---|---|---|---|
| guard:tokens / guard:vocab / guard:electron-baseline | 0/0/0 | ✅ | tokens：0 违规（R1–R5）；五项基线静态判定通过 |
| verify:engine | 0 | ✅ | 386 例 + 序列化哈希独立复核一致 |
| verify:mcp-stub | 0 | ✅ | 16 步全过（须 CI 口径 NODE_OPTIONS，见运行口径注记） |
| verify-ai-two-state / verify-image-two-state | 2 / 2 | ✅ 预期阻塞 | 数据面 13/8 步 0 失败；UI 段因无 Chromium 阻塞——tp1-05 阻塞语义断言（证据 JSON stepsFailed=0）成立 |
| verify:figma-baseline / verify:motion / verify:perf | 2/2/2 | ✅ 预期阻塞 | 参照集未冻结 / 断言未实现 / 基线 provisional——禁假绿口径如实 |
| guard:deps / guard:mcp-contract / guard:channel-pairing | 2/2/2 | ✅ 预期阻塞 | 未实现（后续票），未当绿 |
| **guard:feature-boundaries** | **1** | **⛔ 违规（继承）** | `apps/web/src/app/market/panel/page.test.tsx:13-14` 跨 feature 深导入（`__fixtures__`/`feedback`）——**战役 A 遗留，非本批引入**（本批 diff 未触碰该文件）。修法：改经公开面 `@/features/market` 或登记例外 |
| verify:canvas | 1 | ⚠️ 环境中断 | Chromium 无法启动（缺 libnspr4）；非产品缺陷 |
| e2e:smoke / verify-shell-parity | 未执行 | 如实登记 | 同因（浏览器库）／Electron 二进制未装 |

**运行口径注记**：node 22.16 直跑 `.ts`（daemon harness/夹具）必须 `NODE_OPTIONS=--experimental-strip-types`——CI 三步已设；绕开该口径直跑会把「阻塞」错分为「违规」（本次 E2 初跑实测，已复核纠正）。

## 3. E3 P0 用例销号表（对照《测试设计》三章）

| 用例 | 方式 | 结果 |
|---|---|---|
| TC-AI-03 流式 CORS | 自动化（routes/ai.test.ts 3 例）+ 红验尸 | ✅ 绿；浏览器④⑤未执行（环境） |
| TC-AI-04 时序诚实 | 自动化（stream.test 2 例 + engine-boundary 2 例） | ✅ 绿 |
| TC-UIX-07 面板键位/挂载 | 自动化（3 文件 9 断言含块注释加固） | ✅ 绿；速查卡视口=浏览器复核待办 |
| TC-DOC-05 崩溃注入 | 自动化（SIGKILL×10 轮，tmpRemnants=0） | ✅ 绿 |
| TC-DOC-06 提交顺序故障 | 自动化（vi.mock fs-atomic） | ✅ 绿 |
| TC-DOC-07/10 跨进程并发 | 自动化（40 并发仅 200/409、双进程同名恰 1×201） | ✅ 绿 |
| TC-AI-02 SSE 分档 | 自动化（半行/断流/EOF 3 例） | ✅ 绿 |
| TC-EXP-06 导出路径安全 | 自动化（3 例） | ✅ 绿 |
| TC-SEC-01/02 本地特权面确认 | **E4 黑盒实证** | ⚠️ **暴露证实**（见 D-0）——「确认缺陷」型用例的预期结果即现状实证 |
| TC-SEC-04/05/06 凭据/掩码/路径 | 既有 security 测试 + E4 语料（路径全 400 树外零副作用） | ✅ 绿 |
| TC-DR-02 备份恢复演练 / TC-DR-03 磁盘满 | 未执行 | 登记后续（非本批票面） |
| TC-IMG-03 / TC-LS-01/02 / TC-UIX-03 守护 | 未列本批票面 | 登记（US11/12 与出图守护=spec 尾巴后续票） |

## 4. E4 对抗性抽查（36 请求）

- **fuzz 30 条**：状态码分布 `{400×24, 404×2, 431×1, 200×5, 201×3, ERR×1}`，**5xx=0**、连接级崩溃=0、终检 `/health` 200——畸形输入面（名称/深度/超大/伪造 id/导出越界/坏配置）全部 4xx 化，路径安全实测树外零副作用。
- **特权面五连证（TC-SEC-01/02/03）**：`Origin: http://evil.example` POST→**201**、DELETE→**200**；`Origin: null`→201（壳契约）；伪造 `Host: evil.example` GET→**200 返回文档清单**、DELETE→**200**。**R-1 由「代码推定」升级为「黑盒实证」**：本机任意网页经 DNS-rebinding/无预检请求可读、建、删用户全部文档。
- **新缺陷 D-1（P3）**：`POST /telemetry/events` payload 为数组 → **ECONNRESET**（连接被重置）而非 4xx `telemetry_invalid_event`；daemon 存活、后续请求正常。修法：telemetry 校验先于落盘路径抛信封错误。

### 缺陷清单

| # | 级 | 描述 | 去向 |
|---|---|---|---|
| D-0 | P0（既有登记 R-1 的实证） | 本地特权面无 Host 校验/白名单外照常执行——已黑盒实证可越源读写删 | guard:channel-pairing / Host allowlist 快赢票（建议下一步） |
| F-1 | P2（继承战役 A） | feature-boundaries 违规（见 E2） | 后续票：改公开面导入或登记例外 |
| D-1 | P3（本轮新发现） | telemetry 数组 payload → ECONNRESET | 后续票（一行校验顺位） |
| F-2 | P3 | 运行口径陷阱：node 22.16 无 strip-types 直跑 .ts 全挂 | 已由 tp1-05 CI 口径消解；登记文档即可 |

## 5. 通过标准判定（G1–G4）

- **G1 每票合并 ✅**：五票证据链齐（`~/df-evidence/tp1-01…05` 含红验尸）、合并后双包门禁绿、code-review 收口（6 修+3 登记）。
- **G2 P0 收口 ✅**：三断点守护全绿（附红验尸）；TC-SEC-01/02 以实证形态关闭（暴露证实→D-0 行动项）。
- **G3 视觉/性能解冻 ⛔**：依赖 REF-01 冻结与 perf 基线校准（阶段 2/3，未在本轮范围）。
- **G4 全量验收 ◐**：E1–E4 无阻断；遗留=D-0 处置、F-1、浏览器级复核（需装 Chromium 系统库）。

## 6. 残余风险复核（对照《测试设计》§10.2）

R-1 **升级**（实证，建议 Host allowlist 快赢）· R-2/R-3（localStorage 快照/无自动保存）不变 · R-4（双窗口覆盖）不变 · R-5 导出简化不变 · R-6 迁移缺失不变 · R-7 内存态不变 · **R-8 部分收敛**（AI/面板/daemon 面守护已常态化；视觉/性能仍零拦截）· R-9 不变 · R-10 不变 · R-11 不变。

## 7. 建议下一步（按价值排序）

1. **Host allowlist 快赢**（D-0）：daemon 对非本机 Host 直接 403——一行中间件，直接封 DNS-rebinding 面；
2. 装 Chromium 系统库（`libnspr4` 等）→ 解锁 e2e:smoke/verify:canvas/两态 UI 段与浏览器级复核项；
3. F-1 修复 + US11/12、TC-DOC-03 四档深度、409 确定性注入档守护补票；
4. 战役 B（`integration/test-remediation-v2`）处置决策（仍原封未动）；
5. 阶段 2：REF-01 视觉参照集冻结 → pixelmatch 门禁接 CI。

## 8. 收尾状态

集成工作树 `/home/QIU/df-wt/tp1-integration`（tip `c8c9894`）保留待合并决策；五个票工作树已清除（分支 `test-p1/*` 保留存档）；无残留进程/端口；全部证据仓外。**未 push、未合并 main**——CI 步骤的人审（Medium 定级）与推送由仓库所有者执行。

---

## v1.1 附记（2026-11-04 · 优化批 tp2-01/02/03）

v1 报告 §7 优化建议的第一、二档全部执行完毕；最终 tip `7938eae`（E1'' 全量 verify exit 0：contracts 13 / engine 27 / ui 18 / desktop 13 / comfy 1 / ingest 52 / web 184 / cli 9 / daemon 18 文件全绿）。

### 落地结果

| 优化项 | 结果 | 证据 |
|---|---|---|
| **D-0 Host allowlist（P0 封口）** | 新模块 daemon `src/host.ts`：onRequest 钩子 hostname 精确匹配回环三形态，未命中（含 HTTP/1.0 缺 Host）→ 403 `host_not_allowed`（contracts 新错误码）；`DF_ALLOWED_HOSTS`/`DFORGE_ALLOWED_HOSTS` 并集扩展。**E4 黑盒复核：伪造 Host GET/DELETE 由 200 → 403** | `~/df-evidence/tp2-01/`（红验尸×2 + 黑盒复核 11/11） |
| D-1 telemetry 守护 | 诚实重诊：基线已具形状校验先于写路径；E4 的 ECONNRESET 实为前一条 431 超长 URL 的连接级余波。本票补守护测试（数组/原始值/null → 400、events.jsonl 无半行） | `~/df-evidence/tp2-01/` |
| F-1 feature-boundaries | `page.test.tsx` 改经公开面（index 本就预留 `marketFixtures`/feedback 转发）；gate **exit 1→0**，覆盖不丢 | `~/df-evidence/tp2-02/f1-guard-*.txt` |
| US11/12 守护 | versions-store 配额（QuotaExceededError→onWriteError 原始 error、无半条）+ 隐私两档显式用例（web 1697→**1700**）；US12 既有 versions-rollback 覆盖确认登记「回归保持」 | `~/df-evidence/tp2-02/` |
| CI 判码去重 | ci.yml **249→203 行**：AI/出图两步 ~30 行内联判码缩至 5 行，共享 `scripts/lib/two-state-verdict.mjs`（16 单测 TDD + 变异红验尸 + bash -e 三态重放 6/6；判定语义与原两段逐条等价，实况口径未变） | `~/df-evidence/tp2-03/` |

### isolate 完整记录（采纳 → 实证 → 回滚）

1. 实验：web `--isolate=false` 两轮 1700 全绿（12.4s→6.6s/6.2s，省 ~47%），对照排除缓存效应 → 采纳（`b20e493`，两轮复验绿）。
2. **E1' 全 workspace 链复验：6 failed/3 文件**（editor-bootstrap 2、market register 1、panel 3——AiDrawerSlot/MarketPanelBody 渲染抛错）= worker 复用跨文件状态泄漏型 flake，调度相关、独立轮不可见。
3. 按采纳时「任何一红即回滚」规则回滚（`7938eae`），回滚后两轮 1700 绿、E1'' exit 0。
4. **泄漏点清单（后续根治票施工图）**：①`editor-bootstrap.test.tsx` 无自身 afterEach 重置且为唯一真发请求的失败文件（AiDrawerSlot→useAiRun 探活）；②`market/register.test.tsx` 主题 dark 与 FEEDBACK_KEY 从不还原、afterEach 不重置命令注册表；③`ComponentPanel.test.tsx` beforeEach 主题不还原；④`entries.test.tsx` afterEach 漏 `useEditorUi`；⑤`@dforge/ui` Drawer `rememberKey` 默认读写 localStorage（跨文件残留源）。结构修法方向：全局 afterEach 兜底（主题/localStorage/注册表三件套）后再评估 isolate。

### 缺陷台账更新

D-0 **关闭**（R-1 在 Host 层缓解；无鉴权 token、`Origin:null` 放行、白名单外照常执行仍是登记取舍）· F-1 **关闭** · D-1 **关闭**（守护化；socket 层 ECONNRESET 表现差异登记不阻塞）· **F-3 新登记（P3）**：web 测试卫生泄漏五点（见上）——isolate 优化的前置条件。

### 仍 blocked-on-user

1. Chromium 系统库：`sudo apt-get install -y libnspr4 libnss3 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libgbm1`（解锁 e2e:smoke / verify:canvas / 两态 UI 段 / TC-AI-03④⑤ 浏览器复核）；
2. REF-01 视觉参照集冻结（需 Figma 本体截图素材，代理不可生成）；
3. push + CI 人审 + 合并 main（集成 tip `7938eae`）；
4. 战役 B（`integration/test-remediation-v2`，140 提交）处置决策。

---

## v1.2 附记（2026-11-04 · 补齐批 tp2-04/05）

验证器裁定 v1.1 的两处缺口（409 注入档未派票、isolate 净效果为零）已在同一目标周期内补齐。最终 tip `87c006f`。

| 补齐项 | 结果 | 证据 |
|---|---|---|
| **tp2-04 409 确定性注入档** | 新增 `store.conflict-injection.test.ts`（146 行）：注入缝=fs-atomic `writeFileAtomic` 对 manifest 路径透明吞写（等效「重读恒旧」，rival 恒胜出）；断言 conflict 信封（code/message 含「重试 3 次」/details.documentId/contracts→409）+ 吞写恰 3 次 + manifest 字节逐位未破坏 + 页元数据停在 v1 提交值 + 冲突后可恢复。**红验尸**：解除注入→全 200 无 conflict→断言红→恢复→绿 | `~/df-evidence/tp2-04/` |
| **tp2-05 测试卫生根治 + isolate 真正落地** | 7 文件：全局 `test-setup.ts` 三件套 afterEach 兜底（data-theme 快照还原 / localStorage 清空 / 命令与插槽注册表复位）+ 五泄漏点逐点；**额外根治第二机制**——isolate:false 下按文件注册的 `vi.mock('next/navigation')` 在真实模块被同 worker 前序文件缓存后失效（vitest #11152 同族），以 `vi.resetModules()` 每文件重建模块图根治（探针 10/10）。`vitest.config.ts` 复设 `isolate:false` | `~/df-evidence/tp2-05/` |
| 性能 | web 套件 12.83s → **6.1–6.7s** 独立 / 7.1s 全链内（~45–50%），与原实验口径一致 | 同上 |

### 判定性验收（上次翻车现场重演通过）

- 票内自验：web 独立 12 轮绿（isolate:false 探针 10/10）+ **全 workspace verify 3 轮 exit 0**。
- 合并后复验（独立合并器）：**R1=0、R2=0** 两轮全链，9 包计数逐轮一致——contracts 81 / engine 386 / ui 265 / desktop 122 / comfy 1 / web 1700 / ingest 579 / cli 45 / daemon **161**（合计 3340，无 skip）。
- 附加：`guard:feature-boundaries`=0（仅登记例外）、`test:scripts` 109/109。

### 缺口状态

v1.1 登记的 **F-3（测试卫生泄漏五点）关闭**；`isolate=false` 从「回滚」转为「已落地且有 5 轮全链绿背书」。D-0 / F-1 / D-1 / 409 注入档全部关闭。

### 仍 blocked-on-user（更新）

1. ~~Chromium 系统库~~：用户已确认将亲自执行 sudo 安装命令（装完即需补跑 e2e:smoke / verify:canvas / 两态 UI 段 / TC-AI-03④⑤ 浏览器复核）；
2. REF-01 视觉参照集冻结：**用户裁定跳过，维持登记**（视觉对照门禁继续 exit 2 阻塞，R-8 视觉半边零拦截为已知状态）；
3. push + CI 人审 + 合并 main（集成 tip 现为 `87c006f`）；
4. 战役 B（140 提交）处置决策。

---

## v1.3 附记（2026-11-04 · 架构优化批 arch-01…05 + code-review 四轮修复）

架构审查（4 个 deepening 候选 + 1 个新发现缺陷）全部落地，并经四轴 code-review 收敛。最终 tip `a255299`（见 `docs/quality/architecture-review-report-2026-11-04.md`）。

### 深化结果

| module | 结果 | 量化 |
|---|---|---|
| **页集映射** `page-set.ts` | `page.id` 即身份（位置不再参与寻址）；`loadPageSet` 按 manifest 页表读、`planPageSetSave` 产出 create/update/**孤儿只报告** | 洞页集 `[page-1,page-3]` 完整往返（原先截断）；三次保存恒 `[page-1,page-2]` |
| **数值编辑** `@dforge/ui` | 草稿/去抖/提交括约/Esc/键盘步进全藏 implementation；样式随包分发 | 删零消费旧件 3 个 + app 本地件；语义测试 3 份→1 份；ui 265→**283** |
| **字段描述表** `EFFECT_FIELDS` | equality/缓存键派生 + 编译期兜底 | 删 4 处手写枚举；删字段→**TS1360/TS2741**；`verify:engine` 快照哈希不变 |
| **取证机** `figma-evidence.mjs` | 7 门禁退化为单元表；daemon 来源统一（显式 env 或自起夹具，禁连 4314/4318） | 7 门禁 3495→**2322 行（−1173）**；诱饵实证改后 **0 命中** |

### code-review 四轴结果（13 修 / 5 登记，零阻塞）

- **Behaviour**：页集无限增长、证据缺 `status`、`ref` 路径退化 → 全修（各带红验尸）
- **Standards**：**样式未随 module 迁移**（DS 件离开 inspector 裸渲染）、状态族登记与实现不符（**假覆盖**）、临时根裸 `rm` 吞错 → 全修
- **Security**：`createPage` 在大小写不敏感 FS 上（Windows/macOS，即 Electron 目标平台）`PAGE-1` 可**清空既有页正文** → 归一占用集 + 写前 `lstat`，绝不覆盖
- **Spec**：保存计划内 **preferred id 撞号**导致整次保存失败 → 冲突消解 + 计划后置断言；导出按陈旧 `page.id` 取页 → `pageIdOf` 解析

### 判定性验收

- 票内逐票自验 + 四轮修复各自全量 verify 绿；
- **终验 FINAL R1=0 / R2=0**，两轮计数逐包一致：contracts 84 / engine 396 / ui 283 / desktop 122 / comfy 1 / web 1695 / ingest 579 / cli 45 / daemon 167 = **3372 例**；
- `guard:tokens` 0 · `guard:feature-boundaries` 0 · `verify:engine` 0（快照哈希一致）· `test:scripts` **126**。

### 新增残余项（报告 §10.2 续）

| # | 风险 | 级 | 去向 |
|---|---|---|---|
| R-12 | 7 个截图门禁**浏览器侧**未显式传 `?daemon=`——前端单点会回退端口窗探测（4318 起）；当前全恒 exit 2 故不触发 | P2 | REF-01 冻结**前**必须修（否则取证可能连真实例） |
| R-13 | `guard:vocab` 缺「页 id 约定同源」判据（约定已单源，判据缺席） | P3 | 后续小票 |
| R-14 | `effectPatch` 与渲染变体仍未由 `EFFECT_FIELDS` 派生（第二张字段表） | P3 | 后续收敛 |
| R-15 | `image`/`canvas` 的 daemon spawn 缺 `--experimental-strip-types`（既有缺陷） | P2 | 后续票（会使两门禁在 node 22.16 取证失败） |
| R-16 | 5 条代理默认英文 `Merge branch …` 提交保留（不改写历史） | P3 | 过程项：后续代理合并一律 `-m` 中文 |

### 仍 blocked-on-user（不变）

Chromium 系统库（用户已确认亲跑 sudo）· REF-01 素材（用户裁定跳过，维持登记）· push + 人审（架构批为 Medium，daemon 新 API 面需 1 人审）· 战役 B 处置。
