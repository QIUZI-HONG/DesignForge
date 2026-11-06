# PR_BATCH_10 — D-13~D-17 卫生批：useDocumentSnapshot 单源化 + .gitignore .scratch + use-overlay 同步 + biome-ignore 复核登记（audit-d10）

- **分支**：`chore/hygiene-batch`（工作树 `/home/QIU/df-wt/audit-d10`）→ **已合并 main**（merge `75cee41`；6 提交链基 `7369f22`，先行并入 main tip `41dd978` 为分支侧合并 `becd370`，ort 策略**零冲突**；合并后 main 收官复验全表见下，全 exit 0）
- **依据**：`docs/audit/DEFECTS.md` D-13~D-17（P3 卫生批 · 全计划 10 批收官）· `docs/audit/OPTIMIZATION_PLAN.md` §4 批10
- **范围口径**：一个卫生项一提交；**D-14 为用户侧行动，本票严禁执行、只登记**（见下「用户侧行动清单」）

## 提交链（6 commits）

| 提交 | 缺陷 | 内容 |
|---|---|---|
| `e786c0e` | D-13 | useDocumentSnapshot 三份逐字节拷贝收敛为 `apps/web/src/lib/use-document-snapshot.ts` 单源 + 去重回归测试 |
| `ba998f3` | D-15 | `.gitignore` 补 `.scratch/` 本地草稿区（含语义边界注释） |
| `55ffb76` | D-16 | `packages/ui/src/utils/use-overlay.ts` 补 `'use client'` 与 use-draft-commit.ts 同步收敛 |
| `583dcbc` | D-17 | biome-ignore 10 条逐条复核登记表 `docs/audit/BIOME_IGNORE_REGISTRY.md` |
| `c85b17e` | — | 分支并入 main `7369f22`（批次9 依赖补丁，catalog/lockfile 与本票零冲突） |
| `1f98ab3` | D-13 | 去重回归测试过 lint 形式修正（去未用 import、引号合规，断言不变） |

## 变更说明（4 个卫生项）

### D-13 useDocumentSnapshot 三份逐字节拷贝 → lib 单源

- **修复前**（基点 `a9e9b86`，证据 `~/df-evidence/audit-d10/d13-before-after.log`）：inspector / inspect-export / editor-components 三处 `hooks/useDocumentSnapshot.ts` **md5 同值**（`12521645ec73acc5bc80d429456e64a6` ×3），逐字节相同拷贝。
- **修复后**：单源 `apps/web/src/lib/use-document-snapshot.ts`（CommandStack → React 订阅胶水，只依赖 engine 与 react）。依赖方向符合 ADR-0004：**features/\* → lib/\* 允许**（同 `daemon-endpoint.ts` 先例），lib/\* → features/\* 禁止；`guard:feature-boundaries` exit 0。5 个消费组件（InspectorPanel / AlignRow / CanvasSettings / ComponentPanel / InspectPanel）改经 `@/lib/use-document-snapshot` 导入。
- **防复活**：新增 `scripts/tests/dedup-use-document-snapshot.test.mjs` 三用例——① 全仓 `export function useDocumentSnapshot` 定义**恰好 1 处**且落 lib 路径；② feature 目录下不得复活同名钩子文件；③ 消费方导入必须落单源模块符（不得复活 `../hooks/useDocumentSnapshot` 形态）。

### D-15 `.gitignore` 补 `.scratch/`（语义边界如实记录）

- 新增规则 `.scratch/`（一次性草稿与临时脚本不再滞留 `git status`，审计实证 12 项未跟踪草稿）。
- **语义边界（如实记录，非缺陷）**：gitignore 只作用于未跟踪文件——`.scratch/` 下 **39 个历史已跟踪工单稿**（frontend-rework / ux-audit-remediation，含 `style-single-track-registry-v1.md` 引用为常驻真源出处）保持跟踪不变。因此**裸形态 `git check-ignore .scratch/` 在含跟踪文件的目录上恒 exit 1，属 git 语义**；规则生效判据为：
  - `git check-ignore --no-index .scratch/` = **0**（main 复验实测 0）；
  - 未跟踪路径探针 `git check-ignore --no-index .scratch/probe-untracked.txt` = **0**（main 复验实测 0）；
  - `git ls-files .scratch/` 计数不变（39），`git status` 无删除。
- **解跟踪属用户侧决策**（涉及出处引用迁移），本票不执行、只登记（见「用户侧行动清单」③）。证据 `~/df-evidence/audit-d10/d15-check-ignore.log`。

### D-16 use-overlay.ts 补 `'use client'`（审计半过时修正）

- **现状核实**：审计所称「use-draft-commit.ts 半截 `'use client'` 修复未提交」**已过时**——该指令已随 `9946d46`（audit-d01 门禁前置）提交入库；未同步的是**同目录 `use-overlay.ts`**（同为 React hook 模块，此前仅经 Modal/Drawer/Overlay 三个 `'use client'` 组件间接到达）。
- **修复**：`use-overlay.ts` 首行补 `'use client'` + 原因注释（与组件族口径一致）——未来被服务端组件直接引用时得清晰报错而非隐式栈错。不撤销 use-draft-commit.ts 方向（那是已记录的站点编译解锁前置）。

### D-17 biome-ignore 逐条复核登记（0 删 10 留）

- 全仓 `git grep -n "biome-ignore"`（排除 docs/.scratch 散文命中）：**真实抑制恰 10 条**，逐条读上下文复核「合规写法不存在或代价不成比例」后 **0 删 10 留**；每条原因已写在代码内（与登记表同源）。
- 登记表 `docs/audit/BIOME_IGNORE_REGISTRY.md`：10 条逐条列文件:行、规则、原因、**复核日期 2026-11-07**；表头声明纪律（新增条目 = 新抑制 = 走同一单人复核流程，禁用本表变相扩容）。
- 10 条构成：command-palette ×2（combobox 冒泡键位 / aria-activedescendant 漫游）、LayersPanel ×1（右键菜单设计工具惯例）、editor-shell registry ×1（noConfusingVoidType 口径本体）、HomeTopbar ×1（焦点观察包裹层）、CodeExportPanel ×1（可滚动区 tabIndex）、packages/ui Drawer/Modal/Tooltip ×3（浮层遮罩与禁用锚点包裹）、Tree ×1（tree 模式 role=group 固定结构）。
- **其他抑制族核查**：`@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` / `eslint-disable` 全仓 **0 条**（证据 `~/df-evidence/audit-d10/d17-biome-ignore-inventory.log`）。

## 测试结果（证据 `~/df-evidence/audit-d10/`）

### 分支交付（实施代理基于 `7369f22` 验证 8/8 门禁绿 + 本代理并入 `41dd978` 后重跑）

| 验收 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（并入 41dd978 后） | **exit 0**（Already up to date，lockfile 未变） |
| `pnpm verify`（并入 41dd978 后重跑） | **exit 0**（3513 例：contracts 89/engine 396/ui 283/desktop 125/comfy 1/web 1736/ingest 586/cli 85/daemon 212） |
| `pnpm test:scripts`（并入 41dd978 后重跑） | **exit 0**（142 例 0 失败） |
| `guard:vocab` / `guard:feature-boundaries`（并入 41dd978 后重跑） | **exit 0 × 2** |
| D-13 去重回归 `node --test scripts/tests/dedup-use-document-snapshot.test.mjs` | **exit 0**（3 例 0 失败） |
| 实施代理原验证（基于 7369f22） | `d10-gates.log` + `d10-verify-full.log`：verify/guards/D-13/D-15 探针全绿 |

### main 收官复验（合并 `75cee41` 后，逐条真实退出码）

| 验收 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | **exit 0**（Already up to date） |
| `pnpm verify` | **exit 0**（3513 例：contracts 89/engine 396/ui 283/desktop 125/comfy 1/web 1736/ingest 586/cli 85/daemon 212） |
| `pnpm test:scripts` | **exit 0**（142 例 0 失败） |
| `NODE_OPTIONS=--experimental-strip-types pnpm verify:mcp-stub` | **exit 0**（16 步 0 失败） |
| `pnpm e2e:smoke`（next build + start · OS 分配空闲端口 web 37201 / 网关 35977，远离 3000/4318 族 · 仓外数据根 `~/df-evidence/fe-02/e2e/2026-11-06T17-18-26/`） | **exit 0**（63 步 ✓ 0 失败：canvas 10 / editor 17 / home 8 / nav 21 / 编辑器门禁 7） |
| `pnpm audit` / `--prod` / `--dev` | **exit 0 × 3**（三口径 "No known vulnerabilities found"，保持全 0） |
| `guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` | **exit 0 × 4** |
| D-13 断言 `git grep -c "export function useDocumentSnapshot" -- apps/web/src` | **恰 1 处**（`apps/web/src/lib/use-document-snapshot.ts:1`） |
| D-15 探针 `git check-ignore --no-index .scratch/`（+ 未跟踪探针） | **exit 0 × 2** |

## 用户侧行动清单（本票严禁执行、只登记）

1. **轮换 `apps/web/.env.local` 的 VERCEL_OIDC_TOKEN**（D-14）：未被跟踪、已被忽略，**无入库风险**；长驻本机建议轮换。
2. **清理真实 daemon（4318）内 3 个 `ux-audit-*` 旧文档**（D-17 后半）：2026-10-30 审计残留（contamination-4318.txt 实证）；本票不碰真实 daemon 与 `~/.dforge`。
3. **（可选）`.scratch/` 39 个历史工单稿解跟踪决策**（D-15 后半）：`git rm --cached` 属破坏性变更且 `style-single-track-registry-v1.md` 引用其为出处，需迁移引用后另行决策。

## 合并卫生

- 分支侧先把 main tip `41dd978`（批9 docs + 批6 contracts/daemon/web）并入（`becd370`，ort **零冲突**——与批6 的 web 夹具改动**无同文件交集**，逐文件核对 `comm -12` 为空）；并入后全量门禁**重跑**（冲突解决后的代码必须过门禁）。
- main 侧 `git merge --no-ff chore/hygiene-batch`（`75cee41`），结果 diff 与分支链逐字节一致（12 文件 +114/-43：删 2 份拷贝、1 份 rename 为 lib 单源、.gitignore +4、BIOME_IGNORE_REGISTRY 新建、use-overlay +5、去重测试新建 72 行）。
- 合并后按「先装后验」顺序复验；docs 提交只 add 本文件（未 `git add -A`）。

## 遗留

- **lint 4 条既有 warning**（main 同款，非本票引入；`pnpm lint` 退出码 0 不受阻）：tools/cli `dwd-map.test.ts:229/:232`（noNonNullAssertion ×2）、apps/daemon `body-limit.test.ts:20`（noUnusedImports，FIXABLE）、scripts `e2e/scenarios/nav.mjs:133`（useOptionalChain，FIXABLE）。实施代理 `d10-verify-full.log` 同款，留后续卫生票顺手收口。
- **浏览器门禁挂点状态不变**：`verify:figma-*` / `verify:canvas` / `verify:command-palette` / `verify:layers-reorder` / `verify:ruler-guides` / `verify:text-inline-edit` 及 `verify:ai/image-two-state` 的 UI 挂载段仍为挂点（随浏览器门禁票接入）；`e2e:smoke` 本票复验 exit 0（63 步全过）。
- D-14 / D-17 后半 / D-15 解跟踪三项为用户侧行动（见上清单），本票只登记不执行。

## 风险 / 回滚

- **回滚**：`git revert -m 1 75cee41`（合并提交整体回退；`.scratch/` 39 个历史跟踪文件不受 gitignore 影响，回滚无数据面风险）。
- 本批全部为卫生级改动（单源化 / gitignore / 指令补齐 / 文档登记），无行为面变更——`use-overlay.ts` 加 `'use client'` 只影响服务端直引时的报错清晰度，运行时路径不变。
- 证据目录 `~/df-evidence/audit-d10/`（实施代理 5 份 + 本代理合并/复验 17 份日志）。
