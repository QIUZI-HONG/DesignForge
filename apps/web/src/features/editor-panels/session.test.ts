/**
 * 面板会话测试（seam：会话的公开动作——命令栈唯一写入口的薄包装 + 稳定订阅面）。
 *
 * 关键断言：面板从不直接改文档对象，一切写入都经 `CommandStack`（撤销/重做因此天然可用）；
 * 订阅面用稳定引用的 `subscribe` / `getSnapshot`，直接喂 `useSyncExternalStore`。
 */
import { createDocument, createPage, createRect, getChildrenIds } from '@dforge/engine';
import { describe, expect, it, vi } from 'vitest';

import { createPanelsSession } from './session';

describe('面板会话（引擎适配）', () => {
  it('默认会话：带一个空页面的文档，pageId 指向首页，UI store 就绪', () => {
    const session = createPanelsSession();
    expect(session.stack.document.pages).toHaveLength(1);
    expect(session.pageId).toBe(session.stack.document.pages[0]?.id);
    expect(session.ui.getState().selection).toEqual({ ids: [], activeId: null });
  });

  it('可注入现成命令栈（壳层提供文档，面板只消费）', () => {
    const doc = createDocument({
      id: 'd1',
      pages: [createPage({ id: 'p1' }), createPage({ id: 'p2', name: '第二页' })],
    });
    const session = createPanelsSession({ document: doc, pageId: 'p2' });
    expect(session.pageId).toBe('p2');
    expect(session.page().name).toBe('第二页');
  });

  it('run：命令经命令栈生效并通知订阅者（新文档对象）', () => {
    const session = createPanelsSession();
    const listener = vi.fn();
    session.subscribe(listener);

    const before = session.getSnapshot();
    session.run(
      {
        type: 'node.insert',
        pageId: session.pageId,
        node: createRect({ id: 'n1' }),
        parentId: null,
      },
      '新建矩形',
    );

    expect(getChildrenIds(session.page(), null)).toEqual(['n1']);
    expect(session.getSnapshot()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('run：写入进历史栈（撤销入口真实可用）', () => {
    const session = createPanelsSession();
    session.run(
      {
        type: 'node.insert',
        pageId: session.pageId,
        node: createRect({ id: 'n1' }),
        parentId: null,
      },
      '新建矩形',
    );
    expect(session.stack.canUndo).toBe(true);
    expect(session.stack.history().undo).toEqual(['新建矩形']);
    expect(session.stack.undo()).toBe(true);
    expect(getChildrenIds(session.page(), null)).toEqual([]);
  });

  it('run：空命令列表是无操作（不写历史、不通知）', () => {
    const session = createPanelsSession();
    const listener = vi.fn();
    session.subscribe(listener);
    const before = session.getSnapshot();
    session.run([], '空操作');
    expect(session.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(session.stack.canUndo).toBe(false);
  });

  it('订阅可退订：退订后不再收到文档变更（React 侧卸载不泄漏）', () => {
    const session = createPanelsSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.run(
      {
        type: 'node.insert',
        pageId: session.pageId,
        node: createRect({ id: 'n1' }),
        parentId: null,
      },
      '新建矩形',
    );
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    session.run({ type: 'node.remove', pageId: session.pageId, nodeId: 'n1' }, '删除');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
