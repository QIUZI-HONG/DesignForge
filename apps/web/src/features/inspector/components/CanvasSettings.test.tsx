// @vitest-environment jsdom
/**
 * CanvasSettings（C7 空选态）规格：页面名 / 背景色 / 网格开关与间距。
 *
 * 断言全部经由引擎文档（page.update 命令）与可观测 DOM：
 * 300ms 提交、Enter 立即提交、非法颜色不提交、网格切换立即生效且保留其余网格字段。
 */

import type { CommandStack } from '@dforge/engine';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMIT_DELAY_MS } from '../model/draft';
import { FIXTURE_PAGE_ID, fixtureStack } from '../testing/fixtures';
import { CanvasSettings } from './CanvasSettings';

/** 渲染并返回断言句柄。 */
function setup() {
  const stack: CommandStack = fixtureStack({ freeze: true });
  render(<CanvasSettings stack={stack} pageId={FIXTURE_PAGE_ID} />);
  const page = () => {
    const current = stack.document.pages[0];
    if (current === undefined) throw new Error('夹具缺失');
    return current;
  };
  return { stack, page };
}

/** 取字段容器。 */
function field(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-df-inspector-field="${name}"]`);
  if (found === null) throw new Error(`字段缺失：${name}`);
  return found;
}

/** 取字段输入框。 */
function inputOf(name: string): HTMLInputElement {
  const found = field(name).querySelector('input');
  if (found === null) throw new Error(`字段输入框缺失：${name}`);
  return found;
}

describe('CanvasSettings · 画布设置（C7 空选态）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('显示当前页面名/背景/网格设置', () => {
    setup();
    expect(inputOf('pageName').value).toBe('主页面');
    expect(inputOf('background').value).toBe('#F5F5F5');
    expect(inputOf('gridSize').value).toBe('10');
    const toggle = field('gridVisible').querySelector('button');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });

  it('改页面名（Enter 提交）写入页面设置；撤销还原', () => {
    const { stack, page } = setup();
    fireEvent.change(inputOf('pageName'), { target: { value: '登录页' } });
    fireEvent.keyDown(inputOf('pageName'), { key: 'Enter' });

    expect(page().name).toBe('登录页');
    expect(stack.history().undo.length).toBe(1);
    expect(stack.undo()).toBe(true);
    expect(page().name).toBe('主页面');
  });

  it('改背景色：300ms 静默后只提交一次', () => {
    const { stack, page } = setup();
    fireEvent.change(inputOf('background'), { target: { value: '#101010' } });
    fireEvent.change(inputOf('background'), { target: { value: '#202020' } });
    expect(page().backgroundColor).toBe('#F5F5F5');

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(page().backgroundColor).toBe('#202020');
    expect(stack.history().undo.length).toBe(1);
  });

  it('非法颜色不提交并回滚显示', () => {
    const { stack, page } = setup();
    fireEvent.change(inputOf('background'), { target: { value: 'zzz' } });
    fireEvent.keyDown(inputOf('background'), { key: 'Enter' });

    expect(page().backgroundColor).toBe('#F5F5F5');
    expect(inputOf('background').value).toBe('#F5F5F5');
    expect(stack.history().undo.length).toBe(0);
  });

  it('网格开关立即切换可见性（保留其余网格字段）', () => {
    const { page } = setup();
    const toggle = field('gridVisible').querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggle);

    expect(page().grid.visible).toBe(true);
    expect(page().grid.size).toBe(10);
    expect(page().grid.style).toBe('grid');
    expect(page().grid.snapToGrid).toBe(false);

    fireEvent.click(field('gridVisible').querySelector('button') as HTMLButtonElement);
    expect(page().grid.visible).toBe(false);
  });

  it('网格间距修改写入网格设置且夹取下限', () => {
    const { page } = setup();
    fireEvent.change(inputOf('gridSize'), { target: { value: '20' } });
    fireEvent.keyDown(inputOf('gridSize'), { key: 'Enter' });
    expect(page().grid.size).toBe(20);

    fireEvent.change(inputOf('gridSize'), { target: { value: '0' } });
    fireEvent.keyDown(inputOf('gridSize'), { key: 'Enter' });
    expect(page().grid.size).toBe(1);
  });
});
