/**
 * 规范序列化（确定性哈希的基础设施）。
 *
 * 用途：快照自证哈希、重建一致性比对、证据 JSON 的产物摘要。
 * 口径：对象键按码点升序、数组保序、`undefined` 视为缺省（不写）、数字用 JSON 原样。
 * 理由：同一语义对象必须有唯一字节表示，否则「同输入同输出」（规格 §4.3.2）不可断言。
 */

/** 递归按键序规范化的 JSON 文本。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      sorted[key] = sortValue(item);
    }
    return sorted;
  }
  return value;
}
