/**
 * 时间戳格式化测试（seam：`format.ts`）。
 *
 * 断言口径：固定格式「YYYY/MM/DD HH:mm」**本地时区**、零填充、非法输入回退原串
 * （面板宁可显示原值也不显示 Invalid Date）。
 */
import { describe, expect, it } from 'vitest';
import { formatTimestamp } from './format';

describe('时间戳格式化', () => {
  it('按本地时区零填充到「YYYY/MM/DD HH:mm」', () => {
    const iso = '2026-10-15T10:05:00.000Z';
    const date = new Date(iso);
    const expected = [
      String(date.getFullYear()).padStart(4, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('/');
    const time = [date.getHours(), date.getMinutes()]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    expect(formatTimestamp(iso)).toBe(`${expected} ${time}`);
  });

  it('格式恒为「四位年」+「两位月日时分」', () => {
    expect(formatTimestamp('2026-01-02T03:04:00.000Z')).toMatch(
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
    );
  });

  it('非法输入回退原串（不出现 Invalid Date）', () => {
    expect(formatTimestamp('不是时间')).toBe('不是时间');
    expect(formatTimestamp('')).toBe('');
  });
});
