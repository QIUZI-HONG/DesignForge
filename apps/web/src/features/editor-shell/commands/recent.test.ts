// @vitest-environment jsdom
/**
 * 最近执行命令的本地记录（票 04 · spec P0-4「最近使用」的数据层）。
 *
 * 口径：
 * - 记录挂在 `executeCommand`（全部执行路径的统一漏斗：面板/全局快捷键/菜单/工具条），
 *   只有**真的执行了**（`ran`）才记；`unavailable` / `failed` 不算「用过」；
 * - 面板开关命令（`view.commandPalette`）**不进记录**——呼出面板是「容器」交互，
 *   不是用户完成的一件工作（否则每次 ⌘K 都把「命令面板」顶到最近序，噪声）；
 * - 本地优先，不联网：localStorage，隐私模式/配额满等写入失败静默（增强能力，
 *   不得阻塞命令执行本身）；损坏数据按空处理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeCommand } from './execute';
import {
  loadRecentCommands,
  RECENT_COMMAND_LIMIT,
  recordRecentCommand,
  resetRecentCommands,
  saveRecentCommands,
} from './recent';
import { registerCommand, resetCommandRegistry } from './registry';

beforeEach(() => {
  resetCommandRegistry();
  resetRecentCommands();
});

afterEach(() => {
  resetCommandRegistry();
  resetRecentCommands();
  vi.restoreAllMocks();
});

describe('recordRecentCommand（纯函数：去重 + 上限 + 最近序）', () => {
  it('新命令插到最前（最近序）', () => {
    expect(recordRecentCommand(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('重复执行去重并提到最前（不产生重复条目）', () => {
    expect(recordRecentCommand(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('超出上限丢弃最旧的（保留最近 5 条）', () => {
    const next = recordRecentCommand(['a', 'b', 'c', 'd', 'e'], 'f');
    expect(next).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(next).toHaveLength(RECENT_COMMAND_LIMIT);
  });
});

describe('localStorage 读写', () => {
  it('save 后 load 原样返回；未写入时为空', () => {
    expect(loadRecentCommands()).toEqual([]);
    saveRecentCommands(['a', 'b']);
    expect(loadRecentCommands()).toEqual(['a', 'b']);
  });

  it('损坏数据（非 JSON / 非 string 数组）按空处理，不抛错', () => {
    window.localStorage.setItem('dfg.editor-shell.recent-commands', '{not json');
    expect(loadRecentCommands()).toEqual([]);
    window.localStorage.setItem(
      'dfg.editor-shell.recent-commands',
      JSON.stringify(['ok', 1, null]),
    );
    expect(loadRecentCommands()).toEqual(['ok']);
  });

  it('写入失败静默（隐私模式口径：记录是增强能力，不阻塞执行）', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveRecentCommands(['a'])).not.toThrow();
    setItem.mockRestore();
  });
});

describe('executeCommand 记录（统一漏斗）', () => {
  it('执行成功（ran）→ 记录；重复执行去重、最近序', async () => {
    registerCommand({ id: 'tool.rect', title: '矩形', group: '工具', run: () => undefined });
    registerCommand({ id: 'tool.text', title: '文本', group: '工具', run: () => undefined });

    await executeCommand('tool.rect');
    await executeCommand('tool.text');
    await executeCommand('tool.rect');
    expect(loadRecentCommands()).toEqual(['tool.rect', 'tool.text']);
  });

  it('unavailable（未注册/置灰）与 failed 不记录', async () => {
    registerCommand({
      id: 'boom',
      title: '炸',
      group: '工具',
      run: () => {
        throw new Error('炸了');
      },
    });
    registerCommand({
      id: 'grey',
      title: '灰',
      group: '工具',
      enabled: () => false,
      run: () => undefined,
    });

    await executeCommand('missing');
    await executeCommand('grey');
    await executeCommand('boom');
    expect(loadRecentCommands()).toEqual([]);
  });

  it('面板开关命令不进记录（呼出面板不是「用过一条命令」）', async () => {
    registerCommand({
      id: 'view.commandPalette',
      title: '命令面板',
      group: '视图',
      run: () => undefined,
    });
    await executeCommand('view.commandPalette');
    expect(loadRecentCommands()).toEqual([]);
  });
});
