// @vitest-environment jsdom
/**
 * Present 浮层测试（seam：`Presenter` 的可观测行为）。
 *
 * 断言口径（C13 + briefs/fe-07.md §2）：黑底全屏 + 顶部悬浮控制条；
 * ←/→ 翻页（首页 ←/末页 → 不越界）、Esc 退出、控制条自动隐藏、空态、全屏按钮。
 */
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  createText,
  insertNode,
} from '@dforge/engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewProvider } from '../review-context';
import { createReviewSession, type ReviewSession } from '../session';
import { createMemoryBackend } from '../storage';
import { PresentButton } from './PresentButton';
import { Presenter } from './Presenter';

/** 夹具：两页共三个画板（首屏 / 详情 / 设置）。 */
function presentSession(): ReviewSession {
  let doc = createDocument({
    id: 'doc-1',
    pages: [createPage({ id: 'p1', name: '页面 1' }), createPage({ id: 'p2', name: '页面 2' })],
  });
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f1', name: '首屏', width: 200, height: 100 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f2', name: '详情', width: 200, height: 100 }),
    null,
  );
  doc = insertNode(
    doc,
    'p2',
    createFrame({ id: 'f3', name: '设置', width: 200, height: 100 }),
    null,
  );
  doc = insertNode(doc, 'p1', createText({ id: 't1', name: '标题', width: 80, height: 20 }), 'f1');
  return createReviewSession({
    document: doc,
    documentId: 'doc-1',
    pageId: 'p1',
    backend: createMemoryBackend(),
  });
}

function renderPresenter(session: ReviewSession = presentSession()) {
  render(
    <ReviewProvider session={session}>
      <Presenter />
    </ReviewProvider>,
  );
  return session;
}

/** 取浮层根。 */
function presenterRoot(): HTMLElement | null {
  return document.querySelector('[data-df-presenter]');
}

/** 当前页码文本。 */
function pageText(): string {
  return screen.getByLabelText('演示控制条').textContent ?? '';
}

describe('Present 浮层 · 开启与舞台', () => {
  it('未开启时不渲染浮层', () => {
    renderPresenter();
    expect(presenterRoot()).toBeNull();
  });

  it('开启后渲染黑底舞台与顶部控制条（页码 + 画板名）', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    const root = presenterRoot();
    expect(root).not.toBeNull();
    expect(root?.dataset.dfSlideIndex).toBe('0');
    expect(pageText()).toContain('1 / 3');
    expect(pageText()).toContain('页面 1 · 首屏');
  });

  it('无画板时呈现空态（不伪造内容）', () => {
    let doc = createDocument({ id: 'doc-2', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createRect({ id: 'r1' }), null);
    const session = createReviewSession({
      document: doc,
      documentId: 'doc-2',
      pageId: 'p1',
      backend: createMemoryBackend(),
    });
    renderPresenter(session);
    act(() => {
      session.present.getState().openPresentation();
    });
    expect(screen.getByText('没有可演示的画板')).toBeDefined();
  });
});

describe('Present 浮层 · 键盘翻页', () => {
  it('→ 翻下一页、← 翻上一页；首尾不越界', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    // 首页 ←：不越界
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('0');
    // → 两次到末页，再次 → 仍停末页
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('2');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('2');
    expect(pageText()).toContain('3 / 3');
    // ← 回上一页
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('1');
  });

  it('Esc 退出演示（浮层消失）', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(session.present.getState().open).toBe(false);
    expect(presenterRoot()).toBeNull();
  });
});

describe('Present 浮层 · 控制条', () => {
  it('按钮：上一张 / 下一张 / 退出', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(presenterRoot()?.dataset.dfSlideIndex).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '退出演示' }));
    expect(session.present.getState().open).toBe(false);
  });

  it('自动隐藏：静止超时控制条隐藏，活动后重新出现', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    const controls = screen.getByLabelText('演示控制条');
    expect(controls.dataset.dfState).toBe('visible');
    act(() => {
      session.present.getState().hideBar();
    });
    expect(screen.getByLabelText('演示控制条').dataset.dfState).toBe('hidden');
    act(() => {
      session.present.getState().markActivity();
    });
    expect(screen.getByLabelText('演示控制条').dataset.dfState).toBe('visible');
  });

  it('全屏按钮请求全屏（浏览器 API 存在时）', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(document.documentElement, 'requestFullscreen');
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    try {
      const session = renderPresenter();
      act(() => {
        session.present.getState().openPresentation();
      });
      // 进入演示本身就会请求一次全屏（用户手势外的环境会拒绝）；这里只断言按钮这一击
      requestFullscreen.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '全屏' }));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
      } else {
        Object.defineProperty(document.documentElement, 'requestFullscreen', original);
      }
    }
  });

  it('无全屏 API（jsdom 默认）时不崩且按钮仍可点', () => {
    const session = renderPresenter();
    act(() => {
      session.present.getState().openPresentation();
    });
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    }).not.toThrow();
  });
});

describe('Present 入口按钮（顶栏插槽）', () => {
  it('点击进入演示；再次点击退出', () => {
    const session = presentSession();
    render(
      <ReviewProvider session={session}>
        <PresentButton />
      </ReviewProvider>,
    );
    const button = screen.getByRole('button', { name: '演示' });
    fireEvent.click(button);
    expect(session.present.getState().open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '退出演示' }));
    expect(session.present.getState().open).toBe(false);
  });
});
