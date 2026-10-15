/**
 * @dforge/daemon · 受控 CORS（跨源白名单，禁止通配）。
 *
 * 背景（架构口径「同源 HTTP」）：web 开发态跑在 `http://localhost:3000`、daemon 在
 * `http://127.0.0.1:4318`，浏览器直连必然跨源；打包桌面壳以 `file://` 装载页面时
 * 浏览器发出的 `Origin` 为字面量 `null`。这里做**白名单受控放行**，而不是 `*`：
 * - 默认仅本机开发来源（localhost:3000 / 127.0.0.1:3000），可用环境变量覆盖；
 * - 无 `Origin` 头（curl / Node 客户端 / 同源网关）直接放行——CORS 是浏览器机制，
 *   非浏览器客户端不受影响；
 * - `Origin: null` 放行：打包壳（file:// 或本地静态服务）的真实形态，且伪造 `null`
 *   的来源本来也绕不过本机回环语义（daemon 只监听 127.0.0.1，威胁模型是「本机其他页面」，
 *   受控白名单正是为了收窄它）；
 * - **非白名单来源：不加任何 CORS 头（让浏览器自行拒绝），但 API 语义不变**
 *   （服务端照常处理，不引入 403「伪安全」——真正的访问控制边界在回环监听与未来令牌）。
 */

import type { FastifyInstance } from 'fastify';

/** 默认白名单（仅本机开发来源；不设 `*`，防任意网页直读本地真值）。 */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'] as const;

/** 允许的请求方法（与 DAEMON_ROUTES 使用的集合一致）。 */
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** 允许的请求头（本段 API 只用 content-type；新增头必须在此登记）。 */
export const CORS_ALLOWED_HEADERS = ['content-type'] as const;

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

/** 创建策略：精确匹配（大小写不敏感比较 host 部分），`null` 恒放行。 */
export function createCorsPolicy(origins: readonly string[] = DEFAULT_CORS_ORIGINS): CorsPolicy {
  const normalized = origins.map((origin) => origin.toLowerCase());
  return {
    origins: [...origins],
    isAllowed(origin: string): boolean {
      if (origin === 'null') return true; // 打包壳（file://）形态，理由见模块头注释
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
