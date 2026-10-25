/**
 * NumberField / Scrubber 行为测试（RW-07 · 数值步进 + scrubbing）。
 *
 * 断言角度（验收标准 §2 + §5，对应总纲 R-4「数值步进 + scrubbing」）：spinbutton 语义、
 * 键盘/按钮步进与边界钳制、拖拽改值（鼠标 scrubbing 的可达性等价路径是方向键）、
 * 非法输入标错、单位后缀、禁用/加载态——只测可观测行为。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from './NumberField';
import { Scrubber } from './Scrubber';

describe('NumberField · 语义与展示', () => {
  it('spinbutton 语义：可访问名来自字段名，值/单位/边界进 aria', () => {
    render(
      <NumberField fieldLabel="宽度" value={16} unit="px" min={0} max={100} onChange={() => {}} />,
    );
    const input = screen.getByRole('spinbutton', { name: '宽度' });
    expect(input.getAttribute('aria-valuenow')).toBe('16');
    expect(input.getAttribute('aria-valuemin')).toBe('0');
    expect(input.getAttribute('aria-valuemax')).toBe('100');
    // 单位后缀灰显在输入框内（不在值文本里）
    expect(screen.getByText('px')).toBeTruthy();
  });

  it('空值：aria-valuenow 缺省，输入框为空', () => {
    render(<NumberField fieldLabel="圆角" value={null} onChange={() => {}} />);
    const input = screen.getByRole('spinbutton', { name: '圆角' }) as HTMLInputElement;
    expect(input.getAttribute('aria-valuenow')).toBeNull();
    expect(input.value).toBe('');
  });
});

describe('NumberField · 键入与提交', () => {
  it('输入数字后 Enter 提交 onChange；失焦同效', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField fieldLabel="X" defaultValue={0} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '24');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(24);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(input);
    await user.type(input, '36');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(36);
  });

  it('单位后缀可随值一起键入（解析时剥离）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField fieldLabel="间距" unit="px" defaultValue={8} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '间距' }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '12px');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('非法输入：标错（aria-invalid + alert）且不上报，修正后恢复', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NumberField fieldLabel="X" defaultValue={1} onChange={onChange} errorMessage="请输入数字" />,
    );
    const input = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    await user.type(input, 'abc');
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('请输入数字');

    await user.clear(input);
    await user.type(input, '10');
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('空值提交上报 null（清空字段）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField fieldLabel="X" defaultValue={16} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('NumberField · 步进', () => {
  it('↑/↓ 步进并按 min/max 钳制', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberField fieldLabel="X" defaultValue={10} step={2} min={0} max={12} onChange={onChange} />,
    );
    const input = screen.getByRole('spinbutton', { name: 'X' });
    input.focus();
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(12);
    rerender(
      <NumberField fieldLabel="X" value={12} step={2} min={0} max={12} onChange={onChange} />,
    );
    await user.keyboard('{ArrowUp}');
    // 已到上界：不再上报
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('步进按钮：点击上调/下调（视觉 affordance，键盘等价路径是方向键）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NumberField fieldLabel="X" defaultValue={10} onChange={onChange} />,
    );
    const steps = container.querySelectorAll<HTMLButtonElement>('.dfg-numfield__step');
    expect(steps.length).toBe(2);
    fireEvent.click(steps[0] as HTMLButtonElement);
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent.click(steps[1] as HTMLButtonElement);
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('小数步进不积浮点尾差（0.1 步进三次 = 0.3）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField fieldLabel="不透明度" defaultValue={0} step={0.1} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '不透明度' });
    input.focus();
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(0.3);
  });
});

describe('NumberField · scrubbing（拖拽改值）', () => {
  it('横向拖拽改值：越过阈值启动，增量按灵敏度折算', () => {
    const onChange = vi.fn();
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    render(
      <NumberField
        fieldLabel="X"
        defaultValue={0}
        scrubSensitivity={0.5}
        onChange={onChange}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'X' });
    fireEvent.mouseDown(input, { button: 0, clientX: 10 });
    // 未越过阈值（2px）：只聚焦，不改值
    fireEvent.mouseMove(document, { clientX: 11 });
    expect(onScrubStart).not.toHaveBeenCalled();
    fireEvent.mouseMove(document, { clientX: 30 });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    // 起点 0 + 位移 20 × 0.5 = 10
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.mouseMove(document, { clientX: 20 });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.mouseUp(document);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('scrubbing=false 关闭拖拽改值（点击仍可进入编辑）', () => {
    const onChange = vi.fn();
    const onScrubStart = vi.fn();
    render(
      <NumberField
        fieldLabel="X"
        defaultValue={0}
        scrubbing={false}
        onChange={onChange}
        onScrubStart={onScrubStart}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'X' });
    fireEvent.mouseDown(input, { button: 0, clientX: 10 });
    fireEvent.mouseMove(document, { clientX: 40 });
    fireEvent.mouseUp(document);
    expect(onScrubStart).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberField · 禁用与加载', () => {
  it('禁用：输入与步进都不可用', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NumberField fieldLabel="X" defaultValue={1} disabled onChange={onChange} />,
    );
    const input = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const steps = container.querySelectorAll<HTMLButtonElement>('.dfg-numfield__step');
    fireEvent.click(steps[0] as HTMLButtonElement);
    fireEvent.click(steps[1] as HTMLButtonElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('加载（引擎同步中）：只读 + 行内转圈', () => {
    const { container } = render(<NumberField fieldLabel="X" value={4} loading />);
    const input = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(container.querySelector('.dfg-spinner')).not.toBeNull();
  });

  it('正常态辅助说明进 aria-describedby（与错误互斥占位）', () => {
    render(<NumberField fieldLabel="X" value={1} hint="0–100 之间的整数" />);
    const describedBy = screen
      .getByRole('spinbutton', { name: 'X' })
      .getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)?.textContent).toContain('0–100');
  });
});

describe('Scrubber（独立抓手：Inspector 标签等场景复用）', () => {
  it('拖拽上报逐段横向增量', () => {
    const onDelta = vi.fn();
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    render(<Scrubber label="宽度" onDelta={onDelta} onScrubStart={onScrubStart} onScrubEnd={onScrubEnd}>宽</Scrubber>);
    const scrubber = screen.getByRole('button', { name: '宽度' });
    fireEvent.mouseDown(scrubber, { button: 0, clientX: 10 });
    fireEvent.mouseMove(document, { clientX: 18 });
    fireEvent.mouseMove(document, { clientX: 15 });
    fireEvent.mouseUp(document);
    expect(onDelta).toHaveBeenNthCalledWith(1, 8);
    expect(onDelta).toHaveBeenNthCalledWith(2, -3);
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('键盘方向键同样上报增量（可达性不只鼠标）', async () => {
    const user = userEvent.setup();
    const onDelta = vi.fn();
    render(<Scrubber label="宽度" step={2} onDelta={onDelta} />);
    screen.getByRole('button', { name: '宽度' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowLeft}');
    expect(onDelta).toHaveBeenNthCalledWith(1, 2);
    expect(onDelta).toHaveBeenNthCalledWith(2, -2);
  });

  it('禁用后不再上报增量', () => {
    const onDelta = vi.fn();
    render(<Scrubber label="宽度" disabled onDelta={onDelta} />);
    const scrubber = screen.getByRole('button', { name: '宽度' }) as HTMLButtonElement;
    expect(scrubber.disabled).toBe(true);
    fireEvent.mouseDown(scrubber, { button: 0, clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 20 });
    fireEvent.mouseUp(document);
    expect(onDelta).not.toHaveBeenCalled();
  });
});
