/**
 * 首页时间与体积格式（FE-02）。
 *
 * 纪律（_shared §3：界面文案全走 ICU 消息）：本模块**只产出数值与单位**，
 * 不产出任何中文文案——「刚刚 / N 分钟前 / N 天前」等措辞由组件用 ICU 消息拼。
 */

/** 相对时间描述（单位 + 数值；`date` 单位表示超出相对窗口，交组件按日期渲染）。 */
export type RelativeTime =
  | { unit: 'now' }
  | { unit: 'minute'; value: number }
  | { unit: 'hour'; value: number }
  | { unit: 'day'; value: number }
  | { unit: 'date'; value: Date };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 把 ISO 时间转成相对描述。
 *
 * 边界（对外行为）：< 1 分钟 → now；< 1 小时 → minute；< 24 小时 → hour；
 * < 7 天 → day；再往前（或解析失败、未来时间）→ date（按绝对日期展示）。
 */
export function describeRelativeTime(iso: string, now: Date): RelativeTime {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { unit: 'date', value: now };
  const delta = now.getTime() - then.getTime();
  if (delta < 0) return { unit: 'date', value: then };
  if (delta < MINUTE_MS) return { unit: 'now' };
  if (delta < HOUR_MS) return { unit: 'minute', value: Math.floor(delta / MINUTE_MS) };
  if (delta < DAY_MS) return { unit: 'hour', value: Math.floor(delta / HOUR_MS) };
  if (delta < 7 * DAY_MS) return { unit: 'day', value: Math.floor(delta / DAY_MS) };
  return { unit: 'date', value: then };
}

/** 体积单位（数值格式，非文案）。 */
export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB';

/** 体积数值 + 单位（组件自行拼「1.2 MB」这类不含中文的展示串）。 */
export interface ByteSize {
  value: number;
  unit: ByteUnit;
}

const BYTE_UNITS: ByteUnit[] = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 字节数 → 人类可读体积（1 位小数；按 1024 进位，上限 TB）。 */
export function describeByteSize(bytes: number): ByteSize {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: 0, unit: 'B' };
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return { value: rounded, unit: BYTE_UNITS[unitIndex] ?? 'B' };
}
