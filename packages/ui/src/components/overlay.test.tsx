/**
 * 浮层族行为测试（F1 模态族 / F2 抽屉族）。
 *
 * 断言角度：dialog 语义与可访问名、Esc 关闭、焦点陷阱（Tab 回环）、
 * 关闭后焦点归还、滚动锁、遮罩点击、抽屉的宽度分级与「关闭记忆」。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Drawer } from './Drawer';
import { Modal } from './Modal';

/** 受控宿主：模拟调用方的开合管理。 */
function ModalHost({ closeOnBackdrop = true }: { closeOnBackdrop?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开对话框</Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="删除文件"
        description="删除后无法恢复"
        closeLabel="关闭"
        closeOnBackdrop={closeOnBackdrop}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              删除
            </Button>
          </>
        }
      >
        <button type="button">中间按钮</button>
      </Modal>
    </>
  );
}

describe('Modal（F1 模态族）', () => {
  it('打开后是具名 dialog，且初始焦点落在对话框内', async () => {
    const user = userEvent.setup();
    const trigger = render(<ModalHost />);
    await user.click(screen.getByRole('button', { name: '打开对话框' }));
    const dialog = screen.getByRole('dialog', { name: '删除文件' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('删除后无法恢复')).toBeTruthy();
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true);
    trigger.unmount();
  });

  it('Esc 关闭并归还焦点给打开它的按钮', async () => {
    const user = userEvent.setup();
    render(<ModalHost />);
    const opener = screen.getByRole('button', { name: '打开对话框' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
  });

  it('焦点陷阱：Tab 在对话框内回环，不逃到页面其余部分', async () => {
    const user = userEvent.setup();
    render(<ModalHost />);
    await user.click(screen.getByRole('button', { name: '打开对话框' }));
    const dialog = screen.getByRole('dialog');
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button')];
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const first = focusables[0] as HTMLElement;
    expect(document.activeElement).toBe(first);
  });

  it('打开期间锁滚动，关闭后恢复', async () => {
    const user = userEvent.setup();
    render(<ModalHost />);
    await user.click(screen.getByRole('button', { name: '打开对话框' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });

  it('遮罩点击可关（可配），卡片内点击不关', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="确认">
        <button type="button">卡内按钮</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(screen.getByRole('button', { name: '卡内按钮' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(backdrop);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closeOnBackdrop=false 时遮罩点击不关', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="确认" closeOnBackdrop={false}>
        <span>内容</span>
      </Modal>,
    );
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('关闭按钮经 closeLabel 具名（文案由调用方给）', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="确认" closeLabel="关闭对话框">
        <span>内容</span>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Drawer（F2 抽屉族）', () => {
  function DrawerHost(props: { rememberKey?: string; storage?: Storage }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>打开 AI 面板</Button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          title="AI 助手"
          closeLabel="关闭面板"
          width="lg"
          {...props}
        >
          <p>抽屉内容</p>
        </Drawer>
      </>
    );
  }

  it('右滑入的具名 dialog，宽度分级落类名', async () => {
    const user = userEvent.setup();
    render(<DrawerHost />);
    await user.click(screen.getByRole('button', { name: '打开 AI 面板' }));
    const dialog = screen.getByRole('dialog', { name: 'AI 助手' });
    expect(dialog.className).toContain('dfg-drawer--lg');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Esc 关闭；关闭按钮同样可关', async () => {
    const user = userEvent.setup();
    render(<DrawerHost />);
    await user.click(screen.getByRole('button', { name: '打开 AI 面板' }));
    await user.click(screen.getByRole('button', { name: '关闭面板' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('关闭记忆：rememberKey 把开合持久化到注入的存储', async () => {
    const user = userEvent.setup();
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as Storage;
    render(<DrawerHost rememberKey="dfg-drawer-ai" storage={storage} />);
    await user.click(screen.getByRole('button', { name: '打开 AI 面板' }));
    await waitFor(() => {
      expect(store.get('dfg-drawer-ai')).toBe('true');
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(store.get('dfg-drawer-ai')).toBe('false');
    });
  });

  it('关闭记忆：重新挂载时按存储值恢复展开（非受控 defaultOpen）', () => {
    const storage = {
      getItem: () => 'true',
      setItem: () => {},
    } as unknown as Storage;
    render(
      <Drawer title="AI 助手" rememberKey="dfg-drawer-ai" storage={storage}>
        <p>抽屉内容</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'AI 助手' })).toBeTruthy();
  });
});
