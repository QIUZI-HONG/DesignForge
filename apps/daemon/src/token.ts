/**
 * @dforge/daemon · 本地令牌鉴权（audit-d02 · D-02：daemon 本地特权面收敛）。
 *
 * 缺陷与既证（~/df-evidence/audit-2026-11/baseline/h1-probe.txt）：只监听回环 + Host
 * allowlist + CORS 白名单都不构成访问控制——①`Origin: null`（沙箱 iframe 形态）拿到
 * ACAO + 200 全量文档；②白名单外 Origin 的**写请求照常进业务处理**。回环监听只证明
 * 「请求来自本机」，而本机跑着任意网页与不可信代码；真正的边界是**持有令牌**。
 *
 * 机制（缺省开启）：
 * - daemon 启动时在其数据根确保令牌文件 `<dataRoot>/daemon-token`（0600；已存在则复用，
 *   值为 64 位 hex）；本机文件权限即边界——能读到该文件的进程就是被授权的本机客户端；
 * - 除 `/health`（端点发现握手，前端端口窗探测/门禁判活依赖）与 CORS 预检（OPTIONS +
 *   `access-control-request-method`，预检本身不带自定义头）外，所有路由要求携带令牌：
 *   建议头 `x-df-token`，兼容 `Authorization: Bearer <token>`；
 * - 缺失/错误 → 401 `unauthorized` 统一信封（钩子语义：拒绝发生在 CORS 放行判定**之前**，
 *   401 响应不带任何 CORS 头——白名单外来源连错误体都读不到，令牌闸门在前）；
 * - 逃生阀：env `DF_AUTH_DISABLED=1` 显式关闭（不做令牌文件、不注册钩子；给不需要鉴权的
 *   场景兜底），缺省必须开。
 *
 * 钩子次序（app.ts）：Host allowlist → **令牌** → CORS。令牌在 CORS 之前保证：
 * 「`Origin: null` 恒放行」收敛为「带合法令牌才可能走到 CORS 层」——无令牌的 null 请求
 * 401 且无 ACAO；带合法令牌的 null 请求（打包壳 file:// 形态）保持原有 ACAO 行为。
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { sendFail } from './http.ts';

/** 令牌文件名（固定落在数据根下；路径从 DaemonPaths.daemonTokenPath 派生）。 */
export const TOKEN_FILE_BASENAME = 'daemon-token' as const;

/** 逃生阀环境变量：`DF_AUTH_DISABLED=1` 显式关闭本地令牌鉴权。 */
export const AUTH_DISABLED_ENV = 'DF_AUTH_DISABLED' as const;

/** 令牌请求头（建议形态；CORS_ALLOWED_HEADERS 已登记，浏览器跨源可携带）。 */
export const TOKEN_HEADER = 'x-df-token' as const;

/** 兼容形态前缀（`Authorization: Bearer <token>`，大小写不敏感）。 */
const BEARER_PREFIX = 'bearer ' as const;

/** 读逃生阀（只认 `1`——显式开启才关，缺省恒为鉴权开启）。 */
export function authDisabledFromEnv(env: Record<string, string | undefined>): boolean {
  return env[AUTH_DISABLED_ENV] === '1';
}

/** 权限收紧（writeFile 的 mode 只在创建时生效；放宽态用 chmod 收回 0600）。 */
async function tightenPermissions(tokenPath: string): Promise<void> {
  try {
    const info = await stat(tokenPath);
    if ((info.mode & 0o077) !== 0) {
      await chmod(tokenPath, 0o600);
    }
  } catch {
    // 核验失败不影响主路径：令牌已写、权限已按 0600 申请
  }
}

/**
 * 确保令牌文件存在并返回令牌值（幂等：已存在则复用，绝不重置——重置会踢掉所有在线客户端）。
 * 文件 0600：只有本机同用户进程可读；目录缺省递归创建（与凭据库同根语义）。
 * 空文件/全空白视为损坏态：重建（0600 重写），避免「令牌恒为空串」形同虚设。
 * 并发创建容错：EEXIST 竞态（另一实例先写入）直接复读既有值。
 */
export async function ensureTokenFile(tokenPath: string): Promise<string> {
  let recreate = false;
  try {
    const existing = (await readFile(tokenPath, 'utf8')).trim();
    if (existing.length > 0) {
      await tightenPermissions(tokenPath); // 复用同样保证 0600（外部 chmod 放宽态收回）
      return existing;
    }
    recreate = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(tokenPath), { recursive: true });
  // 0600：本机文件权限即边界（模块头注释）；竞态（另一实例已建）则复读既有值
  try {
    await writeFile(tokenPath, `${token}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: recreate ? 'w' : 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = (await readFile(tokenPath, 'utf8')).trim();
    if (raced.length === 0) throw new Error('令牌文件竞态写入失败（读到空值）');
    return raced;
  }
  await tightenPermissions(tokenPath);
  return token;
}

/**
 * 从请求头提取令牌（`x-df-token` 优先，其次 `Authorization: Bearer`）。
 * 都没有 → null（缺失）；有但形态怪异原样返回（交给常量比较判假）。
 */
export function extractPresentedToken(headers: Record<string, unknown>): string | null {
  const direct = headers[TOKEN_HEADER];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const authorization = headers.authorization;
  if (typeof authorization === 'string') {
    const lowered = authorization.toLowerCase();
    if (lowered.startsWith(BEARER_PREFIX)) {
      const token = authorization.slice(BEARER_PREFIX.length).trim();
      return token.length > 0 ? token : null;
    }
  }
  return null;
}

/** 令牌策略（可注入测试）。 */
export interface TokenPolicy {
  /** 期望令牌（常量时间比较在量级上无意义——本机文件读取方即授权方——用普通比较并集中判空）。 */
  token: string;
  isPresented(request: { headers: Record<string, unknown> }): string | null;
  isAuthorized(request: { headers: Record<string, unknown> }): boolean;
}

/** 创建策略：请求头形态解析 + 常量比较。 */
export function createTokenPolicy(token: string): TokenPolicy {
  return {
    token,
    isPresented: (request) => extractPresentedToken(request.headers),
    isAuthorized(request) {
      const presented = extractPresentedToken(request.headers);
      return presented !== null && presented === token;
    },
  };
}

/**
 * 注册令牌鉴权钩子（onRequest，Host allowlist 之后、CORS 之前）：
 * - 鉴权关闭 → 不注册（调用方判定）；
 * - `/health`（GET/HEAD 皆豁免）与 CORS 预检（OPTIONS + `access-control-request-method`）放行；
 * - 其余请求无令牌/错令牌 → 401 `unauthorized` 统一信封，短路路由（CORS 钩子不再执行，
 *   401 响应不带 ACAO——非白名单来源的浏览器连错误体都读不到）。
 */
export function registerTokenGuard(app: FastifyInstance, policy: TokenPolicy): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url.split('?')[0] === '/health') {
      return;
    }
    const requestedMethod = request.headers['access-control-request-method'];
    if (request.method === 'OPTIONS' && typeof requestedMethod === 'string') {
      return; // CORS 预检：不带自定义头，交由 CORS 钩子 204 短路
    }
    if (policy.isAuthorized(request)) {
      return;
    }
    return sendFail(
      reply,
      'unauthorized',
      '缺少本地访问令牌（daemon 已开启令牌鉴权）：请携带 x-df-token 头，或由宿主（壳/CLI）从数据根 daemon-token 文件读取后注入。',
    );
  });
}
