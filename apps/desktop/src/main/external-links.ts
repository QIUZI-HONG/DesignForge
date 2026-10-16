/**
 * 壳内外链决策 —— `setWindowOpenHandler` / `will-navigate` 共用的白名单口径。
 *
 * 为什么单列一个纯决策模块：窗口打开策略是安全边界，必须可被单测钉死（含仿冒域、非 https、
 * 畸形 URL 的反例）；主进程只做「把 URL 交给决策 → 放行时 shell.openExternal」的翻译层。
 *
 * 口径（票面）：**默认拒绝**外部窗口；仅白名单域的 https 外链转交系统浏览器打开。
 */

/**
 * 外链白名单——唯一扩展点（新增对外入口即改这里，并由本模块测试约束）。
 * 本段仅需仓库入口：Issue / 文档 / 源码都在 GitHub。
 */
export const EXTERNAL_LINK_ALLOWLIST = ['github.com'] as const;

/** 外链决策：`allow-external` 表示转交系统浏览器；`deny` 表示原地拒绝新的窗口/导航。 */
export type ExternalLinkDecision = { action: 'allow-external'; url: string } | { action: 'deny' };

/** 主机是否落在白名单域（精确相等或其子域——防「白名单域作后缀」的仿冒）。 */
function isAllowlistedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return EXTERNAL_LINK_ALLOWLIST.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** 是否属于「允许转交系统浏览器」的外链（https + 白名单域）。 */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  return decideExternalOpen(rawUrl).action === 'allow-external';
}

/**
 * 判定一个 URL 的处理方式。
 *
 * 拒绝面：非 https、非白名单域、白名单域仿冒、畸形 URL（解析失败不乱抛）。
 */
export function decideExternalOpen(rawUrl: string): ExternalLinkDecision {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { action: 'deny' };
  }

  if (parsed.protocol !== 'https:') {
    return { action: 'deny' };
  }
  if (!isAllowlistedHost(parsed.hostname)) {
    return { action: 'deny' };
  }
  return { action: 'allow-external', url: parsed.toString() };
}

/** 页内导航决策：放行 / 转系统浏览器 / 原地拒绝。 */
export type InPageNavigationDecision = 'allow' | 'open-external' | 'deny';

/**
 * 页内 `will-navigate` 口径。
 *
 * 为什么需要：`setWindowOpenHandler` 只管「新窗口」，页内整页跳转（window.location / `<a href>`）
 * 走 `will-navigate`——若只拦新窗口，页内跨源跳转会把壳变成任意网页容器。
 * 同源导航必须放行（壳内应用自身跳转、devtools 面板），跨源白名单外链转系统浏览器，其余拒绝。
 */
export function decideInPageNavigation(targetUrl: string, url: string): InPageNavigationDecision {
  const urlModule: string = url.split('/')[0] ?? '';
  if (urlModule === 'devtools:') {
    return 'allow';
  }

  let target: URL;
  let next: URL;
  try {
    target = new URL(targetUrl);
    next = new URL(url);
  } catch {
    return 'deny';
  }

  // file: 装载（回退诊断页）下无 origin 可言，按「同协议 + 同路径」判同源。
  if (target.protocol === 'file:' || next.protocol === 'file:') {
    return target.protocol === next.protocol && target.pathname === next.pathname
      ? 'allow'
      : 'deny';
  }

  if (target.origin === next.origin) {
    return 'allow';
  }

  return decideExternalOpen(url).action === 'allow-external' ? 'open-external' : 'deny';
}
