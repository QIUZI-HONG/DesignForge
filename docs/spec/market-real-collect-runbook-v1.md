# Runbook：市场真采批一键执行（v1）

> 状态：**真采批待 PAT**（截至 2026-11-08，`~/.dforge/github-token` 未写入）。
> 本文档是「凭据就位后一键执行」的操作手册（市场线总案 v2 · 票① §4.3）；接线本体
> `df market deploy` 见 `tools/cli/src/market/deploy-cmd.ts`（含三态退出码与幂等口径）。

## 1. 前置检查（逐条过，缺一即停）

1. **凭据就位**：PAT 由用户写入 `~/.dforge/github-token`（权限 0600，scopes：`public_repo` 读公有仓即可）。
   检查：`test -r ~/.dforge/github-token && stat -c '%a' ~/.dforge/github-token`（期望 600）。
   采集客户端的凭据解析链是 `GH_TOKEN`/`GITHUB_TOKEN` 环境变量 → `gh auth token`
   （`services/ingest/src/collect/client.ts` `resolveGitHubToken`）；本机无 gh CLI，
   所以执行时必须显式注入：`GH_TOKEN="$(cat ~/.dforge/github-token)"`。
2. **限速预算**：带令牌 5000 req/h（匿名仅 60 req/h，**40 仓真采批 ≈200+ 请求，必须带 token**）。
   执行前可核对余额：`curl -s -H "Authorization: Bearer $(cat ~/.dforge/github-token)" https://api.github.com/rate_limit`。
3. **环境口径**：真采需要真网，**只在 dev 机跑，不进 CI**（CI 无凭据也无真网出口，见
   `docs/agents/implementation-workflow.md`「CI 环境差异」）。daemon（4318）与 `next dev`（3000）
   常驻进程**不需要停**——deploy 走临时文件 + rename 原子替换，daemon 下一次读取即见新索引。
4. **数据面目录**：管线数据面默认 `~/df-evidence/mk-05/batch/data`（与 verify-mk-05 缺省一致，
   证据落仓库外，不进 git）。

## 2. 一键执行（全链模式，推荐）

```bash
cd /home/QIU/df-wt/market-real-collect   # 或集成后的工作树
pnpm install --frozen-lockfile

GH_TOKEN="$(cat ~/.dforge/github-token)" \
  pnpm market:deploy -- \
  --data "$HOME/df-evidence/mk-05/batch/data" \
  --collect --limit 40 \
  --as-of "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

`--collect` 全链模式 = `collect（真网采集 → ODS → DWD）` → `score（五维评分）` →
`index（ADS 索引，先校验后落盘）` → `deploy（写 daemon 数据根）` 一条命令；
任何一环非 0 即整单非 0（上游阻塞透传，不产出退化产物）。

缺省 `--data-root` 是 `~/.dforge`；如需先演练，显式给临时目标根
（`--data-root "$HOME/df-evidence/market-real-collect/daemon-root"`），确认无误后再对真实数据根执行。

## 3. 分步执行（等价；便于中途体检）

```bash
export GH_TOKEN="$(cat ~/.dforge/github-token)"
DATA="$HOME/df-evidence/mk-05/batch/data"

pnpm market:collect -- --data "$DATA" --limit 40 --as-of "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pnpm market:score   -- --data "$DATA"
pnpm market:index   -- --data "$DATA"

node scripts/verify-mk-05.mjs            # 六环判据（缺省读 ~/df-evidence/mk-05/batch/data）
pnpm market:deploy  -- --data "$DATA"    # 部署（等价于 --from-index 语义外的重建口径）
```

说明：`market:deploy` 缺省对 DWD+DWS 重跑 index 管线再部署（同输入同产物）；只部署已有
ADS 产物用 `--from-index`（部署前仍独立过 schema 校验）。

## 4. 执行后验证

1. **幂等**：重复执行同一命令 → 两产物字节不变（sha256 相同），只有部署账本
   `~/.dforge/market/deploy-state.v1.json` 的 `deployCount` 递增、`changed=false`。
2. **六环判据**：`node scripts/verify-mk-05.mjs` → exit 0（40 仓、四类各 ≥5、可装载 ≥31、
   index schema 过、示例检索 ≥10 条、证据复跑逐层 digest 一致）。
3. **真数据面**：daemon 用真实数据根在跑时，`pnpm verify:market` 的 E1（中文检索命中）/E3
   （统计口径）探针打 `/market/query`，读到的就是刚部署的索引；如 daemon 已缓存旧索引，
   重启 daemon 进程即可（daemon 读点 `apps/daemon/src/context.ts` `marketIndexCandidates[0]`）。
4. **证据归档**：命令证据 JSON 在 `<data>/evidence/`；对照证据复制到
   `~/df-evidence/market-real-collect/`（仓库不存证据）。

## 5. 退出码与回滚

- 三态：`0` 通过 / `1` 断言失败（校验不过、空索引不部署、回读不符——**数据根不会被写坏**）/
  `2` 阻塞（缺凭据、缺上游产物、参数错误）。阻塞与失败都会在 stderr 说明原因，禁止假绿。
- 回滚：上一版索引被覆盖前可从 `<data>/ads/`（源产物，带 runId 证据）重新部署任意历史批次；
  部署账本记录了每次的源 sha256，可审计。

## 6. 本批状态登记

- 2026-11-08（票①）：接线与测试完成（deploy 12 例、@dforge/cli 98 例全绿；离线全链在冻结
  replay 样本上验证）。**真采批执行待 PAT 就位**，就位后按本文档 §2 一键执行并回填结果到票报告。
