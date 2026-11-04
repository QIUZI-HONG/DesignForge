# 架构优化批 —— code-review 报告（2026-11-04）

- 固定点：`87c006f`（架构优化批基线）→ 终态 tip 见文末（四票 + arch-05 + 4 轮修复）
- 定级：**Medium**（改动含 daemon 新 API 面、`packages/ui` 公开面、7 个门禁脚本；CI 未接新门禁）
- 深度：**Standard**（四轴猎手并行 + 独立安全 pass + 四轮修复收敛）
- Spec 源：`~/df-charting/briefs/arch-optimization-batch.md`（四票）/ `/tmp/architecture-review-20261104-220914.html`（候选论证）/ `docs/adr/0004-…md`（边界与债）
- 证据：`~/df-evidence/arch-0{1..5}/`、`~/df-evidence/arch-fix{,2,3,4}/`

## 一、交付（深化结果）

| 票 | module | interface（一句话） | 量化 |
|---|---|---|---|
| arch-01 | 页集映射 `page-set.ts` | `loadPageSet` 按 manifest `pages[]` 读回 `{page,pageId}[]`；`planPageSetSave` 产出 `{create,update,orphanPageIds}`（孤儿只报告） | web +测试；daemon `createPage({id})`、`DocumentDetail.pages` |
| arch-02 | 数值编辑 `@dforge/ui` NumberField | `value/onCommit` + 范围/步长/精度/后缀 + 混合占位 + 可选 scrub 括约；草稿/去抖/提交/Esc/键盘步进全藏 implementation | 删 DS 三件零消费实现 + app 本地件；语义测试从 3 份收口到 1 份 |
| arch-03 | `EFFECT_FIELDS` 字段描述表 | 每字段 `cacheKey`/`compare`/`editable`；`effectCacheKey` / `sameEffect` 派生 | 删 4 处手写字段枚举；`satisfies Record<keyof Effect,…>` 编译期兜底（TS1360/TS2741 双验） |
| arch-04 | figma 取证机 `figma-evidence.mjs` | `runFigmaGate({gateName,page,units,referenceDir,thresholds,prepare}) → {code,evidence}` | 7 门禁 3495→**2322 行（−1173）**；三态/证据 7/7 归档点一致 |
| arch-05 | 门禁 daemon 来源 `daemon-fixture.mjs` | 显式 `DF_DAEMON_URL` 优先，否则自起夹具（临时根+空闲端口），起不来 **exit 2**；禁缺省连 4318 | **诱饵实证**：改前收到 `GET /health`、2×`/market/query`、1 TCP connect → 改后 0 命中 |

## 二、四轴猎手发现与处置

### Behaviour 轴（3 项，全部已修）

| # | 级 | 发现 | 修复 |
|---|---|---|---|
| B1 | **Important** | 导入含非法页 id 的文档后**连续保存页集无限增长**（`[page-1]→[page-1,page-2]→[page-1,page-2,page-3]`，`pageIds` 被 bridge 丢弃） | `WeakMap` 会话稳定映射 + 孤儿升序复用 → 三次保存恒 `[page-1,page-2]`、`orphanPageIds=[]`（`3437db6`） |
| B2 | **Important** | `missing-reference`/`size-mismatch` 分支漏写 `record.status` → 证据无法区分「待跑」与「参照缺失」 | 两分支补 status + 表驱动断言（`9a6fd70`） |
| B3 | Nit | `ref` 由绝对路径退化为文件名 | 恢复 `join(referenceDir, unit.ref)` + `isAbsolute` 断言（`2f529a5`） |

诚实登记：B1 的红验尸发现「仅移除稳定映射」时页数仍恒定（孤儿复用已足够），故以「同时移除两件」证明回归可捕获原缺陷，另以重排用例作稳定映射的红验尸。

### Standards 轴（5 项，全部已修/已登记）

| # | 级 | 发现 | 修复 |
|---|---|---|---|
| S1 | **Important** | NumberField 样式仍在 `apps/web/inspector.css`——**module 迁了、样式没迁**，DS 件离开 inspector 即裸渲染 | 12 条规则原样迁入 `packages/ui/src/components.css`；迁移前后机器对比唯一差异=原 `.dfi-hint` 声明并入；`guard:tokens` 0、`style-single-track` 绿（`5638241`） |
| S2 | **Important** | F17 登记 `loading/error` 但组件无此态；F18 删 TypographyField 后仍名「色板与文字族」→ 测试只查并集 = **假覆盖** | F17 改 `hover/active/disabled` + 注释理由；F18 更名色板族；测试改**逐态触发契约**，契约键必须与登记态完全一致（5→8 条）（`0a936ba`） |
| S3 | **Important** | `daemon-fixture.mjs` 裸 `rm` + 吞错 → ENOTEMPTY 静默残留 | `TEMP_ROOT_RM_OPTIONS`（maxRetries 5 / retryDelay 50）+ `removeTempRoot` 记录路径与原因，不吞错；清理失败不翻红（`37fc198`） |
| S4 | Nit | GLOSSARY「patch 形状/测试变体全派生」夸大 | 收窄为「等值与缓存键派生」，明确 `effectPatch`/渲染变体仍手写（`0ae601d`） |
| S5 | Nit | 4 条代理默认 `Merge branch …` 英文提交 | **不重写历史**（改写已合入的 merge 提交风险大于收益）；登记为过程项：后续代理合并一律 `-m` 中文 |

### Security 轴（1 项 defense-in-depth，已修；3 hygiene 登记）

| # | 级 | 发现 | 处置 |
|---|---|---|---|
| X1 | **Important（defense-in-depth）** | `createPage` 占用判定只比 manifest 字符串、随后的 `writeFileAtomic('{}\n')` 无条件写：**Windows/macOS 大小写不敏感 FS** 上 `PAGE-1` 与 `page-1` 同文件 → 绕过 409 **清空既有页正文**（=跨页覆盖）；盘上残留页文件同样被清空 | 归一占用集（manifest ∪ 目录文件名，toLowerCase）+ 写前 `lstat` 存在即 409，绝不覆盖；4 档测试（含逐字节未变取证）`32ac993`；daemon 163→167 |
| X2 | hygiene | `DF_DAEMON_URL` 不校验 scheme 即交 fetch（仅操作者 env 的本地工具） | 登记不阻塞 |
| X3 | hygiene | 证据 JSON 含绝对路径/用户名（与旧门禁同口径，无 token/环境采集） | 登记不阻塞 |
| X4 | hygiene | detached 组 `kill(-pid)` 仅回收自身组；Windows 负 pid 抛错被 catch（泄漏非误杀） | 登记不阻塞 |

安全面清晰项：arch-01 新 API 白名单 + `resolvePagePath` + `resolveWithin` 三重校验完整、建页不收正文、`DocumentDetail.pages` 只 `id/name/updatedAt`（无新路径泄漏）；arch-04 无 eval/动态 import；arch-02/03 无 `dangerouslySetInnerHTML`、`EFFECT_FIELDS` 静态键无原型污染面；`scripts/` 无 pkill/`rm -rf` 越界。

### Spec 轴（1 项 Important + 2 Nit，全部已修）

| # | 级 | 发现 | 修复 |
|---|---|---|---|
| P1 | **Important** | 保存计划内**页 id 撞号**：preferred id 不参与冲突消解。反例 existing=`{page-1,page-2}`、文档=`[非法id, page-1, page-2, page-3]` → 两个 `create page-3` → 第二次 409 → **整次保存失败** | `planned/claimed` 归一占用集 + prefer 前冲突检查 + 改派 + 计划后置断言。修复后 `update [page-1,page-2] + create [page-4,page-3]`，两轮保存 ok、页文件恒 4；红验尸 4 红→19 绿（`0c526df`） |
| P2 | Nit | 保存结果未回写 → 导出按陈旧 `page.id` 请求不存在的页 | 导出 `pageIdOf(page)`（读会话 WeakMap，只读、不产生撤销条目）+ 订阅保存态触发重渲染；集成断言解析 id = 实际页文件名（`168f17a`） |
| P3 | Nit | `useDraftCommit` 进包公共导出，超出数值 module 的 interface | 按「可复用原语」保留（服务 NumberField / inspector 文本 / scrub `setDraftLive`），ADR-0004 ② 补记公开面理由；删 `inspector/model/draft.ts` 空 shim（`a255299`） |

禁止项逐条核查结论（Spec 猎手）：arch-01 未删页/清孤儿、落盘格式未动、`.dfg` 仅 additive；arch-02 只删全仓 0 命中的零引用类、`inspector.css` 未改、面板结构不变；arch-03 `paint.ts` 与序列化零改动、键格式钉死、快照哈希独立复算一致；arch-04 七门禁单元表/阈值**逐字节相同**、`verify-figma-baseline` 与 CI 零 diff；arch-05 `127.0.0.1:4318` 在 `scripts/` 仅剩注释与测试守卫。**无未登记 scope creep。**

## 三、文档同步

- ADR-0004 新增两条补记：债一清偿（页集映射，含范围订正）+ 债二清偿（取证机，含范围 5→7+1 订正）
- ADR 量化口径二次订正：`3495→2273` 标注为 arch-04 落地瞬间，终态 **2322（−1173）**；测试 109→**126**；「只剩单元表」改为「多数 + review/inspect 保留面级断言」；补登记**第三条语义变化**（inspect 证据新增 `daemon` 键）
- GLOSSARY 新增 `页集映射` / `字段描述表` / `取证机` / `孤儿页`；收窄 `字段描述表` 承诺边界

## 四、残余项（不阻塞，已登记）

1. **R-A**：7 个截图门禁的**浏览器侧**未显式传 `?daemon=`——前端单点会回退端口窗探测（4318 起）。当前全部门禁恒 `exit 2`（参照集未冻结）故不触发；REF-01 冻结前须修，否则取证可能连到真实例。
2. **R-B**：`guard:vocab` 缺「页 id 约定同源」判据（约定已单源，判据缺席）。
3. **R-C**：`effectPatch` 与渲染变体仍未由 `EFFECT_FIELDS` 派生（第二张字段表，Divergent Change 味道）。
4. **R-D**：`image`/`canvas` 的 daemon spawn 缺 `--experimental-strip-types`（既有缺陷，arch-05 只做端口显式化，未端到端重跑）。
5. **R-E**：S5 的英文 merge 提交保留（不改写历史）。

## 五、判定

**Area verdicts**：Behaviour 3/3 修 · Standards 3 Important 修 + 2 Nit 登记 · Security 1 Important 修 + 3 hygiene 登记 · Spec 1 Important 修 + 2 Nit 修
**Verdict**：**无阻塞发现**；四轴发现全部有去向（13 修 / 5 登记），每条 Important 均带红验尸证据。
**人审**：Medium 定级 + daemon 新 API 面 → 推送/合并 main 前需 **1 人审**；本轮合并为本地提交，未 push。
