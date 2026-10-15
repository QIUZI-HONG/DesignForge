// @vitest-environment jsdom
/**
 * 删除确认对话框测试（FE-02 · B12 删除两步确认的第二步）。
 *
 * 语义要点：这是**危险动作的最后一道门**——确认键必须是危险语义色（`variant="danger"`，
 * 视觉由令牌保证），默认焦点不落在确认键上（Modal 把焦点给卡片本身），取消路径必须始终可用。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DeleteConfirmDialog } from './DeleteConfirmDialog';

function renderDialog(overrides: Partial<Parameters<typeof DeleteConfirmDialog>[0]> = {}) {
  const props = {
    open: true,
    documentName: '海报 A',
    pending: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<DeleteConfirmDialog {...props} />);
  return props;
}

describe('DeleteConfirmDialog', () => {
  it('关闭时不渲染对话框', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('打开时说明删的是哪个文档，并声明不可恢复', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('删除「海报 A」？')).toBeDefined();
    expect(within(dialog).getByText(/正文不可恢复/)).toBeDefined();
  });

  it('取消 → onCancel（不触发确认）', async () => {
    const props = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('确认 → onConfirm（危险语义按钮）', async () => {
    const props = renderDialog();
    const confirm = screen.getByRole('button', { name: '删除' });
    expect(confirm.className).toContain('dfg-btn--danger');
    await userEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('删除进行中：确认键进加载态（无障碍名切到「正在删除…」）且不可重复点，取消路径仍在', () => {
    renderDialog({ pending: true });
    const confirm = screen.getByRole('button', { name: '正在删除…' });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '取消' })).toBeDefined();
  });
});
