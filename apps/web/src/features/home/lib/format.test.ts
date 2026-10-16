/**
 * 首页格式工具测试（FE-02）。
 *
 * 断言口径：纯函数对外行为 + 边界值（阈值两侧），不测内部实现。
 * 期望值来自规格（60s/1h/24h/7d 分档、1024 进位）而非复算实现。
 */
import { describe, expect, it } from 'vitest';

import { describeByteSize, describeRelativeTime } from './format';

const NOW = new Date('2026-10-15T12:00:00.000Z');

/** NOW 往前 offsetMs 的 ISO 串（构造测试输入，不是期望值来源）。 */
function before(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

describe('describeRelativeTime', () => {
  it('1 分钟内 → now', () => {
    expect(describeRelativeTime(before(59_000), NOW)).toEqual({ unit: 'now' });
  });

  it('满 1 分钟 → minute（阈值边界）', () => {
    expect(describeRelativeTime(before(60_000), NOW)).toEqual({ unit: 'minute', value: 1 });
  });

  it('47 分钟 → minute 47', () => {
    expect(describeRelativeTime(before(47 * 60_000), NOW)).toEqual({ unit: 'minute', value: 47 });
  });

  it('满 1 小时 → hour（不再回落到 minute）', () => {
    expect(describeRelativeTime(before(60 * 60_000), NOW)).toEqual({ unit: 'hour', value: 1 });
  });

  it('满 24 小时 → day', () => {
    expect(describeRelativeTime(before(24 * 60 * 60_000), NOW)).toEqual({ unit: 'day', value: 1 });
  });

  it('满 7 天 → 绝对日期', () => {
    const result = describeRelativeTime(before(7 * 24 * 60 * 60_000), NOW);
    expect(result.unit).toBe('date');
  });

  it('未来时间与非法字符串 → 绝对日期（不抛错）', () => {
    expect(describeRelativeTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW).unit).toBe(
      'date',
    );
    expect(describeRelativeTime('不是时间', NOW).unit).toBe('date');
  });
});

describe('describeByteSize', () => {
  it('小于 1KB 显示字节且取整', () => {
    expect(describeByteSize(512)).toEqual({ value: 512, unit: 'B' });
  });

  it('1024 字节进位到 KB', () => {
    expect(describeByteSize(1024)).toEqual({ value: 1, unit: 'KB' });
  });

  it('KB→MB 进位并保留 1 位小数', () => {
    expect(describeByteSize(1024 * 1024 * 1.25)).toEqual({ value: 1.3, unit: 'MB' });
  });

  it('大体积进位到 TB（单位不再超出）', () => {
    expect(describeByteSize(1024 ** 4 * 3)).toEqual({ value: 3, unit: 'TB' });
  });

  it('零与负值 → 0 B', () => {
    expect(describeByteSize(0)).toEqual({ value: 0, unit: 'B' });
    expect(describeByteSize(-10)).toEqual({ value: 0, unit: 'B' });
  });
});
