/**
 * 首页 class 名拼接（FE-02）。
 *
 * 为什么自己写一个：`@dforge/ui` 的 `cx` 是包内私有工具（未从包入口导出），
 * 本票只写自己目录（_shared §2），因此在本目录内保留一份等价的极小实现。
 */

/** 拼接 class 名：忽略 false/null/undefined/空串。 */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
