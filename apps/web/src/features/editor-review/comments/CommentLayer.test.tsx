// @vitest-environment jsdom
/**
 * 评论钉点覆盖层测试（seam：`CommentLayer` 的可观测行为）。
 *
 * 断言口径（briefs/fe-07.md §2）：
 * - 钉点位置 = 世界坐标 → 屏幕换算（**随缩放/平移跟随**）；
 * - 钉点悬停展开预览（`data-df-state="hover"`，验收 §5 的 hover 挂点）；
 * - 评论模式下点画布落草稿；提交 → 线程入 store；取消 → 不留痕。
 */
import { createDocument, createFrame, createPage, insertNode } from '@dforge/engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewProvider } from '../review-context';
import { createReviewSession, type ReviewSession } from '../session';
import { createMemoryBackend } from '../storage';
import { CommentLayer } from './CommentLayer';

/** 夹具：一页 + 一个画板（评论层挂在画布上，画板只是背景）。 */
function fixtureSession(): ReviewSession {
  let doc = createDocument({ id: 'doc-1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 400, height: 300 }), null);
  let counter = 0;
  return createReviewSession({
    document: doc,
    documentId: 'doc-1',
    pageId: 'p1',
    author: '小林',
    backend: createMemoryBackend(),
    now: () => new Date('2026-10-15T10:00:00.000Z'),
    nextId: () => {
      counter += 1;
      return `c${String(counter)}`;
    },
  });
}

/** 渲染评论层并把会话交回给测试。 */
function renderLayer(session: ReviewSession = fixtureSession()) {
  render(
    <ReviewProvider session={session}>
      <CommentLayer />
    </ReviewProvider>,
  );
  return session;
}

/** 取钉点（按可访问名匹配）。 */
function pins(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /评论钉点|已解决的评论/ });
}

describe('评论层 · 钉点位置随视口换算', () => {
  it('非评论模式不渲染钉点（评论只在评论模式下出现）', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().beginDraft({ x: 100, y: 60 });
      session.comments.getState().submitDraft('看看这里');
    });
    expect(pins()).toHaveLength(0);
  });

  it('评论模式下钉点出现在世界坐标换算出的屏幕位置', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 100, y: 60 });
      session.comments.getState().submitDraft('看看这里');
    });
    const pin = pins()[0];
    expect(pin).toBeDefined();
    expect(pin?.style.left).toBe('100px');
    expect(pin?.style.top).toBe('60px');
  });

  it('缩放与平移后钉点跟随（同一世界坐标 → 新屏幕位置）', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 100, y: 60 });
      session.comments.getState().submitDraft('跟随');
    });
    expect(pins()[0]?.style.left).toBe('100px');

    // 视口来源变化：zoom 2 + pan(30, -10) → screen = 100×2+30 = 230 / 60×2-10 = 110
    const viewportStore = session.viewport as unknown as {
      setViewport: (v: { zoom: number; panX: number; panY: number }) => void;
    };
    act(() => {
      viewportStore.setViewport({ zoom: 2, panX: 30, panY: -10 });
    });
    expect(pins()[0]?.style.left).toBe('230px');
    expect(pins()[0]?.style.top).toBe('110px');
  });
});

describe('评论层 · 钉点悬停展开', () => {
  it('悬停钉点展开预览卡（作者 + 正文 + 回复数），移开后收起', async () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 40, y: 40 });
      session.comments.getState().submitDraft('标题层级有点乱');
      const id = session.comments.getState().threads[0]?.id as string;
      session.comments.getState().reply(id, '收到，我看看');
    });
    const pin = pins()[0];
    expect(pin).toBeDefined();
    if (pin === undefined) return;

    expect(screen.queryByText('标题层级有点乱')).toBeNull();
    fireEvent.mouseEnter(pin);
    const card = screen.getByText('标题层级有点乱');
    expect(card).toBeDefined();
    expect(screen.getByText('收到，我看看')).toBeDefined();
    expect(screen.getByText('1 条回复')).toBeDefined();
    expect(pin.dataset.dfState).toBe('hover');

    fireEvent.mouseLeave(pin);
    expect(screen.queryByText('标题层级有点乱')).toBeNull();
  });

  it('键盘聚焦钉点也展开预览（焦点的等价路径）', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 10, y: 10 });
      session.comments.getState().submitDraft('键盘可达');
    });
    const pin = pins()[0];
    if (pin === undefined) throw new Error('缺少钉点');
    fireEvent.focus(pin);
    expect(screen.getByText('键盘可达')).toBeDefined();
    fireEvent.blur(pin);
    expect(screen.queryByText('键盘可达')).toBeNull();
  });

  it('已解决的钉点用解决态样式与可访问名（悬停仍需可读）', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 10, y: 10 });
      session.comments.getState().submitDraft('已经处理完');
      const id = session.comments.getState().threads[0]?.id as string;
      session.comments.getState().resolve(id);
    });
    const resolved = screen.getByRole('button', { name: /已解决的评论/ });
    expect(resolved.dataset.dfState).toBe('resolved');
  });
});

describe('评论层 · 落草稿与提交', () => {
  it('评论模式下点画布落草稿，提交后线程入 store 且草稿关闭', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '在画布上添加评论' }), {
      clientX: 120,
      clientY: 80,
    });

    const input = screen.getByPlaceholderText('写下你的评论…');
    fireEvent.change(input, { target: { value: '这里的间距太大了' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    const threads = session.comments.getState().threads;
    expect(threads).toHaveLength(1);
    expect(threads[0]?.anchor).toEqual({ x: 120, y: 80 });
    expect(screen.queryByPlaceholderText('写下你的评论…')).toBeNull();
  });

  it('取消草稿不留痕（不落线程、卡片关闭）', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '在画布上添加评论' }), {
      clientX: 30,
      clientY: 30,
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(session.comments.getState().threads).toHaveLength(0);
    expect(screen.queryByPlaceholderText('写下你的评论…')).toBeNull();
  });

  it('空正文提交：给出错误提示且不落线程', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '在画布上添加评论' }), {
      clientX: 30,
      clientY: 30,
    });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    expect(session.comments.getState().threads).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toContain('不能为空');
  });

  it('评论模式下点画布：命中半径内的钉点优先打开线程而不是叠新草稿', () => {
    const session = renderLayer();
    act(() => {
      session.comments.getState().setMode(true);
      session.comments.getState().beginDraft({ x: 50, y: 50 });
      session.comments.getState().submitDraft('已有钉点');
      session.comments.getState().setActive(null);
    });
    fireEvent.click(screen.getByRole('button', { name: '在画布上添加评论' }), {
      clientX: 50,
      clientY: 50,
    });
    expect(session.comments.getState().draftAnchor).toBeNull();
    expect(session.comments.getState().activeThreadId).toBe(
      session.comments.getState().threads[0]?.id,
    );
  });
});
