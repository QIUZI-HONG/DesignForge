# PR_BATCH_2 — D-02 daemon 本地令牌鉴权 + Origin:null 白名单化（audit-d02）

- **分支**：`fix/daemon-local-auth`（工作树 `/home/QIU/df-wt/audit-d02`）→ **已合并 main**（merge `1b0350d`；合并前已按卫生并入 main tip `c6880df`）
- **依据**：`docs/audit/DEFECTS.md` D-02 · h1 探针实证 · 用户决策 **Q1=A**（令牌 + null 白名单化）
- **决策记录**：新增 `docs/adr/0006-daemon-local-token-auth.md`；ADR-0004 补记③

## 设计定稿（令牌流）

```
daemon 启动 → <dataRoot>/daemon-token 落盘（0600，复用不重置）
  ├─ 壳/CLI/门禁夹具：读本文件（本机文件权限即边界；CLI 另收 DF_DAEMON_TOKEN env）
  ├─ 壳 → 装载 URL ?dfToken= → web 单点 daemon-endpoint.ts 读取并持久化 localStorage(dfg:daemon-token)
  └─ 各 client 经 daemonAuthHeaders() 统一带 x-df-token
钩子序：Host allowlist → 令牌闸门 → CORS；无令牌 401 且无任何 CORS 头
Origin:null 放行仅在带合法令牌时可达；逃生阀 DF_AUTH_DISABLED=1；硬编码令牌缺省值=0
```

## 变更面（14 commits）

- `packages/contracts`：`unauthorized`/401 错误码
- `apps/daemon`：`token.ts` 新模块 + app 接线 + harness 自动携带 + `routes/token.test.ts` 对抗五条
- `apps/web`：单点模块 + 10 个 client 适配 + 9 例新测试
- `apps/desktop`：`daemon-token.ts` + loadTarget 注入
- `tools/cli`、`scripts`（gates/daemon-fixture/browser-toolchain/ui-mount + 9 门禁脚本）
- 集成前置：并入 main tip 解锁 `next build`（批1 `'use client'` 修复）

## 测试结果（证据 `~/df-evidence/audit-d02/`）

| 验收 | 结果 |
|---|---|
| `pnpm verify` | **exit 0**（3403 例，含并入 main tip 后复跑；合并 main 后复验再 0） |
| `verify:mcp-stub` | **exit 0**（合并 main 后复验 0） |
| ai/image 两态 | 数据面 13/8 步 **0 失败**（exit 2=UI 段挂点语义，与 CI 同态） |
| `verify-canvas` | 挂载 6+接线 15 **全过**（exit 2=REF-01 参照集未冻结，预期阻塞）；`e2e-smoke`=0 |
| **h1 探针令牌版** | **P2（null 全读）/P4（跨源写）= 401 且无 ACAO**；合法令牌 200+ACAO——D-02 利用链封死 |
| shell-parity | smoke=0 / alive=0（不因令牌退化） |
| `verify:daemon` | 0（38 步，含新 token.unauthorized 步） |

## 性能对比

不适用（安全修复；`pnpm verify` 耗时与基线持平量级）。

## 风险

- 令牌缺省开启属**行为变更**：任何仓外自建客户端直连 daemon 需带 `x-df-token`（逃生阀 `DF_AUTH_DISABLED=1` 可临时回旧行为）。
- 壳→页面令牌经 `?dfToken=` 查询串注入（本机回环 + 0600 文件边界内；不落日志的路径已核）。

## 回滚

`git revert -m 1 1b0350d`；或运行期 `DF_AUTH_DISABLED=1` 临时回旧行为（不改代码的回滚阀）。

## 遗留

- ai/image 两态 UI 段与 canvas 参照集阻塞为既有挂点（批7 范围）。
