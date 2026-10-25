/**
 * Swatch / ColorField / TypographyField 行为测试（RW-07 · 色板与字体最小集）。
 *
 * 断言角度（验收标准 §2 + §5，对应总纲 R-4「色板/字号选择」）：色块展示与无色形态、
 * 色值提交与非法标错、清空语义、字号/字重选择的原生下拉语义——只测可观测行为。
 * 测试里的 hex 是「调用方给的业务色值」（测试文件在 guard 白名单内）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ColorField } from './ColorField';
import { Swatch } from './Swatch';
import { TypographyField } from './TypographyField';

describe('Swatch（色板色块）', () => {
  it('纯展示：填充调用方给的色值', () => {
    const { container } = render(<Swatch label="主色" color="#0d99ff" />);
    const swatch = container.querySelector('.dfg-swatch');
    expect(swatch?.tagName.toLowerCase()).toBe('span');
    const fill = container.querySelector('.dfg-swatch__fill') as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(13, 153, 255)');
  });

  it('无色：斜纹形态（缺省值的视觉表达，不用色值占位）', () => {
    const { container } = render(<Swatch label="无填充" />);
    expect(container.querySelector('.dfg-swatch__fill')?.className).toContain(
      'dfg-swatch__fill--empty',
    );
  });

  it('可点选：button 语义 + aria-pressed 表达选中', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Swatch label="主色" color="#0d99ff" selected={false} onClick={onClick} />,
    );
    const swatch = screen.getByRole('button', { name: '主色' });
    expect(swatch.getAttribute('aria-pressed')).toBe('false');
    await user.click(swatch);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Swatch label="主色" color="#0d99ff" selected onClick={onClick} />);
    expect(screen.getByRole('button', { name: '主色' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('禁用：不可点选', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Swatch label="主色" color="#0d99ff" disabled onClick={onClick} />);
    const swatch = screen.getByRole('button', { name: '主色' }) as HTMLButtonElement;
    expect(swatch.disabled).toBe(true);
    await user.click(swatch);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ColorField（颜色输入 + 色块预览）', () => {
  it('字段具名 + 色块预览展示当前值', () => {
    render(<ColorField fieldLabel="填充" value="#0d99ff" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: '填充' })).toBeTruthy();
    const fill = document.querySelector('.dfg-colorfield .dfg-swatch__fill') as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(13, 153, 255)');
  });

  it('提交合法 hex：小写规范形上报，预览同步', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField fieldLabel="填充" defaultValue="#123456" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '#0D99FF');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('#0d99ff');
  });

  it('非法输入：标错且不上报，修正后恢复', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ColorField
        fieldLabel="填充"
        defaultValue="#0d99ff"
        onChange={onChange}
        errorMessage="请输入 hex 色值"
      />,
    );
    const input = screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '蓝色');
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('hex');
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '#14ae5c');
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(onChange).toHaveBeenCalledWith('#14ae5c');
  });

  it('allowEmpty：清空提交上报 null，预览转无色', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField fieldLabel="填充" defaultValue="#0d99ff" allowEmpty onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement;
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(null);
    expect(document.querySelector('.dfg-colorfield .dfg-swatch__fill')?.className).toContain(
      'dfg-swatch__fill--empty',
    );
  });

  it('未开 allowEmpty：清空提交标错', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField fieldLabel="填充" defaultValue="#0d99ff" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement;
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('禁用：输入不可用', () => {
    render(<ColorField fieldLabel="填充" value="#0d99ff" disabled onChange={() => {}} />);
    expect((screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('TypographyField（字号/字重最小集）', () => {
  const sizes = [
    { value: 12, label: '12' },
    { value: 16, label: '16' },
    { value: 24, label: '24' },
  ];
  const weights = [
    { value: 400, label: '常规' },
    { value: 500, label: '中' },
    { value: 700, label: '粗' },
  ];

  it('分组语义 + 字号/字重两个下拉各具名', () => {
    render(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={sizes}
        weight={400}
        weights={weights}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('group', { name: '文字' })).toBeTruthy();
    const sizeSelect = screen.getByRole('combobox', { name: '字号' }) as HTMLSelectElement;
    const weightSelect = screen.getByRole('combobox', { name: '字重' }) as HTMLSelectElement;
    expect(sizeSelect.value).toBe('16');
    expect(weightSelect.value).toBe('400');
  });

  it('选择上报对应维度，另一维度保持', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={sizes}
        weight={400}
        weights={weights}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: '字号' }), '24');
    expect(onChange).toHaveBeenCalledWith({ size: 24 });

    rerender(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={24}
        sizes={sizes}
        weight={400}
        weights={weights}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: '字重' }), '700');
    expect(onChange).toHaveBeenCalledWith({ weight: 700 });
  });

  it('选项禁用与整组禁用', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={[...sizes, { value: 96, label: '96', disabled: true }]}
        weight={400}
        weights={weights}
        disabled={false}
        onChange={onChange}
      />,
    );
    const sizeSelect = screen.getByRole('combobox', { name: '字号' }) as HTMLSelectElement;
    const disabledOption = [...sizeSelect.options].find((option) => option.value === '96');
    expect(disabledOption?.disabled).toBe(true);

    rerender(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={sizes}
        weight={400}
        weights={weights}
        disabled
        onChange={onChange}
      />,
    );
    expect((screen.getByRole('combobox', { name: '字号' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('combobox', { name: '字重' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it('错误文案经 alert 播报并关联 aria-describedby', () => {
    render(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={sizes}
        weight={400}
        weights={weights}
        invalid
        errorMessage="字体不可用"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('字体不可用');
    const describedBy = screen
      .getByRole('combobox', { name: '字号' })
      .getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)?.textContent).toContain('字体不可用');
  });

  it('fireEvent 触发 change 同样上报（原生 select 语义）', () => {
    const onChange = vi.fn();
    render(
      <TypographyField
        label="文字"
        sizeLabel="字号"
        weightLabel="字重"
        size={16}
        sizes={sizes}
        weight={400}
        weights={weights}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: '字号' }), { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith({ size: 12 });
  });
});
