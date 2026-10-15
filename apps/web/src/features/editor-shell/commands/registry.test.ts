/**
 * 命令注册表（冻结接口 ①）行为测试。
 *
 * 断言的是**对外契约**（briefs/fe-03.md §2 的冻结签名 + 模块头声明的语义），
 * 不碰内部结构：FE-06/07/08 依赖的正是这些约定。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canRunCommand,
  type Command,
  commandRegistry,
  getCommand,
  registerCommand,
  resetCommandRegistry,
  runCommand,
  subscribeCommands,
} from './registry';

/** 造一条最小命令。 */
function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.noop',
    title: '测试命令',
    group: '测试',
    run: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  resetCommandRegistry();
});

describe('commandRegistry（冻结接口）', () => {
  it('register 后 list 能取到，反注册后移除', () => {
    const unregister = commandRegistry.register(makeCommand({ id: 'a' }));
    expect(commandRegistry.list().map((cmd) => cmd.id)).toEqual(['a']);

    unregister();
    expect(commandRegistry.list()).toEqual([]);
  });

  it('反注册幂等（重复调用不报错、不误删后来者）', () => {
    const unregister = commandRegistry.register(makeCommand({ id: 'a' }));
    unregister();
    unregister();
    commandRegistry.register(makeCommand({ id: 'a', title: '后来的' }));
    unregister();
    expect(getCommand('a')?.title).toBe('后来的');
  });

  it('同 id 后注册者覆盖前者，位置停在首次注册处（last wins）', () => {
    commandRegistry.register(makeCommand({ id: 'a' }));
    commandRegistry.register(makeCommand({ id: 'b' }));
    commandRegistry.register(makeCommand({ id: 'a', title: '新的实现' }));

    const list = commandRegistry.list();
    expect(list.map((cmd) => cmd.id)).toEqual(['a', 'b']);
    expect(getCommand('a')?.title).toBe('新的实现');
  });

  it('list 返回快照副本：调用方改动不污染注册表', () => {
    commandRegistry.register(makeCommand({ id: 'a' }));
    const snapshot = commandRegistry.list();
    snapshot.push(makeCommand({ id: 'b' }));
    snapshot.length = 0;
    expect(commandRegistry.list().map((cmd) => cmd.id)).toEqual(['a']);
  });

  it('registerCommand 便捷封装与 commandRegistry.register 等价', () => {
    const unregister = registerCommand(makeCommand({ id: 'c' }));
    expect(getCommand('c')).toBeDefined();
    unregister();
    expect(getCommand('c')).toBeUndefined();
  });

  it('可以注册多条命令且保持注册顺序', () => {
    commandRegistry.register(makeCommand({ id: 'a' }));
    commandRegistry.register(makeCommand({ id: 'b' }));
    commandRegistry.register(makeCommand({ id: 'c' }));
    expect(commandRegistry.list().map((cmd) => cmd.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('runCommand / canRunCommand', () => {
  it('未注册的 id 不可运行且返回 false', async () => {
    expect(canRunCommand('nope')).toBe(false);
    await expect(runCommand('nope')).resolves.toBe(false);
  });

  it('enabled() 判否 → 不执行、返回 false', async () => {
    const run = vi.fn();
    registerCommand(makeCommand({ id: 'a', enabled: () => false, run }));
    expect(canRunCommand('a')).toBe(false);
    await expect(runCommand('a')).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('enabled() 判是 → 执行并返回 true', async () => {
    const run = vi.fn();
    registerCommand(makeCommand({ id: 'a', enabled: () => true, run }));
    await expect(runCommand('a')).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('缺省 enabled 视为可运行', async () => {
    registerCommand(makeCommand({ id: 'a' }));
    await expect(runCommand('a')).resolves.toBe(true);
  });

  it('异步命令等其结算（面板据此记录「最近使用」）', async () => {
    const order: string[] = [];
    registerCommand(
      makeCommand({
        id: 'slow',
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          order.push('run');
        },
      }),
    );
    await runCommand('slow');
    order.push('after');
    expect(order).toEqual(['run', 'after']);
  });

  it('命令抛错原样冒泡（呈现责任归调用方）', async () => {
    registerCommand(
      makeCommand({
        id: 'boom',
        run: () => {
          throw new Error('炸了');
        },
      }),
    );
    await expect(runCommand('boom')).rejects.toThrow('炸了');
  });
});

describe('subscribeCommands', () => {
  it('注册与反注册都会通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommands(listener);

    const unregister = registerCommand(makeCommand({ id: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registerCommand(makeCommand({ id: 'b' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
