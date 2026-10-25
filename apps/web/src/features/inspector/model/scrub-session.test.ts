/**
 * scrubbing 交互会话（RW-10 · 与画布拖拽同语义）规格。
 *
 * 会话纪律（引擎 interaction 层 begin → update × N → commit 的同构表达）：
 * 1. 会话开启（拖拽中）**不写文档**——commit 之前零命令、零历史；
 * 2. 松手 commit 把整段修改表达为**一次事务**（一条历史条目 → 撤销一步回退）；
 * 3. end/cancel 关会话零写入；未开会话的 commit 是普通提交（键入路径不经过会话）。
 */

import { CommandStack, createDocument, createPage, createRect } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { setNumberCommands } from './patches';
import { createScrubSession } from './scrub-session';

/** 单矩形文档（x=10）。 */
function makeStack() {
  const rect = createRect({ id: 'r1', x: 10, y: 20, width: 100, height: 50 });
  const page = createPage({ id: 'p1', rootIds: ['r1'], nodes: { r1: rect } });
  return new CommandStack(createDocument({ id: 'd1', pages: [page] }));
}

describe('createScrubSession（拖拽会话 = 拖拽中零写入，松手单事务）', () => {
  it('会话中 commit：一次事务落命令并闭会话（撤销一步回退）', () => {
    const stack = makeStack();
    const session = createScrubSession(stack);

    session.begin();
    expect(session.active).toBe(true);
    expect(stack.history().undo).toHaveLength(0); // 拖拽中零写入

    const page = stack.document.pages[0];
    if (page === undefined) throw new Error('夹具缺失');
    session.commit(setNumberCommands(page, 'p1', ['r1'], 'x', 42), '位置');

    expect(session.active).toBe(false);
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(42);
    expect(stack.history().undo).toHaveLength(1); // 松手单事务
    expect(stack.history().undo[0]).toBe('位置');

    expect(stack.undo()).toBe(true);
    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(10); // 撤销一步回退
  });

  it('会话中 end（值未变化即松手）：零命令、零历史', () => {
    const stack = makeStack();
    const session = createScrubSession(stack);

    session.begin();
    session.end();
    expect(session.active).toBe(false);
    expect(stack.history().undo).toHaveLength(0);
  });

  it('未开会话的 commit 是普通提交（键入路径不经过会话括约）', () => {
    const stack = makeStack();
    const session = createScrubSession(stack);
    expect(session.active).toBe(false);

    const page = stack.document.pages[0];
    if (page === undefined) throw new Error('夹具缺失');
    session.commit(setNumberCommands(page, 'p1', ['r1'], 'x', 7), '位置');

    expect(stack.document.pages[0]?.nodes.r1?.x).toBe(7);
    expect(stack.history().undo).toHaveLength(1);
  });

  it('空命令 commit：不写历史（无变化不进撤销栈）', () => {
    const stack = makeStack();
    const session = createScrubSession(stack);
    session.begin();
    session.commit([], '位置');
    expect(stack.history().undo).toHaveLength(0);
    expect(session.active).toBe(false);
  });

  it('begin 重复开启是编程错误（上一会话未收口即重开）', () => {
    const stack = makeStack();
    const session = createScrubSession(stack);
    session.begin();
    expect(() => session.begin()).toThrow();
  });
});
