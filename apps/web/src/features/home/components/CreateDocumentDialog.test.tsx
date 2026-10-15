// @vitest-environment jsdom
/**
 * 新建文件对话框测试（FE-02 · B5 新建菜单的落地动作）。
 *
 * 校验口径与 daemon 一致（`isValidDocumentName`，契约里的文档名规则）：
 * 前端先拦一道，避免把注定失败的请求打到 daemon；失败也由对话框就地反馈。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreateDocumentDialog } from './CreateDocumentDialog';

function renderDialog(overrides: Partial<Parameters<typeof CreateDocumentDialog>[0]> = {}) {
  const props = {
    open: true,
    pending: false,
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<CreateDocumentDialog {...props} />);
  return props;
}

describe('CreateDocumentDialog', () => {
  it('打开时带默认文件名（未命名设计）', () => {
    renderDialog();
    expect(screen.getByRole('textbox', { name: '文件名称' })).toHaveProperty('value', '未命名设计');
  });

  it('改名后提交 → onSubmit(名称)', async () => {
    const props = renderDialog();
    const input = screen.getByRole('textbox', { name: '文件名称' });
    await userEvent.clear(input);
    await userEvent.type(input, '海报 B');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(props.onSubmit).toHaveBeenCalledWith('海报 B');
  });

  it('空名称 → 就地报错且不提交', async () => {
    const props = renderDialog();
    await userEvent.clear(screen.getByRole('textbox', { name: '文件名称' }));
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('请输入文件名称');
  });

  it('非法名称（含路径分隔符）→ 不提交', async () => {
    const props = renderDialog();
    const input = screen.getByRole('textbox', { name: '文件名称' });
    await userEvent.clear(input);
    await userEvent.type(input, 'a/b');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('取消 → onCancel', async () => {
    const props = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('创建进行中：创建键加载态不可重复点', () => {
    renderDialog({ pending: true });
    const submit = screen.getByRole('button', { name: '创建' });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.hasAttribute('disabled')).toBe(true);
  });
});
