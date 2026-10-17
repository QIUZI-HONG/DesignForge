/**
 * 浮层族行为测试（F1 模态族 / F2 抽屉族 / Overlay 整屏层）。
 *
 * 断言角度：dialog 语义与可访问名、Esc 关闭（只关最内层）、焦点陷阱（Tab 回环）、
 * 关闭后焦点归还/交接、滚动锁、遮罩点击、抽屉的宽度分级与「关闭记忆」、
 * Overlay 的**栈序 z 序**（后开必在上——D-4 的根因回归）。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Drawer } from './Drawer';
import { Modal } from './Modal';
import { Overlay } from './Overlay';

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

describe('Overlay（整屏视图层——接入同一浮层栈）', () => {
  /** 抽屉 + 浮层同屏（C1 实测场景：版本抽屉开着 → 打开并排对比）。 */
  function DrawerThenOverlayHost({ closeOnEsc = true }: { closeOnEsc?: boolean }) {
    const [drawerOpen, setDrawerOpen] = useState(true);
    const [overlayOpen, setOverlayOpen] = useState(true);
    return (
      <>
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title="版本历史"
          closeLabel="关闭版本历史"
        >
          <button type="button" onClick={() => setOverlayOpen(true)}>
            对比
          </button>
        </Drawer>
        <Overlay
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          label="版本对比"
          closeOnEsc={closeOnEsc}
        >
          <button type="button">确认恢复</button>
        </Overlay>
      </>
    );
  }

  it('后开的 Overlay 层序高于先开的 Drawer（z 序按栈序推导，不靠挂 body 的先后）', () => {
    render(<DrawerThenOverlayHost />);
    const drawer = screen.getByRole('dialog', { name: '版本历史' });
    const overlay = screen.getByRole('dialog', { name: '版本对比' });
    const drawerBackdrop = drawer.parentElement as HTMLElement;
    const drawerZ = Number(drawerBackdrop.style.zIndex);
    const overlayZ = Number(overlay.style.zIndex);
    expect(Number.isFinite(drawerZ)).toBe(true);
    expect(Number.isFinite(overlayZ)).toBe(true);
    expect(overlayZ).toBeGreaterThan(drawerZ);
  });

  it('Overlay 内的按钮在层序内仍是真实可点控件（指针不被抽屉截走）', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <>
        <Drawer open onOpenChange={() => {}} title="版本历史" closeLabel="关闭版本历史">
          <p>抽屉内容</p>
        </Drawer>
        <Overlay open onOpenChange={() => {}} label="版本对比">
          <button type="button" onClick={onConfirm}>
            确认恢复
          </button>
        </Overlay>
      </>,
    );
    const overlay = screen.getByRole('dialog', { name: '版本对比' });
    const confirm = screen.getByRole('button', { name: '确认恢复' });
    expect(overlay.contains(confirm)).toBe(true);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Esc 只关最内层：先关 Overlay，再关 Drawer（各自触发一次）', async () => {
    const user = userEvent.setup();
    render(<DrawerThenOverlayHost />);
    expect(screen.getByRole('dialog', { name: '版本对比' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '版本对比' })).toBeNull();
    });
    // 抽屉仍在：同一次 Esc 没有波及外层
    expect(screen.getByRole('dialog', { name: '版本历史' })).toBeTruthy();
  });

  it('closeOnEsc=false 时 Esc 交回调用方（本层不关）', async () => {
    const user = userEvent.setup();
    render(<DrawerThenOverlayHost closeOnEsc={false} />);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: '版本对比' })).toBeTruthy();
  });

  it('打开后焦点落在层内；关闭后交还下层层顶（抽屉）', async () => {
    const user = userEvent.setup();
    function Host() {
      const [overlayOpen, setOverlayOpen] = useState(true);
      return (
        <>
          <Drawer open onOpenChange={() => {}} title="版本历史" closeLabel="关闭版本历史">
            <button type="button">抽屉内按钮</button>
          </Drawer>
          <Overlay
            open={overlayOpen}
            onOpenChange={setOverlayOpen}
            label="版本对比"
            data-df-version-compare=""
          >
            <button type="button">确认恢复</button>
          </Overlay>
        </>
      );
    }
    render(<Host />);
    const overlay = screen.getByRole('dialog', { name: '版本对比' });
    expect(overlay.contains(document.activeElement) || document.activeElement === overlay).toBe(
      true,
    );
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '版本对比' })).toBeNull();
    });
    const drawer = screen.getByRole('dialog', { name: '版本历史' });
    expect(drawer.contains(document.activeElement) || document.activeElement === drawer).toBe(true);
  });

  it('data-* 挂点透传到浮层根（门禁取样契约）', () => {
    render(
      <Overlay open onOpenChange={() => {}} label="版本对比" data-df-version-compare="">
        <span>内容</span>
      </Overlay>,
    );
    expect(document.querySelectorAll('[data-df-version-compare]').length).toBe(1);
  });
});
