/**
 * CLI 参数解析测试（四子命令共用的 `args.ts` 外部行为）。
 *
 * 断言：取值选项 / 布尔开关 / `--help`；未知选项与缺值必须报错（禁止静默忽略参数）。
 */

import { describe, expect, it } from 'vitest';
import { CliUsageError, intOption, listOption, parseArgv } from './args.ts';

describe('parseArgv', () => {
  it('取值选项与布尔开关：--data x --stars-history', () => {
    const parsed = parseArgv(['--data', 'data-x', '--limit', '40', '--stars-history'], {
      value: ['data', 'limit'],
      flags: ['stars-history'],
    });
    expect(parsed.value('data')).toBe('data-x');
    expect(parsed.value('limit')).toBe('40');
    expect(parsed.flag('stars-history')).toBe(true);
    expect(parsed.flag('nope')).toBe(false);
    expect(parsed.help).toBe(false);
  });

  it('--help / -h 置位；未知选项与缺值抛用法错误', () => {
    expect(parseArgv(['--help'], {}).help).toBe(true);
    expect(parseArgv(['-h'], {}).help).toBe(true);
    expect(() => parseArgv(['--wat'], { value: ['data'] })).toThrow(CliUsageError);
    expect(() => parseArgv(['--data'], { value: ['data'] })).toThrow(/缺参数值/);
    expect(() => parseArgv(['stray'], {})).toThrow(/位置参数/);
  });

  it('intOption：非法值抛错、缺省回退、正整数字符串解析', () => {
    const parsed = parseArgv(['--limit', '40'], { value: ['limit'] });
    expect(intOption(parsed, 'limit', null)).toBe(40);
    expect(intOption(parsed, 'missing', 7)).toBe(7);
    const bad = parseArgv(['--limit', '0'], { value: ['limit'] });
    expect(() => intOption(bad, 'limit', null)).toThrow(/正整数/);
  });

  it('listOption：逗号分隔去空白；缺省 null', () => {
    const parsed = parseArgv(['--seeds', 'a/b, c/d ,,e/f'], { value: ['seeds'] });
    expect(listOption(parsed, 'seeds')).toEqual(['a/b', 'c/d', 'e/f']);
    expect(listOption(parsed, 'topics')).toBeNull();
  });
});
