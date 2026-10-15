/**
 * 组件内部小工具：类名拼接。
 *
 * 为什么不用 clsx/classnames：本包零第三方运行时依赖，
 * 需求只有「过滤 falsy 后空格连接」，自持 5 行即可（_shared §5 不引入规格外依赖）。
 */

/** 拼接类名（忽略 false/null/undefined/空串）。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
