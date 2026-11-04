/**
 * @dforge/daemon · 请求级 Host allowlist（DNS-rebinding 防线）。
 *
 * 背景（企业级测试报告 §4 · D-0 / TC-SEC-02 实证）：daemon 只监听 127.0.0.1，但这不构成
 * 访问控制——浏览器不受同源策略约束的 DNS-rebinding 可把攻击者域名解析到 127.0.0.1，
 * 请求照常抵达本机端口（E4 黑盒实证：伪造 `Host: evil.example` 的 GET/DELETE 曾 200 执行）。
 * Host 头在 HTTP 层由客户端声明、与连接目标无关，是识别「请求声称写给谁」的唯一线索——
 * 这里做**请求级白名单**：hostname 不在回环集合一律 403 `host_not_allowed`（统一错误信封）。
 * - 默认仅本机回环 `{127.0.0.1, localhost, ::1}`，可用 `DFORGE_ALLOWED_HOSTS`（别名
 *   `DF_ALLOWED_HOSTS`）逗号**并集扩展**——为将来非回环部署（DF_HOST=0.0.0.0 + 反代）预留；
 * - Host 缺失（HTTP/1.0 最简请求）**保守按 403 处理**；HTTP/1.1 无 Host 由 Node 解析器
 *   直接 400，本钩子是其后的第二道兜底；
 * - 匹配语义：**hostname 精确匹配**（去端口、方括号 IPv6 剥括号、大小写不敏感），
 *   不做后缀/结尾点归一（`localhost.` / `localhost.evil.example` 不放行——宁可少放行）；
 * - Host 缺失（HTTP/1.0 最简请求）**保守按 403 处理**；
 * - 403 响应不带 CORS 放行头（钩子语义：拒绝发生在 CORS 放行判定之后、路由之前）；
 * - 同源网关（e2e `/df/*`）转发形态天然通过：undici fetch 转发时剥除 `Host` 并按
 *   daemonUrl 重建（`127.0.0.1:<daemon 端口>`）；即使原样转发浏览器 Host 也是
 *   `127.0.0.1:<网关端口>`——hostname 均为回环。
 */

import type { FastifyInstance } from 'fastify';

import { sendFail } from './http.ts';

/** 默认允许清单（仅本机回环；daemon 也只监听回环，见 server.ts）。 */
export const DEFAULT_ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

/** 覆盖允许清单的环境变量（逗号分隔；主名 + DF_ 前缀别名，兼容仓库既有命名）。 */
export const ALLOWED_HOSTS_ENV = 'DFORGE_ALLOWED_HOSTS' as const;
export const ALLOWED_HOSTS_ENV_ALIAS = 'DF_ALLOWED_HOSTS' as const;

/**
 * 从 Host 头解析 hostname（去端口、大小写归一）：
 * - 方括号形态 `[::1]:4318` → `::1`（IPv6 + 端口的唯一合法写法）；
 * - 无方括号但含多个冒号（裸 IPv6，如 `::1`）→ 整体即主机；
 * - 其余按**最后一个/唯一冒号**切段去端口（`localhost:4318` → `localhost`）。
 */
export function hostnameFromHostHeader(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    // 缺右括号的畸形头取括号内剩余部分——后续精确匹配自然拒绝
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount >= 2) return trimmed;
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * 解析允许清单字符串（逗号分隔；逐项用 Host 头同一解析器归一为 hostname）。
 * 非法/空项丢弃；空结果回退默认值（宁可少放行，不放空清单）。
 */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [...DEFAULT_ALLOWED_HOSTS];
  const parsed: string[] = [];
  for (const item of raw.split(',')) {
    const hostname = hostnameFromHostHeader(item);
    if (hostname.length === 0) continue;
    if (!parsed.includes(hostname)) parsed.push(hostname);
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_HOSTS];
}

/**
 * 从进程环境读取允许清单（主名优先，其次 DF_ 别名）。
 * env 是**并集扩展**：回环默认项恒在清单内（本地壳/门禁永不因误配被锁死），
 * 额外项追加其后；需要完全接管时走 `allowedHosts` 注入（替换语义）。
 */
export function allowedHostsFromEnv(env: Record<string, string | undefined>): string[] {
  const raw = env[ALLOWED_HOSTS_ENV] ?? env[ALLOWED_HOSTS_ENV_ALIAS];
  if (raw === null || raw === undefined) return [...DEFAULT_ALLOWED_HOSTS];
  const merged: string[] = [...DEFAULT_ALLOWED_HOSTS];
  for (const hostname of parseAllowedHosts(raw)) {
    if (!merged.includes(hostname)) merged.push(hostname);
  }
  return merged;
}

/** Host 策略（可注入测试）。 */
export interface HostPolicy {
  hosts: readonly string[];
  isAllowed(hostname: string): boolean;
}

/** 创建策略：hostname 精确匹配（大小写不敏感）。 */
export function createHostPolicy(allowed: readonly string[] = DEFAULT_ALLOWED_HOSTS): HostPolicy {
  const normalized = new Set(allowed.map((host) => host.toLowerCase()));
  return {
    hosts: [...allowed],
    isAllowed(hostname: string): boolean {
      return normalized.has(hostname.toLowerCase());
    },
  };
}

/**
 * 注册 Host allowlist 钩子（onRequest，CORS 钩子之后、路由之前）：
 * hostname 不在允许清单（含 Host 缺失）→ 403 `host_not_allowed` 统一信封，短路路由。
 */
export function registerHostGuard(app: FastifyInstance, policy: HostPolicy): void {
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    const hostname = typeof host === 'string' ? hostnameFromHostHeader(host) : '';
    if (hostname.length > 0 && policy.isAllowed(hostname)) {
      return;
    }
    return sendFail(reply, 'host_not_allowed', 'Host 不在允许清单（仅本机回环）');
  });
}
