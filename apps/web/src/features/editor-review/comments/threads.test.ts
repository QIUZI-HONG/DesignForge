/**
 * 评论线程状态机测试（seam：`threads.ts` 的纯函数对外行为）。
 *
 * 断言口径（briefs/fe-07.md §2）：新建 / 回复 / 解决 / 折叠（分组）；解决态不可再编辑。
 * 期望值来自规则本身（空正文拒绝、解决态拒绝回复、新→旧排序），不重算实现。
 */
import { describe, expect, it } from 'vitest';
import {
  CommentError,
  type CommentThread,
  createThread,
  groupThreads,
  isEditable,
  isValidBody,
  reopenThread,
  replaceThread,
  replyCount,
  replyToThread,
  resolveThread,
  threadsOfPage,
} from './threads';

function thread(id: string, createdAt: string, resolved = false): CommentThread {
  return {
    id,
    pageId: 'page-1',
    anchor: { x: 10, y: 20 },
    author: '小林',
    body: `评论 ${id}`,
    createdAt,
    resolved,
    replies: [],
  };
}

describe('评论线程 · 新建', () => {
  it('新建的线程未解决、无回复，正文去掉首尾空白', () => {
    const created = createThread({
      id: 'c1',
      pageId: 'page-1',
      anchor: { x: 12, y: 34 },
      author: '小林',
      body: '  这里的间距太大了  ',
      createdAt: '2026-10-15T10:00:00.000Z',
    });
    expect(created.resolved).toBe(false);
    expect(created.replies).toEqual([]);
    expect(created.body).toBe('这里的间距太大了');
    expect(created.anchor).toEqual({ x: 12, y: 34 });
  });

  it('空正文（含纯空白）拒绝新建', () => {
    expect(isValidBody('   ')).toBe(false);
    expect(() =>
      createThread({
        id: 'c1',
        pageId: 'page-1',
        anchor: { x: 0, y: 0 },
        author: '小林',
        body: '   ',
        createdAt: '2026-10-15T10:00:00.000Z',
      }),
    ).toThrow(CommentError);
  });
});

describe('评论线程 · 回复与解决', () => {
  it('回复追加到末尾且不改动原线程（不可变）', () => {
    const original = thread('c1', '2026-10-15T10:00:00.000Z');
    const replied = replyToThread(original, {
      id: 'r1',
      author: '阿岚',
      body: '同意',
      createdAt: '2026-10-15T10:05:00.000Z',
    });
    expect(original.replies).toHaveLength(0);
    expect(replied.replies.map((reply) => reply.id)).toEqual(['r1']);
    expect(replyCount(replied)).toBe(1);
  });

  it('解决后不可再编辑：回复被拒绝且线程保持解决态', () => {
    const resolved = resolveThread(thread('c1', '2026-10-15T10:00:00.000Z'));
    expect(resolved.resolved).toBe(true);
    expect(isEditable(resolved)).toBe(false);
    expect(() =>
      replyToThread(resolved, {
        id: 'r1',
        author: '阿岚',
        body: '还想补一句',
        createdAt: '2026-10-15T10:10:00.000Z',
      }),
    ).toThrow(CommentError);
    expect(resolved.replies).toHaveLength(0);
  });

  it('解决是幂等的；重新打开后恢复可编辑', () => {
    const once = resolveThread(thread('c1', '2026-10-15T10:00:00.000Z'));
    expect(resolveThread(once)).toBe(once);
    const reopened = reopenThread(once);
    expect(reopened.resolved).toBe(false);
    expect(isEditable(reopened)).toBe(true);
    expect(() =>
      replyToThread(reopened, {
        id: 'r1',
        author: '阿岚',
        body: '重开后可以回复',
        createdAt: '2026-10-15T10:20:00.000Z',
      }),
    ).not.toThrow();
  });
});

describe('评论线程 · 列表读法', () => {
  it('按页筛选只留当前页的线程', () => {
    const here = thread('c1', '2026-10-15T10:00:00.000Z');
    const other = { ...thread('c2', '2026-10-15T10:00:00.000Z'), pageId: 'page-2' };
    expect(threadsOfPage([here, other], 'page-1').map((item) => item.id)).toEqual(['c1']);
  });

  it('分组：未解决在前、已解决折叠在后，各组新→旧', () => {
    const groups = groupThreads([
      thread('old-open', '2026-10-15T09:00:00.000Z'),
      thread('new-open', '2026-10-15T11:00:00.000Z'),
      thread('old-done', '2026-10-15T08:00:00.000Z', true),
      thread('new-done', '2026-10-15T12:00:00.000Z', true),
    ]);
    expect(groups.open.map((item) => item.id)).toEqual(['new-open', 'old-open']);
    expect(groups.resolved.map((item) => item.id)).toEqual(['new-done', 'old-done']);
  });

  it('replaceThread 按 id 替换且不动其他线程', () => {
    const list = [
      thread('c1', '2026-10-15T10:00:00.000Z'),
      thread('c2', '2026-10-15T11:00:00.000Z'),
    ];
    const next = replaceThread(list, resolveThread(list[0] as CommentThread));
    expect(next[0]?.resolved).toBe(true);
    expect(next[1]?.resolved).toBe(false);
    expect(list[0]?.resolved).toBe(false);
  });
});
