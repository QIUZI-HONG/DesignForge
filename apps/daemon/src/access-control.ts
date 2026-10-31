/**
 * @dforge/daemon · 访问控制（Host 校验 + 上游 baseUrl 收敛）。
 *
 * 依据 test-remediation 票 02 与安全证据 §A2（~/df-evidence/test-2026-10-31/report.md）：
 * - **Host 校验（onRequest，路由前）**：daemon 只应被本机回环访问。DNS rebinding 把
 *   攻击域名解析到 127.0.0.1，同源请求不带 Origin、CORS 挡不住——唯一可靠边界是
 *   校验 `Host` 头本身。非回环 Host 一律 `403 forbidden`（fail closed）；
 *   无 Host 头同样拒绝（HTTP/1.1 客户端必须带，缺 Host 即畸形请求）。
 * - **ai.baseUrl allowlist**：AI 上游携带存储的 DeepSeek key（Bearer）。允许任意
 *   http(s) 地址等于「改一行配置即可把 key 外送」。收敛为 DeepSeek 官方域
 *   （`api.deepseek.com`，仅 https）；越界值在配置入口拒绝（4xx 且不改内存），
 *   磁盘上的历史脏值在 load 时回退默认（不静默继承外送通道）。
 * - **comfy.baseUrl 回环网段**：ComfyUI 是本机服务，收敛为回环（127.0.0.0/8、::1、
 *   localhost），封死把出图请求（含模板与生成结果）打向内网/公网的 SSRF 面。
 *
 * 「一次性握手 token」鉴权机制不在本票范围（登记为后续票）：当前边界 =
 * 回环监听 + Host 校验 + 受控 CORS。
 */

import type { FastifyInstance } from 'fastify';

import { sendFail } from './http.ts';

/** 判断主机名是否本机回环（127.0.0.0/8、::1、localhost；大小写不敏感，容忍 FQDN 尾点）。 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === '::1') return true;
  // 点分十进制严格匹配（不认 127.1 这类八进制/缩写形态——从严）
  return /^127(\.\d{1,3}){3}$/.test(host);
}

/** 判断 Host 头值（可含端口 / IPv6 方括号）是否指向本机回环。 */
export function isLoopbackHostHeader(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value.length === 0) return false;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    // 形如 [::1]:8188；方括号不闭合即畸形
    return end !== -1 && isLoopbackHostname(value.slice(1, end));
  }
  // Host 名内不含冒号（IPv6 必须方括号）；最后一个冒号后是**数字**才算端口——
  // 冒号后非数字（如 localhost:80.evil.example）整串按主机名处理（从严，不留伪装口）
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && !/^\d{1,5}$/.test(value.slice(colon + 1))) {
    return isLoopbackHostname(value);
  }
  return isLoopbackHostname(colon === -1 ? value : value.slice(0, colon));
}

/**
 * 注册 Host 校验钩子（onRequest，早于 CORS 与全部路由）：
 * 非回环 Host / 缺 Host → 403 forbidden 统一信封，请求不进入任何路由。
 */
export function registerHostValidation(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    if (typeof host === 'string' && isLoopbackHostHeader(host)) {
      return;
    }
    return sendFail(reply, 'forbidden', '仅允许本机回环访问（Host 校验失败）');
  });
}

/** AI 上游 allowlist：仅 DeepSeek 官方 API 域（host 精确匹配，默认端口形态）。 */
export const AI_BASE_URL_ALLOWED_HOSTS = ['api.deepseek.com'] as const;

/**
 * 判断 ai.baseUrl 是否在 allowlist 内：
 * - 仅 https（key 以 Bearer 明文头发送，http 等于明文外送）；
 * - host（含显式端口形态）必须精确命中官方域——子域/伪装域/指定端口一律拒绝；
 * - 路径不限（官方域下 `/v1` 等前缀形态均为合法 baseUrl 用法，host 已是信任边界）。
 */
export function isAllowedAiBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  return (AI_BASE_URL_ALLOWED_HOSTS as readonly string[]).includes(url.host.toLowerCase());
}

/** 判断 comfy.baseUrl 是否指向本机回环（http/https 皆可，任意端口）。 */
export function isAllowedComfyBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  // WHATWG URL 会把 127.1 等缩写规范化为点分十进制，这里拿到的是规范化主机名
  return isLoopbackHostname(url.hostname);
}

/** baseUrl 越界时的统一失败构造（配置路由透传 4xx，不改内存）。 */
export function baseUrlRejection(field: 'ai.baseUrl' | 'comfy.baseUrl'): {
  message: string;
  details: Record<string, unknown>;
} {
  if (field === 'ai.baseUrl') {
    return {
      message: `ai.baseUrl 仅允许 DeepSeek 官方域（${AI_BASE_URL_ALLOWED_HOSTS.join('、')}，https）`,
      details: { field },
    };
  }
  return {
    message: 'comfy.baseUrl 仅允许本机回环地址（127.0.0.0/8、::1、localhost）',
    details: { field },
  };
}
