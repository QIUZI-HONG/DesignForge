# 14: security · CLI 明文凭据外发须加回环/https 守门

**What to build:** `tools/cli/src/config/index.ts:146,179-183` 把用户配的 `apiKey` **明文** POST 到解析出来的 daemon 地址，全程没有「必须回环或 https」的校验——地址一旦被 env/参数指到外部主机，密钥就出机。测试抓不到：`config-cli.test.ts:329-351` 只钉优先级（且刻意用非法 key）、`daemon.test.ts:16-35` 只测地址归一，漂移与外泄都不红。附带口径修正：`apps/web/src/lib/daemon-endpoint.ts:98` 注释「全仓仅此一处」**字面为假**（读取点两处：`daemon-endpoint.ts:101` 与 `tools/cli/src/config/daemon.ts:34`），但 ADR-0004 ① 的字面范围是「任何 feature / 路由 / 测试夹具」，CLI 不在其内且缺省串取自 contracts → **属注释债，不是违令实现**（别把它写成违规）。

**Blocked by:** None (can start immediately；与上一轮票 02「daemon 访问控制」同一凭据面，合并时以后者口径为准)

**Status:** ready-for-agent

blockers:

- [ ] 发凭据前校验目标：`http://127.0.0.1|localhost` 或 `https://`；否则显式拒绝并给出可执行提示（不复用静默降级）
- [ ] 新增用例：非回环 http 目标 + 真实 key → 断言**不发请求**（现无任何此类断言）
- [ ] 修正 `daemon-endpoint.ts:98` 的「仅此一处」注释为准确表述（两处读取点 + 各自范围）
- [ ] 上一轮记的「部署站 `?daemon=` 接受任意地址」属同族，若已在票 02 处置则在本票注明，不重复改
