/**
 * NumberField（数值编辑 deep module · arch-02）语义规格。
 *
 * 规格来源：《前端验收标准 v1》C5/C6 与 inspector-commit 对抗用例——
 * 草稿态、300ms 去抖、松手/Enter/blur 提交括约、Esc 还原、键盘步进、
 * min/max/step、可选 scrub、混选「—」、可及性标签。
 *
 * 核心断言：**一次编辑恰一条命令**（连续输入/连续拖拽只提交一次；
 * 提交时刻才调用 onCommit——撤销粒度 = 一次修改）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatFieldNumber,
  NumberField,
  type NumberFieldMessages,
  type NumberFieldProps,
} from './NumberField';

/** 调用方注入的界面文案（本包不含业务文案；测试夹具即调用方）。 */
const MESSAGES: NumberFieldMessages = {
  reverted: '已恢复原值',
  clamped: (value) => `已限制为 ${value}`,
};

/** 混选占位（生产由调用方从单点传入）。 */
const MIXED = '—';

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
function renderField(props: Partial<NumberFieldProps> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <NumberField
      label="X"
      fieldName="x"
      value={10}
      mixedPlaceholder={MIXED}
      messages={MESSAGES}
      onCommit={onCommit}
      {...props}
    />,
  );
  const input = screen.getByRole('textbox', { name: props.label ?? 'X' }) as HTMLInputElement;
  return { onCommit, input, view };
}

describe('NumberField · 显示与混选', () => {
  it('单值：显示格式化后的值；混选：显示调用方占位并标 mixed', () => {
    const { input } = renderField();
    expect(input.value).toBe('10');

    const view = render(
      <NumberField
        label="Y"
        fieldName="y"
        value={undefined}
        mixedPlaceholder={MIXED}
        messages={MESSAGES}
        onCommit={vi.fn()}
      />,
    );
    const mixedInput = screen.getByRole('textbox', { name: 'Y' }) as HTMLInputElement;
    expect(mixedInput.value).toBe('—');
    expect(mixedInput.closest('[data-df-inspector-field]')?.getAttribute('data-df-state')).toBe(
      'mixed',
    );
    view.unmount();
  });

  it('可及性：标签即输入框的可访问名', () => {
    renderField({ label: '宽度' });
    expect(screen.getByRole('textbox', { name: '宽度' })).toBeTruthy();
  });
});

describe('NumberField · 草稿与提交（一次编辑恰一条命令）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('输入期间不提交；静默 300ms 只提交一次（提交最终文本）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.change(input, { target: { value: '250' } });

    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(250);
  });

  it('299ms 边界不提交，300ms 才提交（计时口径钉死）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '77' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(77);
  });

  it('Enter 立即提交（不等待 300ms），且之后不再有第二次', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(42);

    act(() => vi.advanceTimersByTime(600));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Esc 取消草稿：显示回滚到外部值且不提交', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('10');
    act(() => vi.advanceTimersByTime(600));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Esc 之后 blur 不得把取消变成提交', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '999' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur 立即提交草稿一次，且不再有第二次（计时器被清）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '7' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(7);
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('值无变化时不提交（不产生空命令）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '10' } });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('NumberField · 键盘步进与范围', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('上下键步进 ±step；Shift 为 10 倍步进', () => {
    const { onCommit, input } = renderField();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenLastCalledWith(11);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenLastCalledWith(9);

    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenLastCalledWith(20);
  });

  it('步进受 min/max 夹取', () => {
    const { onCommit, input } = renderField({ min: 0, max: 12 });
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenLastCalledWith(12);
  });
});

describe('NumberField · scrub（拖拽改值）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('拖拽期间不提交（含静默超窗），松手提交一次（1px = 1 步）', () => {
    const { onCommit } = renderField();
    const handle = screen.getByTestId('numberfield-scrub-x');

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 110, pointerId: 1 });
    act(() => vi.advanceTimersByTime(900));
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    act(() => vi.advanceTimersByTime(900));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { clientX: 130, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(40);

    act(() => vi.advanceTimersByTime(600));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('scrub 会话钩子：onScrubStart 先于提交，onScrubEnd 后于唯一一次提交', () => {
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    const onCommit = vi.fn();
    render(
      <NumberField
        label="X"
        fieldName="x"
        value={10}
        mixedPlaceholder={MIXED}
        messages={MESSAGES}
        onCommit={onCommit}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />,
    );
    const handle = screen.getByTestId('numberfield-scrub-x');

    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(handle, { clientX: 5, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 12, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { clientX: 12, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('值未变化即松手：给 onScrubEnd，但不提交', () => {
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    const onCommit = vi.fn();
    render(
      <NumberField
        label="X"
        fieldName="x"
        value={10}
        mixedPlaceholder={MIXED}
        messages={MESSAGES}
        onCommit={onCommit}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />,
    );
    const handle = screen.getByTestId('numberfield-scrub-x');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('拖拽中途 Esc：丢弃草稿，之后松手不得提交', () => {
    const onCommit = vi.fn();
    render(
      <NumberField
        label="X"
        fieldName="x"
        value={10}
        mixedPlaceholder={MIXED}
        messages={MESSAGES}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'X' });
    const handle = screen.getByTestId('numberfield-scrub-x');
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('scrubbing=false 关闭拖拽改值（键入路径不受影响）', () => {
    const { onCommit, input } = renderField({ scrubbing: false });
    const handle = screen.getByTestId('numberfield-scrub-x');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 4 });
    fireEvent.pointerMove(handle, { clientX: 20, pointerId: 4 });
    fireEvent.pointerUp(handle, { clientX: 20, pointerId: 4 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '33' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(33);
  });

  it('混选（value undefined）：以基准值起拖，提交基准 + 位移', () => {
    const onCommit = vi.fn();
    render(
      <NumberField
        label="X"
        fieldName="x"
        value={undefined}
        baseValue={100}
        mixedPlaceholder={MIXED}
        messages={MESSAGES}
        onCommit={onCommit}
      />,
    );
    const handle = screen.getByTestId('numberfield-scrub-x');
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 5, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 5, pointerId: 2 });
    expect(onCommit).toHaveBeenCalledWith(105);
  });
});

describe('NumberField · 非法输入与夹取提示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('非法输入不提交并回滚显示，行内提示「已恢复原值」；下一次编辑即清除', () => {
    const { onCommit, input } = renderField();
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('10');
    expect(screen.getByRole('status').textContent).toBe('已恢复原值');

    fireEvent.change(input, { target: { value: '12' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('空串不产生提交（避免空命令）', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '' } });
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('负值口径 · 坐标（无 min）：负值原样提交，不给限制提示', () => {
    const { onCommit, input } = renderField();
    fireEvent.change(input, { target: { value: '-99999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(-99999);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('负值口径 · 尺寸（min 0）：负值被限制为 0 并给「已限制为 0」提示', () => {
    const { onCommit, input } = renderField({ value: 80, min: 0, precision: 0 });
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(0);
    expect(screen.getByRole('status').textContent).toBe('已限制为 0');
  });
});

describe('NumberField · disabled', () => {
  it('输入框禁用且不响应拖拽', () => {
    const { onCommit, input } = renderField({ disabled: true });
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId('numberfield-scrub-x').getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(screen.getByTestId('numberfield-scrub-x'), { clientX: 0, pointerId: 3 });
    fireEvent.pointerMove(screen.getByTestId('numberfield-scrub-x'), {
      clientX: 20,
      pointerId: 3,
    });
    fireEvent.pointerUp(screen.getByTestId('numberfield-scrub-x'), { clientX: 20, pointerId: 3 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('NumberField · 样式随包分发（arch-fix2 发现 A）', () => {
  /** 包内组件样式（DS 件离开 app 样式的唯一依赖面）。 */
  const componentsCss = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8');

  it('渲染出的每个造型类都在包内 components.css 有同名规则（无 app 样式也成立）', () => {
    const { input } = renderField({ suffix: '%' });
    const cell = input.closest('.dfi-numberfield-cell') as HTMLElement | null;
    expect(cell, '未渲染字段单元（样式挂点丢失）').not.toBeNull();

    const classTokens = new Set<string>();
    for (const element of [cell as HTMLElement, ...(cell as HTMLElement).querySelectorAll('*')]) {
      for (const token of (element as HTMLElement).className.split(/\s+/)) {
        if (token.startsWith('dfi-numberfield')) classTokens.add(token);
      }
    }
    expect(classTokens.size, '未取到任何 NumberField 造型类').toBeGreaterThan(0);

    const missing = [...classTokens].filter(
      (token) => !new RegExp(`\\.${token}(?![\\w-])`).test(componentsCss),
    );
    expect(missing, '这些类在包内 components.css 没有规则（样式仍落在 app 侧）').toEqual([]);
  });

  it('行内提示自带字号/颜色（不再依赖 app 的 .dfi-hint）', () => {
    const { input } = renderField();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const notice = screen.getByRole('status');
    expect(notice.className).toBe('dfi-numberfield__notice');
    const rule = /\.dfi-numberfield__notice\s*\{([^}]*)\}/.exec(componentsCss)?.[1] ?? '';
    expect(rule).toContain('color: var(--dfg-color-text-secondary)');
    expect(rule).toContain('font-size: var(--dfg-font-size-11)');
  });
});
