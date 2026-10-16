/**
 * 剪贴板小工具（FE-09）。
 *
 * 为什么单独成文件：`navigator.clipboard` 在非安全上下文/旧环境可能缺失，
 * 复制动作要能失败得**有说法**（Toast 提示手动复制），而不是静默吞错。
 */
/**
 * 复制文本到剪贴板。
 *
 * @returns 成功 true；环境不支持或写入被拒 false（调用方据此提示手动复制）。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
