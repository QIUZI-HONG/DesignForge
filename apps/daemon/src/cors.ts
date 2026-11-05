/**
 * @dforge/daemon · 受控 CORS（跨源白名单，禁止通配）。
 *
 * 背景（架构口径「同源 HTTP」）：web 开发态跑在 `http://localhost:3000`、daemon 在
 * `http://127.0.0.1:4318`，浏览器直连必然跨源；打包桌面壳以 `file://` 装载页面时
 * 浏览器发出的 `Origin` 为字面量 `null`。这里做**白名单受控放行**，而不是 `*`。
 *
 * **2026-11 审计后收敛（audit-d02 · D-02）——本模块不再自认访问控制边界**：
 * 旧注释称「真正的访问控制边界在回环监听与未来令牌」，审计实证（h1-probe）证明回环监听
 * 不构成边界——`Origin: null`（沙箱 iframe 可伪造的形态）曾拿到 ACAO + 200 全量文档，
 * 白名单外 Origin 的写请求也曾照常进业务处理。收敛后的取舍：
 * - **令牌闸门在前**（token.ts 钩子，Host allowlist 之后、本钩子之前）：除 `/health` 与
 *   预检外，无令牌/错令牌一律 401——401 发生在本钩子之前，**不带任何 CORS 头**；
 * - `Origin: null` 的白名单放行**只在令牌合法时可达**（打包壳 file:// 形态携带令牌后才
 *   走到本钩子）；无令牌的 null 请求在令牌层已 401，不再出现「ACAO: null + 200 全量数据」；
 * - 白名单机制与 ACAO 头行为对**合法请求**（带令牌）保持不变：白名单内回显 Origin、
 *   白名单外只给 `vary: Origin`（浏览器自行拒绝读响应，服务端语义照旧）；
 * - 允许请求头新增 `x-df-token`（令牌鉴权的浏览器携带形态）。
 */

import type { FastifyInstance } from 'fastify';

/** 默认白名单（仅本机开发来源；不设 `*`，防任意网页直读本地真值）。 */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'] as const;

/** 允许的请求方法（与 DAEMON_ROUTES 使用的集合一致）。 */
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** 允许的请求头（content-type + 本地令牌头；新增头必须在此登记）。 */
export const CORS_ALLOWED_HEADERS = ['content-type', 'x-df-token'] as const;

/** 预检缓存：短（600s），开发期改白名单不必等长缓存过期。 */
export const CORS_MAX_AGE_SECONDS = 600;

/** 覆盖白名单的环境变量（逗号分隔；主名 + DF_ 前缀别名，兼容仓库既有命名）。 */
export const CORS_ORIGINS_ENV = 'DFORGE_CORS_ORIGINS' as const;
export const CORS_ORIGINS_ENV_ALIAS = 'DF_CORS_ORIGINS' as const;

/**
 * 解析白名单字符串（逗号分隔）。
 * 逐项用 URL 规范化（`new URL(x).origin`），非法项丢弃；空结果回退默认值。
 */
export function parseCorsOrigins(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [...DEFAULT_CORS_ORIGINS];
  const parsed: string[] = [];
  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    try {
      const origin = new URL(trimmed).origin;
      if (!parsed.includes(origin)) parsed.push(origin);
    } catch {
      // 非法项丢弃（宁可少放行，不可误放行）
    }
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

/** CORS 策略（可注入测试）。 */
export interface CorsPolicy {
  origins: readonly string[];
  isAllowed(origin: string): boolean;
}

/**
 * 创建策略：精确匹配（大小写不敏感比较 host 部分），`null` 放行。
 * 注意（audit-d02 · D-02）：`null` 的放行只在**令牌合法的请求**上可达——令牌闸门
 * （token.ts，注册在本钩子之前）已把无令牌请求 401 掉；本策略不再单独承载 null 的
 * 访问控制判断。 */
export function createCorsPolicy(origins: readonly string[] = DEFAULT_CORS_ORIGINS): CorsPolicy {
  const normalized = origins.map((origin) => origin.toLowerCase());
  return {
    origins: [...origins],
    isAllowed(origin: string): boolean {
      if (origin === 'null') return true; // 打包壳（file://）形态；可达性由令牌闸门保证
      return normalized.includes(origin.toLowerCase());
    },
  };
}

/** 从进程环境读取白名单（主名优先，其次 DF_ 别名）。 */
export function corsOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const raw = env[CORS_ORIGINS_ENV] ?? env[CORS_ORIGINS_ENV_ALIAS];
  return parseCorsOrigins(raw);
}

/**
 * 注册 CORS 钩子（onRequest，早于路由）：
 * - 有 Origin 且在白名单 → 回 `access-control-allow-origin`（回显）+ `vary: Origin`；
 *   命中预检（OPTIONS + access-control-request-method）→ 204 短路，带方法/头/缓存头；
 * - 有 Origin 但不在白名单 → 只加 `vary: Origin`，不加放行头（请求仍按原语义处理）；
 * - 无 Origin → 不做任何事。
 */
export function registerCors(app: FastifyInstance, policy: CorsPolicy): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
      return;
    }
    // 响应内容随 Origin 变化：缓存（含共享缓存）必须区分
    reply.header('vary', 'Origin');
    if (!policy.isAllowed(origin)) {
      return;
    }
    reply.header('access-control-allow-origin', origin);

    const requestedMethod = request.headers['access-control-request-method'];
    if (request.method === 'OPTIONS' && typeof requestedMethod === 'string') {
      reply
        .header('access-control-allow-methods', CORS_ALLOWED_METHODS.join(','))
        .header('access-control-allow-headers', CORS_ALLOWED_HEADERS.join(','))
        .header('access-control-max-age', String(CORS_MAX_AGE_SECONDS))
        .code(204)
        .send();
      return reply;
    }
    return;
  });
}
