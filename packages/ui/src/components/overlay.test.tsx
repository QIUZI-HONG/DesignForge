/**
 * 浮层族行为测试（F1 模态族 / F2 抽屉族 / Overlay 整屏层）。
 *
 * 断言角度：dialog 语义与可访问名、Esc 关闭（只关最内层）、焦点陷阱（Tab 回环）、
 * 关闭后焦点归还/交接、滚动锁、遮罩点击、抽屉的宽度分级与「关闭记忆」、
 * Overlay 的**栈序 z 序**（后开必在上——D-4 的根因回归）。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('浮层 · 异步提交期间的焦点（票 25：焦点不得滞留层外）', () => {
  /**
   * 触发口径（不写清就会写出恒过的判据）。Chromium 里 `disabled` 一个已聚焦的控件会走「取消聚焦」：
   * 对该控件发 blur + focusout，并把焦点交回视口；**jsdom 30 两件事都不做**——它的 unfocusingSteps
   * 见旧目标已不可聚焦就直接返回（`jsdom/lib/jsdom/living/helpers/focusing.js:194`，实测置 disabled
   * 后 `blur()` 是空操作、`activeElement` 仍留在那个按钮上）。所以这里用 `act` + `fireEvent.blur/focusOut`
   * 把浏览器**一定会发出的那两个事件**演出来：被测的接回逻辑读的是事件，不是 jsdom 的焦点簿记。
   * 走原生事件而不走 userEvent：它自己维护焦点簿记，会把刚接回的焦点又放回那个已禁用的控件（实测），
   * 演出来的就不是被测形状。「点一下生成 → 断言焦点还在层内」这类写法在 jsdom **不会红**，是假判据，本文件不写。
   * 完整链路（真浏览器点「生成」→ disabled → Esc 关不掉）由门禁
   * `scripts/verify-ai-two-state.mjs` 的 UI 段第④步钉住，
   * 修复前后的日志都在 `~/df-evidence/v2-review3/verify-ai-two-state.r3-final.log`。
   *
   * 卸载路径同样只能靠真浏览器：jsdom 30 里摘除聚焦元素**不发** blur/focusout（实测），
   * 实现里仍听 `blur`（规范只保证这一条），本文件不假装能测到。
   */
  function AsyncSubmitDrawerHost() {
    const [open, setOpen] = useState(true);
    const [running, setRunning] = useState(false);
    return (
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="AI 助手"
        closeLabel="关闭面板"
        footer={
          <Button loading={running} onClick={() => setRunning(true)}>
            生成
          </Button>
        }
      >
        <p>抽屉内容</p>
      </Drawer>
    );
  }

  /** 模态宿主：同一个形状，钉「两条族共用同一条不变量」。 */
  function AsyncSubmitModalHost() {
    const [open, setOpen] = useState(true);
    const [running, setRunning] = useState(false);
    return (
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="导出"
        footer={
          <Button loading={running} onClick={() => setRunning(true)}>
            导出
          </Button>
        }
      >
        <p>导出面板</p>
      </Modal>
    );
  }

  /** 演一遍浏览器的禁用逃逸：聚焦 → 点击（转 loading）→ 浏览器发 blur/focusout 并把焦点交回视口。 */
  function evictFocusFromSubmit(): HTMLButtonElement {
    const submit = screen.getByRole('button', { name: /生成|导出/ }) as HTMLButtonElement;
    submit.focus();
    act(() => {
      submit.click();
    });
    expect(submit.disabled).toBe(true);
    fireEvent.blur(submit);
    fireEvent.focusOut(submit);
    return submit;
  }

  it('禁用层内已聚焦的控件后，焦点必须由层接回（不许滞留层外）', () => {
    render(<AsyncSubmitDrawerHost />);
    const dialog = screen.getByRole('dialog', { name: 'AI 助手' });
    evictFocusFromSubmit();
    expect(document.activeElement).toBe(dialog);
  });

  it('Modal 同族同判据：焦点被踢出层外后由浮层接回', () => {
    render(<AsyncSubmitModalHost />);
    const dialog = screen.getByRole('dialog', { name: '导出' });
    evictFocusFromSubmit();
    expect(document.activeElement).toBe(dialog);
  });

  it('接回之后 Esc 关得掉抽屉——焦点回层内，按键才有的这条路必须继续通', () => {
    render(<AsyncSubmitDrawerHost />);
    evictFocusFromSubmit();
    // 如实记录：这一条在本机 jsdom 下**不是判别腿**。没有接回时 jsdom 把 activeElement 留在
    // 层内那个已禁用的按钮上，按键照样冒泡到遮罩，实测对 HEAD 也绿；它钉的是「接回之后
    // 按键路径仍通」，而「焦点交回视口 → Esc 到不了层」的因果只有 Chromium 门禁那段能判（见上）。
    // 焦点此刻必须已在层内（前两条钉的就是这件事），从 activeElement 派发才有浏览器的形状
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /** 层外自有控件 + 一直开着的抽屉：钉「接回不许把层变成抢焦点的牢笼」。 */
  function OutsideControlDrawerHost() {
    const [open, setOpen] = useState(true);
    const [running, setRunning] = useState(false);
    return (
      <>
        <Button onClick={() => {}}>层外按钮</Button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          title="AI 助手"
          closeLabel="关闭面板"
          footer={
            <Button loading={running} onClick={() => setRunning(true)}>
              生成
            </Button>
          }
        >
          <p>抽屉内容</p>
        </Drawer>
      </>
    );
  }

  it('焦点在层外时这层是聋的：同一次 Esc 到不了层——反向腿，证明接回那条不是空转', () => {
    // portal 让 React 树与 DOM 树分家：层外的元素不在遮罩的祖先链上，按键冒泡不到那一层。
    // 这条不依赖接回实现，实现怎么写都不该让它变绿；它钉的是因果——上面那条能关掉抽屉，
    // 靠的正是先把焦点接回层内。
    render(<OutsideControlDrawerHost />);
    const outside = screen.getByRole('button', { name: '层外按钮' });
    outside.focus();
    expect(document.activeElement).toBe(outside);
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'AI 助手' })).toBeTruthy();
  });

  it('用户把焦点交给层外的自有控件时不抢回：不变量是「焦点不落空」，不是「不许离开」', () => {
    render(<OutsideControlDrawerHost />);
    const outside = screen.getByRole('button', { name: '层外按钮' });
    // 先让抽屉自己拿一次焦点，再从层外把焦点要走：模拟「浮层开着，用户去点画布背后的控件」
    evictFocusFromSubmit();
    outside.focus();
    // 离散元素是**仍可聚焦**的按钮（不是刚被禁用的那个），接回逻辑必须放行——
    // 否则下拉、吐司、画布背后的控件全被浮层锁死
    expect(document.activeElement).toBe(outside);
  });

  it('浮层关闭后焦点归还打开它的按钮（接回逻辑不得盖掉关闭交接）', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>打开 AI 面板</Button>
          <Drawer
            open={open}
            onOpenChange={setOpen}
            title="AI 助手"
            closeLabel="关闭面板"
            footer={
              <Button loading={open} onClick={() => {}}>
                生成
              </Button>
            }
          >
            <p>抽屉内容</p>
          </Drawer>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: '打开 AI 面板' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
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
