/**
 * 类名拼装（编辑器壳层内部小工具）。
 *
 * 为什么不从 `@dforge/ui` 取 `cx`：该函数是 ui 包**内部**工具，未随包入口导出
 * （包入口是消费契约，改入口属 FE-01 的目录）。此处按同样的 5 行语义自持，
 * 避免为拼类名引入第三方依赖（_shared §5）。
 */

/** 拼接类名（忽略 false / null / undefined / 空串）。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
