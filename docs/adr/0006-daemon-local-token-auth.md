# ADR-0006 · daemon 本地令牌鉴权（audit-d02 · D-02 收敛）

日期：2026-11-06
状态：已生效
依据：DEFECTS.md D-02（daemon 本地特权面）；审计实证
`~/df-evidence/audit-2026-11/baseline/h1-probe.txt`（可复跑脚本同目录）

## 背景

审计（2026-11）实证 daemon 的本地特权面不成立：daemon 只监听 `127.0.0.1` 并有 Host
allowlist（ADR 引用的 DNS-rebinding 防线）与 CORS 白名单，但——

1. `Origin: null`（沙箱 iframe / `file://` 形态，恶意页面可伪造）拿到
   `access-control-allow-origin: null` + 200 全量文档数据——任意网页可读本地文档；
2. 白名单外 Origin 的**写请求照常进业务处理**（服务端「不引入 403 伪安全」的取舍让
   CORS 只防浏览器读，不防写副作用）。

根因：旧取舍（cors.ts 旧模块头）把访问控制边界押在「回环监听与未来令牌」上，而回环
监听只证明「请求来自本机」——本机跑着任意网页与不可信代码，它不构成边界。

## 决策

**令牌 + `Origin: null` 白名单化**（用户拍板 Q1=A）：

1. **本地令牌鉴权缺省开启**（`apps/daemon/src/token.ts`）：
   - daemon 启动时在其数据根确保令牌文件 `<dataRoot>/daemon-token`（0600，64 位 hex；
     已存在则复用，绝不重置——重置会踢掉所有在线客户端）；
   - 除 `/health`（端点发现握手：前端端口窗探测、门禁判活依赖）与 CORS 预检
     （OPTIONS + `access-control-request-method`，预检本身不带自定义头）外，**所有路由
     要求携带令牌**：建议头 `x-df-token`，兼容 `Authorization: Bearer`；
   - 缺失/错误 → 401 `unauthorized` 统一信封（错误码入 `@dforge/contracts`，HTTP 401）；
   - 逃生阀：env `DF_AUTH_DISABLED=1` 显式关闭（只认 `1`；缺省恒开）。
2. **钩子次序 = Host allowlist → 令牌 → CORS**：无令牌请求在 CORS 层之前 401（响应不带
   任何 CORS 头）；`Origin: null` 的白名单放行因此**只在带合法令牌时可达**（打包壳
   `file://` 形态）。白名单机制与 ACAO 头行为对合法请求保持不变。
3. **客户端获取路径 = 本机文件权限即边界或显式传参**（禁止硬编码令牌缺省值）：
   - **web 前端**：单点模块 `lib/daemon-endpoint.ts` 新增令牌解析（`?dfToken=` 查询参数
     → `NEXT_PUBLIC_DF_DAEMON_TOKEN` → localStorage `dfg:daemon-token`；查询参数命中即
     持久化），`daemonAuthHeaders()` 单点供头；站内跳转 `dfToken` 与 `daemon` 同规则随行；
   - **桌面壳**：读数据根令牌文件（只读），经 `?dfToken=` 注入装载页；
   - **CLI（`df config *`）**：env `DF_DAEMON_TOKEN` → 数据根令牌文件；
   - **门禁夹具**：`startFixtureDaemon`/`resolveDaemon` 返回 token；页面形态走
     `?dfToken=`，Node 直连形态带 `x-df-token`，Playwright 转发器透传页面头并支持注入。
4. **CORS 请求头白名单**新增 `x-df-token`（预检可携带）。

## 后果

- 「本机任意网页可读/可写本地文档」的攻击面收敛为「持有令牌的本机进程」；令牌文件
  0600 使边界落在 OS 文件权限上（与凭据库同根、同纪律）。
- 所有 daemon 客户端（web 10 处、壳、CLI、约 15 个门禁脚本）已同步适配；新增客户端
  必须走对应单点（web：`daemonAuthHeaders`；Node：读令牌文件或 env），**禁止**在客户端
  硬编码令牌缺省值。
- `/health` 保持无鉴权：它只暴露版本/启动时刻/数据根路径，且端口窗探测与判活依赖它；
  该豁免在 token.ts 有测试锚定。
- 对抗回归五条（无令牌 401 / 错令牌 401 / null+无令牌 401 无 ACAO / 合法令牌+白名单
  200+ACAO / 逃生阀旧行为）锚定在 `apps/daemon/src/routes/token.test.ts`。

## 关联

- ADR-0004 裁决 ①（daemon 端点解析单点）在 audit-d02 扩展出第四个入口（令牌解析），
  补记见该文件末尾「2026-11 审计后收敛」段；历史决策未改写。
