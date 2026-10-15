// @vitest-environment jsdom
/**
 * NumberField（C5 数值输入四交互）规格：
 * 拖拽 scrub、上下键步进、Enter 提交、Esc 取消、blur/debounce 300ms 提交。
 *
 * 断言可观测行为：输入框显示值、提交时刻与提交次数（一次修改 = 一条命令）、
 * 混选「—」显示与以基准值起拖。fake timers 断言「连续输入/连续拖拽只提交一次」。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMIT_DELAY_MS } from '../model/draft';
import { formatFieldNumber, NumberField } from './NumberField';

describe('formatFieldNumber（数值显示口径）', () => {
  it('整数不带小数位，浮点去掉尾随零', () => {
    expect(formatFieldNumber(10, 0)).toBe('10');
    expect(formatFieldNumber(1.5, 2)).toBe('1.5');
    expect(formatFieldNumber(1.25, 2)).toBe('1.25');
  });

  it('按精度四舍五入', () => {
    expect(formatFieldNumber(0.3333, 2)).toBe('0.33');
    expect(formatFieldNumber(1.6, 0)).toBe('2');
  });
});

/** 渲染一个受控字段（不带引擎，聚焦交互语义）。 */
function renderField(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <NumberField label="X" fieldName="x" value={10} onCommit={onCommit} {...props} />,
  );
  const input = screen.getByRole('textbox', { name: 'X' });
  return { onCommit, input, view };
}

describe('NumberField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('单值：显示格式化后的值；混选：显示「—」', () => {
    const { input } = renderField();
    expect(input.value).toBe('10');

    const view = render(
      <NumberField label="Y" fieldName="y" value={undefined} onCommit={vi.fn()} />,
    );
    const mixedInput = screen.getByRole('textbox', { name: 'Y' });
    expect(mixedInput.value).toBe('—');
    expect(mixedInput.closest('[data-df-inspector-field]')?.getAttribute('data-df-state')).toBe(
      'mixed',
    );
    view.unmount();
  });

  it('输入期间不提交；静默 300ms 只提交一次（提交最终文本）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.change(input, { target: { value: '250' } });

    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS - 1));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(250);
  });

  it('Enter 立即提交（不等待 300ms）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(42);

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Esc 取消草稿：显示回滚到外部值且不提交', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('10');
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur 提交草稿', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(7);
  });

  it('上下键步进 ±step；Shift 为 10 倍步进', () => {
    const { onCommit, input } = renderField();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith(11);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith(9);

    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith(20);
  });

  it('步进受 min/max 夹取', () => {
    const { onCommit, input } = renderField({ min: 0, max: 12 });
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith(12);
  });

  it('拖拽 scrub：拖动期间不提交（含静默超窗），松手提交一次（1px = 1 步）', () => {
    const { onCommit } = renderField();
    const handle = screen.getByTestId('numberfield-scrub-x');

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 110, pointerId: 1 });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 3));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { clientX: 130, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(40);

    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS * 2));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('混选（value undefined）：以基准值起拖，提交基准 + 位移', () => {
    const onCommit = vi.fn();
    render(
      <NumberField label="X" fieldName="x" value={undefined} baseValue={100} onCommit={onCommit} />,
    );
    const handle = screen.getByTestId('numberfield-scrub-x');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 5, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 5, pointerId: 2 });
    expect(onCommit).toHaveBeenCalledWith(105);
  });

  it('值无变化时不提交（不产生空命令）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '10' } });
    act(() => vi.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('非法输入不提交并回滚显示', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('10');
  });

  it('disabled：输入框禁用且不响应拖拽', () => {
    const { onCommit, input } = renderField({ disabled: true });
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId('numberfield-scrub-x').getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(screen.getByTestId('numberfield-scrub-x'), { clientX: 0, pointerId: 3 });
    fireEvent.pointerMove(screen.getByTestId('numberfield-scrub-x'), { clientX: 20, pointerId: 3 });
    fireEvent.pointerUp(screen.getByTestId('numberfield-scrub-x'), { clientX: 20, pointerId: 3 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
