// @vitest-environment jsdom
/**
 * 最近使用命令（localStorage 记忆）行为测试。
 *
 * 断言面板依赖的语义：最新在前、去重前移、上限 5 条、坏值/缺失不炸。
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRecentCommandIds,
  MAX_RECENT,
  pushRecentCommandId,
  RECENT_COMMANDS_STORAGE_KEY,
  readRecentCommandIds,
} from './recent-commands';

afterEach(() => {
  clearRecentCommandIds();
});

describe('最近使用命令', () => {
  it('记录后可按最新在前读回', () => {
    pushRecentCommandId('a');
    pushRecentCommandId('b');
    expect(readRecentCommandIds()).toEqual(['b', 'a']);
  });

  it('重复执行同一命令只前移，不重复入列', () => {
    pushRecentCommandId('a');
    pushRecentCommandId('b');
    pushRecentCommandId('a');
    expect(readRecentCommandIds()).toEqual(['a', 'b']);
  });

  it('超过上限时丢最旧的', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) pushRecentCommandId(id);
    const ids = readRecentCommandIds();
    expect(ids).toHaveLength(MAX_RECENT);
    expect(ids[0]).toBe('f');
    expect(ids).not.toContain('a');
  });

  it('坏值（非 JSON / 非数组 / 混入非字符串）一律安全降级', () => {
    window.localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, '{oops');
    expect(readRecentCommandIds()).toEqual([]);

    window.localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, '{"not":"array"}');
    expect(readRecentCommandIds()).toEqual([]);

    window.localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, '["a",3,null,"b"]');
    expect(readRecentCommandIds()).toEqual(['a', 'b']);
  });

  it('clear 后为空', () => {
    pushRecentCommandId('a');
    clearRecentCommandIds();
    expect(readRecentCommandIds()).toEqual([]);
  });
});
