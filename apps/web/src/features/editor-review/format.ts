/**
 * 时间戳格式化（评论 / 版本列表共用）——纯函数。
 *
 * 为什么自己格式化而不是 `toLocaleString`：界面语言唯一暴露为 zh-CN（ADR-0003），
 * 而 `toLocaleString` 的输出受宿主 ICU 版本影响（不同 Node/浏览器可能不一致），
 * 门禁截图与测试都会因此抖动。固定格式「YYYY/MM/DD HH:mm」（本地时区）稳定可比。
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const ymd = [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('/');
  const hm = [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return `${ymd} ${hm}`;
}
