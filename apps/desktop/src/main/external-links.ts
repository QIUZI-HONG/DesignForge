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
