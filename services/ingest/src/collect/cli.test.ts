/**
 * CLI 测试（独立可跑形态；规格《市场首实现》§2.2 + §6.1 退出码）。
 */

import { describe, expect, it } from 'vitest';

import { CliUsageError, defaultOutDir, main, parseArgs, runIdOf, USAGE } from './cli.ts';

describe('parseArgs', () => {
  it('默认值：~/df-evidence/mk-01 + 8 个 topic + 双排序', () => {
    const opts = parseArgs([]);
    expect(opts.outDir).toBe(defaultOutDir());
    expect(opts.outDir.endsWith('df-evidence/mk-01')).toBe(true);
    expect(opts.topics).toHaveLength(8);
    expect(opts.sorts).toEqual(['stars', 'updated']);
    expect(opts.limit).toBeNull();
  });

  it('首批小跑参数：--limit 5 --seeds … --topics none', () => {
    const opts = parseArgs([
      '--limit',
      '5',
      '--seeds',
      'anthropics/skills,nexu-io/open-design',
      '--topics',
      'none',
      '--max-content',
      '8',
      '--out',
      '/tmp/x',
    ]);
    expect(opts.limit).toBe(5);
    expect(opts.seeds).toEqual(['anthropics/skills', 'nexu-io/open-design']);
    expect(opts.topics).toEqual([]);
    expect(opts.maxContentPerRepo).toBe(8);
    expect(opts.outDir).toBe('/tmp/x');
  });

  it('非法参数抛 CliUsageError（未知选项/缺值/非正数）', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--limit'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--limit', '0'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--sorts', 'nope'])).toThrow(CliUsageError);
  });

  it('runIdOf 由 asOf 生成（YYYYMMDD-HHmmss）', () => {
    expect(runIdOf(Date.parse('2026-10-15T22:01:33Z'))).toBe('20261015-220133');
  });
});

describe('main 退出码语义', () => {
  it('--help → 0 且打印用法', async () => {
    const lines: string[] = [];
    const code = await main(['--help'], (l) => lines.push(l));
    expect(code).toBe(0);
    expect(lines.join('\n')).toBe(USAGE);
  });

  it('参数错误 → 2（未进入可判定状态，禁止假绿）', async () => {
    const lines: string[] = [];
    const code = await main(['--nope'], (l) => lines.push(l));
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('参数错误');
  });
});
