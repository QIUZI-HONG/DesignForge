/**
 * Present 序列与翻页状态机测试（seam：`sequence.ts` + `controller.ts`）。
 *
 * 规则来自 C13 与 briefs/fe-07.md §2：画板序列按**页面顺序**；
 * ←/→ 翻页在边界**不越界**；Esc 退出；控制条自动隐藏（鼠标静止超时）。
 */
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
  insertNode,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';
import {
  AUTO_HIDE_DELAY_MS,
  barsVisibleAfterIdle,
  createPresenterState,
  keyboardActionOf,
  stepPresentation,
} from './controller';
import { buildSlides, slideLabel } from './sequence';

/** 夹具：p1 有 f1/f2 两个画板（顺序 = 绘制顺序），p2 有 f3；外加一个组件与一个矩形。 */
function presentDoc(): DesignDocument {
  let doc = createDocument({
    id: 'doc-1',
    pages: [createPage({ id: 'p1', name: '页面 1' }), createPage({ id: 'p2', name: '页面 2' })],
  });
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f1', name: '首屏', width: 100, height: 100 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f2', name: '详情', width: 100, height: 100 }),
    null,
  );
  doc = insertNode(doc, 'p1', createRect({ id: 'r1', name: '散件', width: 10, height: 10 }), null);
  doc = insertNode(doc, 'p2', createFrame({ id: 'f3', name: '设置', width: 50, height: 50 }), null);
  doc = insertNode(doc, 'p2', createRect({ id: 'r2', name: '第二页散件' }), null);
  return doc;
}

describe('Present · 画板序列', () => {
  it('按页面顺序收集顶层画板（跳过非画板节点）', () => {
    const slides = buildSlides(presentDoc());
    expect(slides.map((slide) => slide.frameId)).toEqual(['f1', 'f2', 'f3']);
    expect(slides.map((slide) => slide.pageId)).toEqual(['p1', 'p1', 'p2']);
  });

  it('无画板时序列为空（空态由 Presenter 呈现，不伪造）', () => {
    let doc = createDocument({ id: 'doc-2', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createRect({ id: 'r1' }), null);
    expect(buildSlides(doc)).toEqual([]);
  });

  it('序号是 1 基连续编号；标签 = 页名 · 画板名', () => {
    const slides = buildSlides(presentDoc());
    expect(slides.map((slide) => slide.index)).toEqual([1, 2, 3]);
    expect(slideLabel(slides[0]!)).toBe('页面 1 · 首屏');
  });
});

describe('Present · 翻页状态机', () => {
  it('首页 ← 不越界、末页 → 不越界', () => {
    const total = 3;
    let state = createPresenterState(total);
    expect(state.index).toBe(0);
    state = stepPresentation(state, -1, total);
    expect(state.index).toBe(0);
    state = stepPresentation(
      stepPresentation(stepPresentation(state, 1, total), 1, total),
      1,
      total,
    );
    expect(state.index).toBe(2);
    state = stepPresentation(state, 1, total);
    expect(state.index).toBe(2);
  });

  it('空序列时下标恒为 0（Presenter 走空态）', () => {
    let state = createPresenterState(0);
    state = stepPresentation(state, 1, 0);
    expect(state.index).toBe(0);
    state = stepPresentation(state, -1, 0);
    expect(state.index).toBe(0);
  });

  it('键盘：←/→ 翻页、Esc 退出；其余键无动作', () => {
    expect(keyboardActionOf('ArrowLeft')).toBe('prev');
    expect(keyboardActionOf('ArrowRight')).toBe('next');
    expect(keyboardActionOf('Escape')).toBe('exit');
    expect(keyboardActionOf('a')).toBeNull();
  });

  it('控制条自动隐藏：静止超时后隐藏，活动后重新出现', () => {
    const state = createPresenterState(3);
    expect(state.barVisible).toBe(true);
    expect(barsVisibleAfterIdle(0, AUTO_HIDE_DELAY_MS - 1)).toBe(true);
    expect(barsVisibleAfterIdle(0, AUTO_HIDE_DELAY_MS)).toBe(false);
    // 活动（翻页/移动）重置计时：刚活动过 → 可见
    expect(barsVisibleAfterIdle(5000, 5000)).toBe(true);
  });
});
