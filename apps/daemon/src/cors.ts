/**
 * @dforge/daemon · 受控 CORS（跨源白名单，禁止通配）。
 *
 * 背景（架构口径「同源 HTTP」）：web 开发态跑在 `http://localhost:3000`、daemon 在
 * `http://127.0.0.1:4318`，浏览器直连必然跨源。这里做**白名单受控放行**，而不是 `*`：
 * - **显式白名单**：默认本机开发来源（localhost:3000 / 127.0.0.1:3000），可用环境变量覆盖；
 * - **回环任意端口规则**：`http://127.0.0.1:<任意端口>` 与 `http://localhost:<任意端口>`
 *   一并放行。壳静态产物模式（`DFORGE_SHELL_STATIC` / `apps/web/out`）由内置静态服务以
 *   `http://127.0.0.1:<系统分配端口>` 装载产物（apps/desktop/src/main/static-server.ts），
 *   端口不可预知，也没有任何环节把它写进 `DFORGE_CORS_ORIGINS`——没有这条规则，静态模式
 *   一启用，页面内全部 daemon 请求即被 CORS 拦断（证据 §C1）。规则**只**覆盖回环主机，
 *   不放宽到任意 origin（非回环来源仍走显式白名单精确匹配）；
 * - 无 `Origin` 头（curl / Node 客户端 / 同源网关）直接放行——CORS 是浏览器机制，
 *   非浏览器客户端不受影响；
 * - **`Origin: null` 不放行**：`<iframe sandbox>`、`file://`、跨源重定向等上下文浏览器
 *   会真实产出 `Origin: null`——它不是「可伪造才安全」的边角，而是沙箱网页的标准形态，
 *   放行等于对任意网页开门（§A2-5a）。壳也早已弃用 file:// 装载（静态产物经
 *   `http://127.0.0.1:<随机端口>` 装载，见 apps/desktop/src/main/static-server.ts），
 *   「打包壳 = Origin null」的前提已失效；静态模式的跨源配对由上面的回环任意端口规则承担；
 * - **非白名单来源：不加任何 CORS 头（让浏览器自行拒绝），但 API 语义不变**
 *   （服务端照常处理，不引入 403「伪安全」——真正的访问控制边界在回环监听 +
 *   Host 校验（access-control.ts）与未来令牌；「一次性握手 token」登记为后续票）。
 */

import type { FastifyInstance } from 'fastify';

/** 显式白名单默认项（仅本机开发来源；不设 `*`，防任意网页直读本地真值）。 */
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

/**
 * 回环来源主机（壳静态产物模式的来源形态）：仅 `127.0.0.1` / `localhost`。
 *
 * 为什么不是整段 `127.0.0.0/8`：壳只绑定 `127.0.0.1`（apps/desktop/src/main/static-server.ts），
 * 白名单按「实际会出现的来源」取值（从严）；其余 127/8 地址、子域伪装与内网/公网主机都不在规则内。
 */
const LOOPBACK_ORIGIN_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

/**
 * 判断 Origin 是否为「回环主机 + 任意端口」来源（http/https）。
 *
 * `null` 与不可解析值一律 false（沙箱 iframe / file:// 的真实产出不放行，§A2-5a）；
 * 带 userinfo 的畸形值同样拒绝（浏览器不会这样发，拒绝即从严）。
 */
export function isLoopbackOrigin(origin: string): boolean {
  if (origin === 'null') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  return LOOPBACK_ORIGIN_HOSTNAMES.has(url.hostname);
}

/**
 * 创建策略：显式白名单精确匹配（大小写不敏感）+ 回环主机任意端口（壳静态配对）；
 * `null` 与一切白名单外来源不放行。
 */
export function createCorsPolicy(origins: readonly string[] = DEFAULT_CORS_ORIGINS): CorsPolicy {
  const normalized = origins.map((origin) => origin.toLowerCase());
  return {
    origins: [...origins],
    isAllowed(origin: string): boolean {
      if (normalized.includes(origin.toLowerCase())) return true;
      return isLoopbackOrigin(origin);
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
