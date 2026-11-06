# PR_BATCH_7 — D-09 门禁可信度 + perf 基线转正 provisional:false（audit-d07）

- **分支**：`fix/gate-credibility-perf`（工作树 `/home/QIU/df-wt/audit-d07`）→ **已合并 main**（merge `2e1814a`，合并后 main 复验 `pnpm verify`=0 · `test:scripts`=0 · `verify:mcp-stub`=0）
- **依据**：`docs/audit/DEFECTS.md` D-09（门禁脚本缺陷组）· `docs/audit/OPTIMIZATION_PLAN.md` §4 批7 行 · 审计证据 `~/df-evidence/audit-2026-11/gate-browser/`
- **依赖口径**：批1（canvas 红转绿）→ 批7（perf 真链路前提）；批5（bodyLimit）→ 批7（@5k 采集前提）——均已先行入 main

## 变更说明（5 commits，11 文件 +405/-59）

| 缺陷 | 文件 | 变更 |
|---|---|---|
| D-09 ① | `verify-command-palette.mjs` / `verify-ruler-guides-persist.mjs` / `verify-layers-reorder-persist.mjs` / `verify-text-inline-edit.mjs` | 四脚本 `finish()` 第三段「按端口找监听者 SIGKILL」原门控 `webUrl !== null`——`DF_WEB_URL` 复用的外部站点也会被当残留杀掉（审计期实测误杀 3100 共享站点）；改 `!reuseSite` 门控：**回收只针对本脚本自起的站点**，外部站点只探测复用、绝不按端口杀，不可达时按既有三态 exit 2 阻塞；外部复用时打显式日志 |
| D-09 ② | `scripts/verify-perf.mjs` | 误用 puppeteer 的 `page.evaluateOnNewDocument`（playwright-core 应为 `addInitScript`），@1k 档实跑抛 TypeError 采不了数——改用 `addInitScript` 注入 FCP 观察者 |
| D-09 ③ | `scripts/verify-perf.mjs` | 基准文档 id 种子偏移到 1e6 段（`BENCH_ID_SEED_OFFSET`，固定种子纯计数，跨机比特一致）：studio 会话 id 工厂硬编码 seed 1000，@5k 档 M4 撤销探针的 createRect 被拒收「节点 id 已存在：n_1000」；另 M2 步骤 detail 补 perf() 环形窗口绘制耗时 p95 读数（基线轮校准 m2DurationP95Ms 的数据来源） |
| D-09 ④ | `scripts/verify-perf.mjs` | 新增 `exceedsThreshold` 唯一比较口径（evaluatePerf / evaluatePerfRun 共用）：`value > threshold + 1e-6ms`——阈值入库粒度 0.1ms，实测值是 IEEE 双浮点累计结果，1e-6ms 只吸收表示伪差、比粒度低 5 个数量级，不放过任何真实回退（真实回退 ≥ 粒度 0.1ms） |
| D-09 ③ | `docs/quality/perf-baseline-v1.json` | 实测基线入库（dev 机真链路实采 9 轮 rounds A-I，晨/晚两时段），**provisional:false** 转正式判定；minSamples m2Interval 120→60；minFrames 240→40；定标规则二次修订（见「定标修订史」） |
| D-09 ③收尾 | `.github/workflows/ci.yml` | verify:perf 转正式判定挂点（见「偏离登记」） |
| D-09 ③收尾 | `docs/agents/implementation-workflow.md` + `AGENTS.md` | 门禁实况两处同源：verify:perf 段从「基线 provisional 恒阻塞」改为「已实现+基线实采转正，dev 机正式判定 0/1 + CI 正式判定挂点」 |
| 回归钉 | 新增 `scripts/tests/gate-reclaim-semantics.test.mjs`（4 例）+ `scripts/tests/verify-perf.test.mjs` 补 2 例 | reuseSite 旗标存在、killPortListener 必须被 !reuseSite 门控、外部站点不回收日志、禁 evaluateOnNewDocument；粒度容差不判违规 / 真实回退 16.8 > 16.7 仍判违规 |

## 测试结果（证据 `~/df-evidence/audit-d07/`）

| 验收 | 结果 |
|---|---|
| `verify:perf` 正式判定（确认轮 I，门禁默认自建口径） | **exit 0**，三档全达标：@1k M1 434ms；@5k M1 374ms / M3 328.6ms / M4 36.4ms / M5 92.1ms；@20k M1 570ms / M2 间隔 p95 216.6999ms（越过纯较差值线 216.6，由 ×1.5 余量覆盖——棘轮漂移再证）/ M5 277.3ms（`perf-roundI-final.log`） |
| `pnpm verify`（分支上终轮） | **exit 0**（`verify-final.log` · `PNPM_VERIFY_EXIT=0`） |
| `pnpm test:scripts`（分支上终轮） | **exit 0**（134 例：含 gate-reclaim-semantics 4 例 + verify-perf 补 2 例） |
| 四浏览器门禁复用暖站点复跑（D-09 ① 实战复核） | palette / layers / ruler / text 均 **exit 0**，日志显式打「外部站点复用（http://127.0.0.1:3320）：不回收该站点进程」（`*-final.log`） |
| verify-perf `--self-test` | 19 例全过（含容差正反两例） |
| 合并后 main 复验 | verify=0 · test:scripts=0（134 例）· mcp-stub=0 |
| **未在 main 复跑**：`verify:perf` 正式判定 | exit 0 已在批7 分支确认轮 I 达成；main 新增的批4 改动（apps/web 保存链）与 perf 基线/脚本零文件交集，故不重跑 |

## 偏离登记（对照 OPTIMIZATION_PLAN 批7 计划行）

计划行写「verify:perf → **exit 0/1 正式判定**（阻塞解除）」。实际达成：

- **dev 机（本机）已正式判定**：rounds A-I 九轮实采 → 确认轮 I 三档全达标 **exit 0**，基线 `provisional:false`，门禁进入 0/1 判定。
- **CI 侧为「正式判定挂点」**，非严格 exit 0/1：exit 0 收（正式判定通过）；exit 1 红（真违规，禁以环境理由掩盖）；exit 2 **仅当**阻塞原因属「CI 无真链路」族（Chromium/构建/daemon）才按挂点语义收（阻塞不是通过），且日志出现 provisional 字样即红（基线转正后不得回退成模板态阻塞）。比 figma-baseline 的阻塞语义断言收紧，不假绿。
- **不改严格判定的理由**：CI 无真链路（不装 Chromium）必恒 exit 2，接严格判定=恒红；阈值按 dev 机（i7-14650HX 24 逻辑核）校准贴地，而跨轮离散实录 1.13~2.05×，4 vCPU runner 跨机直判必红。
- **收口条件**：浏览器门禁票给 CI 真链路 + 阈值跨机校准后，CI 改严格 exit 0/1。

## 灵敏度分账（防下会话误用）

- **门禁 trip-wire**：劣化 ≥ 最差观测的 **+50%**（阈值 = 全部登记轮较差值 ×1.5 漂移余量）——门禁只守大回归。
- **验收线**：OPTIMIZATION_PLAN §5「优化后**无 >10% 回退**」**不靠门禁**，由 rounds 轮次数据人工比对判定。
- 两者分账：更细的退化由 rounds 追踪与对标报告基准承担；**门禁不是唯一回归检查**。

## 定标修订史（2026-11-06 晚）

1. **minFrames 240→40**：模板 240 遗留从未校准——M1+M2 手势流程按需重绘实测仅产 53/54/54 帧（round D 实录，provisional 短路消失后暴露的首个正式判定阻塞）；40 ≈ 观测下限 75%（显著低于常态、显著高于坏通道 frames≈0-5 的「通道活着」地板），非性能线。
2. **阈值比较加 1e-6ms 浮点容差**：假违规实录——round E @5k 档 interval p95 = 16.800000000000182ms 对阈值 16.8ms 被无容差比较判成「超阈 0.0000000000002ms」；round H 20k 216.60000000000036 vs 216.6 同类（伪差 3.6e-13ms）。
3. **定标规则二次修订：「三轮较差值」→「全部登记轮较差值 ×1.5 漂移余量，向上取整到 0.1ms」**：依据 = rounds D-H 六次正式判定尝试**五次噪声红**——同机零代码变更下跨轮离散实录 M4 1.13× / M1 1.16-1.28× / M5 1.32-1.46× / m2Duration 1.22-1.67× / M3 2.05×（晚间时段系统性偏慢：m2Duration +22~67%、M5 +10~30%）；纯最差值棘轮不收敛、exit 1 打在机器噪声上违背「1=真违规」语义。
4. **三条护栏**：① 系数上限纪律——1.5 为离散度余量上限，**不得以「再红一轮」为由上调**，确认轮仍噪声红时回证据层处理（时段标注 / 多轮取中位 / 暖机轮剥离），系数变动须另行报备评审；② 登记轮准入判据（防随手塞轮永久抬高阈值）——全档走完 TIER_PLAN + 运行于登记 machine + 确定性采集流程（id 种子偏移、定步长手势、探针数不变）+ 口径显式标注（自建/复用暖站点）+ 一轮一证据，无证据轮不得入册；③ A/B/C 晨间轮为复用口径，**按观察轮留档**（读数均低于自建口径较差值、不改变定标结果），若未来把复用口径立为正式判定口径须以 ≥3 轮复用口径实采重定标。

## 环境事实（复跑前必读）

- node 22.16.0：直跑前端 `.ts` 适配层需 `NODE_OPTIONS=--experimental-strip-types`（22.6–23.5 需要；22.18+ 缺省已开，显式设置无害）。
- Chromium（chromium-1243，playwright 缓存，headless --no-sandbox）系统依赖库经 `LD_LIBRARY_PATH=/home/QIU/df-local-libs/usr/lib/x86_64-linux-gnu` 提供（审计 B1 解包件），本票未安装任何系统包。
- **m6 heap 通道恒 0 字节**：CDP HeapProfiler 在 collectGarbage 后 getSamplingProfile 返回空采样树——读数通道在本机环境不产出，门禁按记录性留存原值、不影响 0/1 判定；**接真读数前不得引用该指标下结论**。m7 剔除率同为记录性（0/20000，无视口剔除——E-7 空间索引立项依据）。

## 风险

- 阈值贴地 + 1.5 余量：灵敏度下探到「劣化 ≥ +50%」——10% 级退化门禁不红，须靠 rounds 人工比对（见灵敏度分账）。
- 阈值绑定 dev 机：跨机（含 CI runner）读数不可直判，跨期比对须连同 machine 与时段一起看。

## 回滚

`git revert -m 1 2e1814a`；单独回退基线可 revert `0b2e5d5`（基线 JSON 回 provisional 模板态，门禁回 exit 2 阻塞）。

## 遗留

- CI 侧严格正式判定（exit 0/1）挂点待浏览器门禁票给 CI 真链路 + 阈值跨机校准后收口。
- A/B/C 复用口径若立为正式判定口径，须 ≥3 轮复用口径实采重定标。
- m6 heap 读数通道待接真读数（当前恒 0，不得据此下结论）。
- 后续轮次若刷出新最差：新最差 ×1.5 仍低于现阈值 → 阈值不动；高于 → 追加基准轮并按登记判据上调对应阈值。

## CI 首跑勘误（2026-11-07 · audit-d07b）

- **翻车实录**：CI run 42313746571（main `eb9ee1b`）**failure**，唯一红步=第 22 步「渲染性能门禁（正式判定挂点）」。
- **根因**：本批接入的 CI 判据把 exit 2 收放写成 **grep 门禁日志文本**（「日志含 provisional 字样即红」），但门禁 exit 2 的**合法阻塞文案**本身就含 provisional 字样（verify-perf.mjs 阻塞聚合行「阻塞：N 档判不了（基线/provisional/采集不完整——禁假绿）」与待办行「…置 provisional:false…」）→ CI 无 Chromium 恒 exit 2 → 文案必然命中 → **该步在 CI 按原写法永不可能绿**。门禁脚本本身健康（`--self-test` 19/19、dev 机正式判定 exit 0），纯 CI 接线判定缺陷。
- **修复**（分支 `fix/ci-perf-hookpoint`，工作树 `/home/QIU/df-wt/audit-d07b`）：判据从「grep 日志文本」改为「**查基线 JSON 状态字段**」——判定抽共享裁决 `scripts/lib/perf-ci-judgment.mjs`（与 tp2-03 two-state-verdict 同构），ci.yml perf 步 node 直跑之：exit 0 收 / exit 1 红 / exit 2 **仅当** `docs/quality/perf-baseline-v1.json` 的 `provisional === false`（真链路族阻塞）才收；基线回退（provisional:true）、字段缺失/非布尔、基线不可读、其余退出码一律红。**判定强度不降**（provisional:true 回退依旧红，只是判据落在字段而非自由文本）；门禁输出文案不动（含 provisional 字样从此无害）。
- **回归钉**：新增 `scripts/tests/perf-ci-judgment.test.mjs`（16 例，随「脚本单测」步跑）：四主钉（exit 0 收 / exit 1 红 / exit 2+转正态收 / exit 2+回退态红）+ 非法退出码红 + 字段缺失/基线缺失/损坏 JSON/null 基线红 + 反例钉（合法收下文案含 provisional 字样仍收）+ CLI 接线。
- **复验**（证据 `~/df-evidence/audit-d07b/REPLAY.md`）：新单测 16/16 · `pnpm test:scripts` 158/158 · `pnpm verify`=0；场景 A（门禁离线 exit 2，输出含 3 处 provisional 字样）→ 新判定收绿 exit 0（旧 grep 必误伤）；场景 B（provisional:true 基线副本）→ 新判定红 exit 1。
- **重验 run**：推送后回填（run id / URL / head SHA）。
