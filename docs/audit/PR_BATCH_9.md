# PR_BATCH_9 — D-12 依赖补丁：fastify/next/electron 补丁三连 + fast-uri 双线钉版（audit-d09）

- **分支**：`chore/deps-patch-audit`（工作树 `/home/QIU/df-wt/audit-d09`）→ **已合并 main**（merge `7369f22`，单提交 `eff5d61` 基 `a9e9b86` = main tip，ort 策略**零冲突**；合并后 main 复验 `pnpm verify`=0 · `test:scripts`=0 · `verify:mcp-stub`=0 · `e2e:smoke`=0 · 四守卫=0）
- **依据**：`docs/audit/DEFECTS.md` D-12（依赖：fast-uri 8 条 moderate/low 随 fastify 传入；electron dev 面 1 high <44.9.1；18 项过时）· pnpm audit/outdated 实证
- **范围口径**：**只升补丁版本，不升大版本**；overlays 只钉传递依赖修复版，不顺手升级任何直接依赖的大版本

## 变更说明（1 commit `eff5d61`：pnpm-workspace.yaml + pnpm-lock.yaml）

### 1. catalog 补丁三连

| 包 | 前 | 后 | 性质 |
|---|---|---|---|
| `fastify`（apps/daemon） | ^5.12.7 | **^5.12.8** | 补丁版本 |
| `next`（apps/web） | 16.4.1 | **16.4.5** | 补丁版本 |
| `electron`（apps/desktop） | 44.7.2 | **44.9.1** | 补丁版本（44.x 线内；latest 45.2.3 为大版本，不动） |

### 2. 新增 pnpm-workspace.yaml `overrides`（fast-uri 双线钉版）

```yaml
overrides:
  'fast-uri@<4': 3.1.9    # ajv@8.20.0 线（修复版 ≥3.1.9）
  'fast-uri@>=4': 4.2.3   # @fastify/ajv-compiler@4.0.7 线（修复版 ≥4.2.3）
```

**为什么按大版本线分离钉版**：audit-before 的 8 条 fast-uri 告警（moderate×4 + low×4）来自两条传递线——

- `apps__daemon>fastify>@fastify/ajv-compiler>fast-uri`（**4.x 直用**，4.2.2）：2 moderate（URI scheme 伪造 1243097 / WHATWG host 混淆 1243103）+ 2 low（相对引用路径等价 1243100 / 未转义首段 scheme 注入 1243106）；
- `apps__daemon>fastify>@fastify/ajv-compiler>ajv>fast-uri`（**3.x 经 ajv@8.20.0**，3.1.8）：对称 4 条（moderate 1243098/1243104 + low 1243101/1243107）。

两条线各钉到**各自大版本内的修复版**（3.1.9 / 4.2.3），**不跨大版本强推**——ajv@8.20.0 对 fast-uri 3.x 有接口假设，跨大版本强升到 4.x 可能破坏 ajv 的兼容面；钉版写进 overrides（版本统一真源），lockfile 与 catalog 同提交。

### 3. audit 前后对比（三口径）

| 口径 | before（低→高） | after |
|---|---|---|
| 全量 | low 4 / moderate 4 / high 1 / critical 0 | **全 0** |
| `--prod` | （含 fast-uri 8 条） | **0** |
| `--dev` | （含 electron 44.7.2 1 high：GHSA-jr5w-w6x2-84p9， compromised eMudhra 中间证书缓解） | **0** |

- **high 1**：electron 44.7.2（`apps__desktop>electron`，dev 面）→ 44.9.1 收口。
- **moderate×4 + low×4**：fast-uri 两条传递线（见上）→ overrides 双线钉版收口。

### 4. 未顺手升级（非目标）

outdated-before 共 **18 项**，本批只升 **3 项**（上表补丁三连）；其余 **15 项未动**——其中 react/react-dom/@types 18→19、typescript 5.9→7.0、electron 44→45.2.3、jsdom 30→31、@types/node 22→26 等均为大版本跳变，**非本票目标（不升大版本）**，留给后续独立票逐项评估。

## 测试结果（证据 `~/df-evidence/audit-d09/`：audit-before/after 三口径 JSON · outdated-before· install 日志 · 门禁日志）

| 验收 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（分支交付） | **exit 0**（lockfile 与 catalog 同提交复核过） |
| `pnpm verify`（分支交付） | **exit 0**（3494 例：contracts 85/engine 396/ui 283/desktop 125/comfy 1/web 1727/ingest 586/cli 85/daemon 206） |
| `pnpm audit` 三口径（分支交付） | **exit 0 × 3**（before 9 条 → after 0） |
| `pnpm test:scripts` / `verify:mcp-stub` / 四守卫 / `e2e:smoke`（分支交付） | **全 exit 0**（mcp-stub 16 步 0 失败；四守卫 0 违规） |
| `pnpm install --frozen-lockfile`（**合并后 main 复验**） | **exit 0**（+10 -7 包） |
| `pnpm verify`（**合并后 main 复验**） | **exit 0**（3494 例：contracts 85/engine 396/ui 283/desktop 125/comfy 1/web 1727/ingest 586/cli 85/daemon 206） |
| `pnpm test:scripts`（**合并后 main 复验**） | **exit 0**（139 例） |
| `verify:mcp-stub`（**合并后 main 复验**） | **exit 0**（16 步 0 失败） |
| `pnpm audit` / `--prod` / `--dev`（**合并后 main 复验**） | **exit 0 × 3**（三口径 "No known vulnerabilities found"） |
| 四守卫 `guard:tokens`/`guard:vocab`/`guard:feature-boundaries`/`guard:electron-baseline`（**合并后 main 复验**） | **exit 0 × 4** |
| `pnpm e2e:smoke`（**合并后 main 复验**，next build + start · 独立临时端口 · 仓外数据根） | **exit 0**（63 项 ✓ 断言 0 失败；4 场景 canvas 10/editor 17/home 8/nav 21 结构化步骤全 pass） |

### main 复验两起环境事实（如实记录，非代码问题）

- **`pnpm verify` 首轮 exit 1**：packages/ui vitest 启动期 `ENOTEMPTY: rmdir node_modules/.vitest-cache`（多包并行清理竞态，PR_BATCH_8「环境事实」已登记的同款抖动），**重跑 exit 0**——非本批代码问题，无需修复动作。
- **`pnpm audit` 全量与 `--prod` 首轮 ETIMEDOUT**（registry.npmjs.org 网络抖动，pnpm 自动重试 2 次内恢复），重试后三口径均 "No known vulnerabilities found"。

## 合并卫生

- 分支基 `a9e9b86` **恰为合并时 main tip**，无先行并入步骤，ort 策略自动合并**零冲突**，结果 diff 与分支单提交逐字节一致（仅 `pnpm-workspace.yaml` +13/-6、`pnpm-lock.yaml` +64/-60）。
- 合并后按「先装后验」顺序复验：`install --frozen-lockfile` 先过（lockfile 已变），再跑全量门禁。
- 工作树 `audit-d09` 于复验全绿后移除（分支保留）；**未触碰** `audit-d06` 工作树与任何在跑进程。

## 遗留

- **Next 16.4.5 运行时警告**：「React 18 support deprecated in Next 16, removed in 17」——React 19 是大版本迁移（react/react-dom/@types/react* 5 项联动），**后续票收口**；警告不阻塞构建与门禁。
- **electron 45.2.3 / biome 2.6.6 / playwright-core 1.65.0 / vitest 5.1.0 / zustand 5.1.0** 等 15 项过时项留待后续票（各自含大版本或行为面评估）。
- **fast-uri 静态钉版维护点**：overrides 是静态钉版——**fastify 主版本升级时需复核两条线**（@fastify/ajv-compiler 与 ajv 的大版本线可能整体迁移），届时应移除不再命中的钉版线，避免 overrides 与新传递面漂移。

## 风险 / 回滚

- **回滚**：`git revert -m 1 7369f22`（lockfile 随 revert 一并还原）；回滚后重跑 `pnpm install --frozen-lockfile` + `pnpm verify`。
- fast-uri 3.x/4.x 钉版属**行为级覆盖**（非仅版本号）：若 ajv/ajv-compiler 后续版本自带修复版 fast-uri 下界，overrides 会继续生效为「不低于钉版」，无回退风险；只有大版本线迁移时需要人工复核（见遗留）。
- electron 44.9.1 二进制经 `@electron/get` 懒下载（`ELECTRON_MIRROR` 镜像），壳运行面无变化（FE-12 安全基线四守卫复验 0）。
