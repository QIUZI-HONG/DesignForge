/**
 * 表单校验（FE-09）。
 *
 * 边界口径：前端只做**形态**校验（空值 / 明显非法），错误以枚举码返回
 * （文案归 i18n）；可写性、路径归一（展开 `~`、resolve）由 daemon 做权威判定，
 * 前端不越权猜目录（daemon 的拒绝文案原样展示，见保存态机）。
 */

/** 字段错误码（→ i18n 文案映射见组件层）。 */
export type FieldErrorCode = 'empty' | 'invalid-url';

/** 工作目录：空与纯空白拒。 */
export function validateWorkspaceDir(value: string): FieldErrorCode | null {
  return value.trim().length === 0 ? 'empty' : null;
}

/** ComfyUI 地址：空拒；必须 http(s)（本地回环是常态，但写法必须合法 URL）。 */
export function validateComfyBaseUrl(value: string): FieldErrorCode | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'empty';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'invalid-url';
  } catch {
    return 'invalid-url';
  }
}
