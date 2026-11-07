# 基线盘点（BASELINE）— 2026-11-05

- 审计对象：`QIUZI-HONG/DesignForge`（设界 · 本地优先设计工作台）主工作树 `/home/QIU/OpenDesign` @ `main 67f633e`
- 审计方式：三子代理并行只读扫描（结构依赖 / 门禁实跑 / 代码质量），全程未修改任何跟踪文件（开工/收尾 `git status --porcelain` 零差异）
- 证据根：`~/df-evidence/audit-2026-11/`（gate-logs/ · gate-evidence/ · baseline/ · quality/），仓库内只存本报告

## 0. 结论摘要

- **门禁全绿**：`pnpm verify`（lint + typecheck + test 3372/3372）+ `test:scripts` 128/128 + 4 守卫 + `verify:engine` + `verify:mcp-stub` 全部退出码 0；9 个 exit-2 门禁全部落在 AGENTS.md 声明的预期阻塞位，**无假绿、无真违规**。
- **SAST 面干净**：0 eval/命令注入/XSS/`:any`/TODO/弱哈希/硬 skip；令牌纪律、engine 零 DOM、依赖方向全部达标。
- **主要风险不在代码而在四类**：①daemon 本地特权面（无鉴权，已知取舍）；②浏览器门禁被 WSL2 缺 Chromium 系统库**单一根因**整体卡死；③全仓无覆盖率度量；④零星 i18n 落差文案与保存链路无超时。
- **无 P0**（静态面）；运行时/E2E 阶段待复核 H1（daemon 特权面）与 SSE 断点族。

## 1. 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | Next.js + React + zustand | 16.4.1 / 18.3.1 / 5.0.15 |
| 编辑器内核 | 纯 TS 零 DOM（canvaskit-wasm） | 0.42.0 |
| 本地服务 | Fastify | 5.12.7 |
| 桌面壳 | Electron | 44.7.2（二进制本机未拉取） |
| 测试 | vitest（9 包）+ node:test（scripts） | 5.0.5 |
| 门禁驱动 | playwright-core（chromium-1243 锁定） | 1.63.0 |
| 工具链 | Node ≥22（本机解析为 ZCode 自带 v22.16.0，系统 PATH 无 node）· pnpm 10.33.2 · biome 2.5.15 · TS ~5.9.3 |

## 2. 工作区结构与模块图（10 包 + 根）

| 包 | 职责 | src 规模 | 测试/源码比 |
|---|---|---|---|
| apps/daemon | 本地服务（前端数据面子集） | 56 文件 / 11,836 行 | 0.97 |
| apps/web | Next.js 前端（zh-CN 唯一暴露） | 486 / 68,704 | 0.78 |
| apps/desktop | Electron 最小壳 | 24 / 2,390 | 1.00 |
| packages/contracts | 共享类型契约（IR/market/事件） | 29 / 3,221 | **0.41** |
| packages/engine | 编辑器内核（纯 TS 零 DOM） | 79 / 16,664 | 0.88 |
| packages/ui | 设计系统（双基准令牌） | 56 / 9,908 | 0.99 |
| services/comfy | ComfyUI 适配（**纯占位 19 行**） | 2 / 19 | — |
| services/ingest | 市场采集管线（采集→四层→评分→索引） | 120 / 24,811 | **0.65** |
| tools/cli | `df` CLI | 25 / 3,855 | **0.58** |
| scripts/ | 门禁/取证脚本（39 个 .mjs，21,569 行） | — | node:test 128 例 |

依赖方向全部合法（apps/services/tools → packages；`grep` 反向引用零真实 import 违规）：
`contracts`（叶）← `engine`（叶）← `ui`（叶，peer react）；`contracts` ← `ingest` ← `{daemon, cli}`；`contracts/engine/ui` ← `web`；`desktop` 无内部依赖。

## 3. 依赖健康

- **lockfile**：`pnpm-lock.yaml` 已提交，`pnpm install --frozen-lockfile` no-op（452ms）。
- **漏洞（pnpm audit，网络可达，真实数据）**：
  - 生产面：4 moderate + 4 low，全部为 `fast-uri`（fastify 传递依赖，修复线 ≥3.1.9/≥4.2.3），**0 high / 0 critical**。
  - 全量（含 dev）：另增 **1 high：electron <44.9.1**（GHSA-jr5w-w6x2-84p9，修复线 ≥44.9.1）。
- **过时**：18 项直接依赖落后补丁/次版本（next 16.4.1→16.4.5、vitest 5.0.5→5.1.0、electron 44→45 等）。
- **License**：运行时直接依赖全部 MIT / BSD-3-Clause / OFL-1.1，**零 copyleft/UNKNOWN 风险**。

## 4. CI/CD 与门禁实跑矩阵（2026-11-05 实测）

CI：`.github/workflows/ci.yml`（push/PR → main；frozen-lockfile → lint → typecheck → test → 非浏览器门禁）。三态退出码语义：0=通过、1=真违规、2=阻塞（非通过）。

| 门禁 | 退出码 | 判定 | 耗时 |
|---|---|---|---|
| lint / typecheck | 0 / 0 | 通过（lint 3 条非阻断 info） | 2s / 10s |
| test（9 包 vitest） | 0 | **3372/3372 通过** | 22s |
| test:scripts（node:test） | 0 | 128/128 通过 | 6s |
| guard:tokens / vocab / feature-boundaries / electron-baseline | 0×4 | 通过（0 违规） | <1s×4 |
| verify:engine | 0 | 通过（396 例，快照哈希 e70550c34d74…） | 1s |
| verify:mcp-stub | 0 | 通过（16 项/0 失败，must-green） | 1s |
| ai / image 两态 | 2×2 | **阻塞-预期**：数据面 13+8 项 0 失败，UI 段阻塞（Chromium 缺系统库） | 3s / 2s |
| verify:figma-baseline / motion / perf | 2×3 | 阻塞-预期（参照集未冻结 / 断言未实现 / 基线 provisional） | <1s×3 |
| guard:deps / mcp-contract / channel-pairing | 2×3 | 阻塞-预期（未实现声明，禁当绿） | <1s×3 |

## 5. 静态质量画像（SAST-lite + 规范对表）

干净项：`eval`/`new Function`=0；命令注入面=0（child_process 仅 `spawnSync('gh',…)` 固定参数）；`dangerouslySetInnerHTML`=1 处（模块常量，已论证非注入面）；`:any`=0；TODO/FIXME/HACK=0；md5/sha1=0；硬 skip=0（仅 3 处平台条件 skipIf）；裸色值=0；engine 零 DOM=0 违规；跨 feature 深导入=0。

缺陷候选（详见 TEST_REPORT/DEFECTS 阶段收敛，此处为静态候选）：

| # | file:line | 现象 | 候选级 |
|---|---|---|---|
| Q1 | apps/web/src/features/home/components/HomeView.tsx:179 | 用户可见错误文案硬编码中文（违反 i18n 规范 ADR-0003） | P1 |
| Q2-Q3 | daemon-client.ts:109,118 · canvas-stage.tsx:163 · McpConfirmBar.tsx:55 · canvas-studio.tsx:298 · CreateComponentDialog.tsx:30 | 同类落差文案 | P2 |
| Q6-Q7 | apps/web/src/features/canvas/persistence/documents-client.ts:98 · features/settings/api/daemon-client.ts:108 | **保存主链路 fetch 无超时/无 Abort**（daemon 卡死则永久 pending） | P2 |
| Q8-Q9 | services/ingest/src/transform/dwd/store.ts:74 · collect/client.ts:530 | 损坏 JSON 列/坏 JSONL 行即整批抛错 | P2/P3 |
| Q10 | features/{inspector,inspect-export,editor-components}/hooks/useDocumentSnapshot.ts | **逐字节相同三份**（diff 验证） | P2 |
| Q5 | 10 条 biome-ignore（ui/Modal、Drawer、Tree、Tooltip 等） | 字面违反「禁 lint 抑制」，各带中文原因注释，单人复核状态待确认 | P3 |
| Q11 | packages/ui/src/utils/use-draft-commit.ts（未提交 +2 行 `'use client'`） | 半截修复（同目录 use-overlay.ts 未加），动机待确认 | P3 |
| Q12 | contracts(0.41) / cli(0.58) / ingest(0.65) | 契约与命令面仅间接测试 | P2 |

## 6. 配置、密钥与环境变量

- **跟踪文件内零密钥泄漏**（1,145 文本文件全扫：`sk-`/`ghp_`/`AKIA`/`xox`/PRIVATE KEY/赋值模式，命中全为掩码示例与测试假值）。
- **本机磁盘**（已 gitignore、未跟踪，不入库）：`apps/web/.env.local` 与 `apps/web/.vercel/.env.development.local` 各含真实 `VERCEL_OIDC_TOKEN`（约 1330 字符）→ 建议人工确认有效性并轮换。
- 环境变量盘点（17 处，src 非测试）：daemon 读 `DF_DATA_ROOT/DF_PORT/DF_DEEPSEEK_API_KEY` 等（无默认凭据）；ingest 读 `GH_TOKEN`（回退 `gh auth token`）；web/cli 读 `NEXT_PUBLIC_DF_DAEMON_URL`。**无硬编码真实凭据默认值**。
- `.scratch/` **未** gitignore（12 项未跟踪草稿滞留，有误提交风险）；`artifacts/` 已 ignore。

## 7. 可测性

- 框架统一（vitest×9 包 + node:test×scripts），测试文件 340 个 / 3372+128 例，全绿且快（22s）。
- **全仓无覆盖率配置**（3 个 vitest.config.ts 均无 coverage 段）→ 覆盖率目标不可度量，需临时引入 `@vitest/coverage-v8`（测试基建，非业务代码）。
- 浏览器门禁脚本齐备（verify-canvas/command-palette/layers-reorder/ruler-guides/text-inline-edit/e2e:smoke/shell-parity/figma-*），chromium-1243 二进制在位，**但缺 5 个系统库（libnspr4/libnss3/libnssutil3/libsmime3/libasound2）→ 全部 UI 段阻塞的单一根因**。

## 8. 风险登记册

| 级 | ID | 风险 | 证据 |
|---|---|---|---|
| 高 | H1 | daemon 本地特权面：无鉴权 + `Origin:null` 恒放行 + 白名单外照常处理（代码自认取舍；企业报告 E4 曾实证恶意 Origin 可建/删/读） | apps/daemon/src/cors.ts:13-19,64-67 |
| 中 | M1 | fast-uri 传递漏洞 8 条（moderate/low，随 fastify） | pnpm audit --prod |
| 中 | M2 | 真实 VERCEL_OIDC_TOKEN 长驻开发机 .env.local（未入库） | apps/web/.env.local |
| 中 | M3 | 全仓无覆盖率度量（验收目标「核心 ≥80%」当前不可判定） | vitest.config×3 |
| 中 | M4 | 浏览器门禁/e2e:smoke/shell-parity/两态 UI 段全数挂点 → 视觉/交互回归无自动拦截面 | AGENTS.md 门禁实况 + 实测 exit 2 |
| 低 | L1 | 18 项依赖落后；electron dev 面 1 high（<44.9.1） | pnpm outdated / audit |
| 低 | L2 | services/comfy 纯占位 19 行 | — |
| 低 | L3 | `.scratch/` 未 gitignore | git check-ignore exit 1 |
| 低 | L4 | 3 个未实现守卫（exit 2 阻塞，已知口径） | AGENTS.md |
| 低 | L5 | 未提交半截改动 + 12 项 .scratch 草稿滞留工作树 | git status |

## 9. 阻塞项与假设

| ID | 阻塞/假设 | 处置 |
|---|---|---|
| B1 | Chromium 缺 5 个系统库 → 全部浏览器门禁/E2E 不可跑 | 需安装 `libnspr4 libnss3 libnssutil3 libsmime3 libasound2`（apt，可能需 sudo）→ 阻塞清单待用户确认 |
| B2 | 系统 PATH 无 node（本机唯一 node 为 ZCode 自带 v22.16.0） | 已用 `PATH=/home/QIU/.zcode/server:$PATH` 解析，门禁全绿；不影响判定 |
| B3 | 4318 端口用户 daemon 在跑、`~/.dforge` 真实数据根 | 全程未触碰；所有测试用临时数据根/独立端口（仓纪律） |
| B4 | 覆盖率需临时安装 `@vitest/coverage-v8`（改 package.json/lockfile，量完即回滚） | 属「补测试」授权范围，执行前在 TEST_PLAN 声明 |
| B5 | H1 的威胁模型假设「本地单用户、127.0.0.1 绑定」 | 按仓内既有取舍复核，不擅自改架构 |

## 10. 证据索引

- 门禁日志：`~/df-evidence/audit-2026-11/gate-logs/`（01-install … 13-audit）
- 两态证据 JSON：`~/df-evidence/audit-2026-11/gate-evidence/fe-10/`
- 依赖/密钥/环境变量原始输出：`~/df-evidence/audit-2026-11/baseline/`
- 代码质量报告副本：`~/df-evidence/audit-2026-11/quality/audit-report.md`
- 上游既有测试设计（本审计的引用基座）：`docs/quality/fullstack-test-design-2026-11-03.md`（16 模块风险矩阵 + 12 族 160 TC-ID）、`docs/quality/enterprise-test-protocol-2026-11.md`（E1-E5 终局规程）、`docs/spec/test-execution-phase1-v1.md`（阶段1规格，已执行完毕）
