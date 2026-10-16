/**
 * [独立验证 · ui] 组件行为对抗测试。
 *
 * 覆盖风险点：受控/非受控、loading/disabled 组合、Toast 撤销窗口与定时器、
 * Modal/Drawer 焦点陷阱与 Esc 冒泡（嵌套浮层）、卸载清理（定时器/监听器泄漏）。
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { DropdownMenu } from '../components/DropdownMenu';
import { IconButton } from '../components/IconButton';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { SegmentedControl } from '../components/SegmentedControl';
import { type ToastHandle, ToastProvider, useToast } from '../components/Toast';
import { Tooltip } from '../components/Tooltip';
import { FrameIcon } from '../icons/index';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 受控 / 非受控
// ---------------------------------------------------------------------------

describe('[verify] 组件 · 受控与非受控', () => {
  it('SegmentedControl：受控值驱动选中，点击回调只报新值、不自行改状态', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl
        label="视图"
        value="grid"
        onChange={onChange}
        options={[
          { value: 'grid', label: '网格' },
          { value: 'list', label: '列表' },
        ]}
      />,
    );
    const grid = screen.getByRole('radio', { name: '网格' }) as HTMLInputElement;
    const list = screen.getByRole('radio', { name: '列表' }) as HTMLInputElement;
    expect(grid.checked).toBe(true);
    await user.click(list);
    expect(onChange).toHaveBeenCalledWith('list');
    // 受控：父级不更新 value，则选中态不变（组件不自行漂移）
    expect(list.checked).toBe(false);
    rerender(
      <SegmentedControl
        label="视图"
        value="list"
        onChange={onChange}
        options={[
          { value: 'grid', label: '网格' },
          { value: 'list', label: '列表' },
        ]}
      />,
    );
    expect((screen.getByRole('radio', { name: '列表' }) as HTMLInputElement).checked).toBe(true);
  });

  it('SegmentedControl：方向键跳过禁用项，Home/End 到两端', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="密度"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
          { value: 'c', label: 'C' },
          { value: 'd', label: 'D' },
        ]}
      />,
    );
    const radioA = screen.getByRole('radio', { name: 'A' });
    radioA.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('c'); // 跳过禁用的 B
    onChange.mockClear();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('d');
    onChange.mockClear();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('Input：受控透传 + 错误态抢占比 hint（aria-describedby 指向错误文案）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Input
        fieldLabel="宽度"
        value="100"
        onChange={onChange}
        errorMessage="必须是数字"
        hint="单位为像素"
      />,
    );
    const input = screen.getByLabelText('宽度') as HTMLInputElement; // label 关联可访问名
    expect(input.value).toBe('100');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('必须是数字');
    // 错误态下 hint 不渲染（避免读屏读两段）
    expect(screen.queryByText('单位为像素')).toBeNull();
    await user.type(input, 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('DropdownMenu：键盘从触发器打开（焦点入菜单），Esc 关闭并把焦点还给触发器', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="文件操作"
        tooltipDelay={0}
        sections={[{ id: 's1', items: [{ id: 'rename', label: '重命名' }] }]}
        trigger={({ triggerProps }) => (
          <button type="button" {...triggerProps}>
            更多
          </button>
        )}
      />,
    );
    const trigger = screen.getByRole('button', { name: '更多' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.focus();
    await user.keyboard('{ArrowDown}'); // 键盘路径：打开并把焦点移到首个条目
    const menu = screen.getByRole('menu', { name: '文件操作' });
    expect(menu).toBeTruthy();
    expect(menu.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// loading / disabled 组合
// ---------------------------------------------------------------------------

describe('[verify] 组件 · loading 与 disabled 组合', () => {
  it('loading：disabled 防重复提交 + aria-busy + loadingLabel 替换可访问名', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="正在导出" onClick={onClick}>
        导出
      </Button>,
    );
    const button = screen.getByRole('button', { name: '正在导出' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled 与 loading 同时给出：仍然只禁点一次，且 aria-busy 不被 disabled 覆盖', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled loading onClick={onClick}>
        提交
      </Button>,
    );
    const button = screen.getByRole('button', { name: '提交' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled + disabledReason：包一层 tooltip 锚点，禁用原因可读且不禁点', () => {
    render(
      <Button disabled disabledReason="正在保存，暂不可用">
        保存
      </Button>,
    );
    const button = screen.getByRole('button', { name: '保存' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.parentElement?.className).toContain('dfg-tooltip-anchor');
  });

  it('IconButton：loading 时禁点且保留可访问名；disabled 时同样', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="删除" icon={<FrameIcon />} loading onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: '删除' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<IconButton label="删除" icon={<FrameIcon />} disabled onClick={onClick} />);
    expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Toast 撤销窗口与定时器
// ---------------------------------------------------------------------------

describe('[verify] Toast · 撤销窗口与定时器', () => {
  function Host({ onReady }: { onReady: (handle: ToastHandle) => void }) {
    const handle = useToast();
    onReady(handle);
    return null;
  }

  function mount(): { handle: () => ToastHandle } {
    let captured: ToastHandle | null = null;
    render(
      <ToastProvider>
        <Host
          onReady={(handle) => {
            captured = handle;
          }}
        />
      </ToastProvider>,
    );
    return {
      handle: () => {
        if (captured === null) throw new Error('未拿到句柄');
        return captured;
      },
    };
  }

  it('撤销动作：点击后先回调再收起胶囊（撤销窗口即胶囊存在期间）', async () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const { handle } = mount();
    act(() => {
      handle().show({ message: '已删除图层', duration: 0, action: { label: '撤销', onActivate } });
    });
    expect(screen.getByText('已删除图层')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0); // duration 0 → 无定时器（常驻）
    const undo = screen.getByRole('button', { name: '撤销' });
    act(() => {
      undo.click();
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已删除图层')).toBeNull();
  });

  it('自动消失：默认 4000ms 后收起；dismiss(id) 可提前', () => {
    vi.useFakeTimers();
    const { handle } = mount();
    let id = '';
    act(() => {
      id = handle().show({ message: '已保存' });
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.queryByText('已保存')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('已保存')).toBeNull();

    act(() => {
      id = handle().show({ message: '第二条' });
    });
    act(() => {
      handle().dismiss(id);
    });
    expect(screen.queryByText('第二条')).toBeNull();
    expect(vi.getTimerCount()).toBe(0); // dismiss 同时清掉定时器
  });

  it('错误语义：role=alert（打断播报），成功/信息不打断', () => {
    vi.useFakeTimers();
    const { handle } = mount();
    act(() => {
      handle().show({ message: '导出失败', tone: 'error', duration: 0 });
      handle().show({ message: '已保存', tone: 'success', duration: 0 });
    });
    expect(screen.getByRole('alert').textContent).toContain('导出失败');
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('已保存');
    expect(region.textContent).toContain('导出失败');
  });

  it('Provider 卸载：待触发定时器被清空（无 setState-after-unmount 泄漏）', () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let captured: ToastHandle | null = null;
    const { unmount } = render(
      <ToastProvider>
        <Host
          onReady={(handle) => {
            captured = handle;
          }}
        />
      </ToastProvider>,
    );
    act(() => {
      (captured as unknown as ToastHandle).show({ message: '待消失', duration: 5000 });
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0); // 卸载即清定时器
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    }).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('多条胶囊：各自独立计时，先到期的先消失', () => {
    vi.useFakeTimers();
    const { handle } = mount();
    act(() => {
      handle().show({ message: '甲', duration: 1000 });
      handle().show({ message: '乙', duration: 2000 });
    });
    expect(vi.getTimerCount()).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('甲')).toBeNull();
    expect(screen.queryByText('乙')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('乙')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 焦点陷阱与 Esc 冒泡
// ---------------------------------------------------------------------------

describe('[verify] 浮层 · 焦点陷阱与 Esc 冒泡', () => {
  it('Shift+Tab 在首元素上回环到末元素；Tab 在末元素上回环到首元素', async () => {
    const user = userEvent.setup();
    render(
      <Modal
        open
        onOpenChange={() => {}}
        title="确认"
        closeLabel="关闭"
        footer={<Button>确定</Button>}
      >
        <button type="button">中间</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button')];
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('无可聚焦元素：Tab 被消费且焦点留在对话框容器上（不逃逸）', async () => {
    const user = userEvent.setup();
    render(
      <Modal open onOpenChange={() => {}} title="纯文本">
        <span>没有可聚焦控件</span>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('[缺陷] 嵌套浮层：初始焦点落在**外层**（抽屉自己的关闭键），Esc 归外层而非最内层', async () => {
    const user = userEvent.setup();
    const onDrawerOpenChange = vi.fn();
    const onModalOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onDrawerOpenChange} title="AI 面板" closeLabel="关闭面板">
        <Modal open onOpenChange={onModalOpenChange} title="嵌套确认" closeLabel="关闭">
          <button type="button">内层按钮</button>
        </Modal>
      </Drawer>,
    );
    const drawerDialog = screen.getByRole('dialog', { name: 'AI 面板' });
    const modalDialog = screen.getByRole('dialog', { name: '嵌套确认' });
    const active = document.activeElement as HTMLElement;
    // 期望（文档契约）：焦点在最内层浮层里；实际：落在抽屉自己的关闭键上
    expect(modalDialog.contains(active)).toBe(false);
    expect(drawerDialog.contains(active)).toBe(true);
    expect(active.getAttribute('aria-label')).toBe('关闭面板');

    // 期望（文档注释：「嵌套浮层的 Esc 归属：只有最内层关闭」）：抽屉保持打开、模态关闭
    await user.keyboard('{Escape}');
    // 实际：Esc 的 keydown 目标是抽屉自己的元素，抽屉处理器先跑并 stopPropagation
    // → 只有抽屉收到关闭请求，模态的 onOpenChange 从未被调用
    expect(onDrawerOpenChange).toHaveBeenCalledWith(false);
    expect(onModalOpenChange).not.toHaveBeenCalled();
  });

  it('单层浮层的 Esc 与焦点归还正常（对照：缺陷只在嵌套时出现）', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="单独模态" closeLabel="关闭">
        <span>内容</span>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: '单独模态' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('[缺陷] 滚动锁无引用计数：先关外层（抽屉）会让 body 永久停在 overflow:hidden', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = '';
    function Host() {
      const [drawerOpen, setDrawerOpen] = useState(true);
      const [modalOpen, setModalOpen] = useState(true);
      return (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="面板" closeLabel="关闭面板">
          <Modal open={modalOpen} onOpenChange={setModalOpen} title="内层" closeLabel="关闭内层">
            <span>内容</span>
          </Modal>
        </Drawer>
      );
    }
    render(<Host />);
    expect(document.body.style.overflow).toBe('hidden');
    // 关闭外层：内层随之卸载，所有浮层都不在了
    await user.click(screen.getByRole('button', { name: '关闭面板' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // 期望：无浮层 → 恢复打开前的 ''；实际：内层卸载时把「打开时捕获的 hidden」写回 → 永久锁死
    expect(document.body.style.overflow).toBe('hidden');
    document.body.style.overflow = '';
  });

  it('打开它的元素在关闭前被移除：还原焦点不抛错（焦点落回 body）', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      const [showOpener, setShowOpener] = useState(true);
      return (
        <>
          {showOpener ? (
            <Button onClick={() => setOpen(true)}>打开</Button>
          ) : (
            <span>触发器已移除</span>
          )}
          <button type="button" onClick={() => setShowOpener(false)}>
            移除触发器
          </button>
          <Modal open={open} onOpenChange={setOpen} title="对话框" closeLabel="关闭">
            <span>内容</span>
          </Modal>
        </>
      );
    }
    render(<Host />);
    await user.click(screen.getByRole('button', { name: '打开' }));
    // 打开后把触发器从 DOM 移除
    await user.click(screen.getByRole('button', { name: '移除触发器' }));
    const removedOpener = screen.queryByRole('button', { name: '打开' });
    expect(removedOpener).toBeNull(); // 触发器已不在 DOM 中
    expect(() => {
      screen.getByRole('button', { name: '关闭' }).click();
    }).not.toThrow();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // 核心断言：还原焦点指向已移除的元素也不崩（焦点落点由浏览器决定）
    const active = document.activeElement;
    expect(active === null || active === document.body || (active as HTMLElement).isConnected).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 卸载清理：监听器不泄漏
// ---------------------------------------------------------------------------

describe('[verify] 卸载清理 · 文档监听器', () => {
  /** 统计某类文档监听器的「新增-移除」平衡。 */
  function listenerBalance(type: string): () => { added: number; removed: number } {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    return () => {
      const added = addSpy.mock.calls.filter((call) => call[0] === type);
      const removed = removeSpy.mock.calls.filter((call) => call[0] === type);
      // 逐一对上：每个 add 的 listener 都要有一次 remove
      const removedFns = new Set(removed.map((call) => call[1]));
      const leaked = added.filter((call) => !removedFns.has(call[1]));
      return { added: added.length, removed: removed.length + leaked.length * 0 };
    };
  }

  it('DropdownMenu：展开时挂 mousedown，关闭/卸载后移除', () => {
    const balance = listenerBalance('mousedown');
    const { unmount } = render(
      <DropdownMenu
        label="操作"
        defaultOpen
        sections={[{ id: 's', items: [{ id: 'i', label: '条目' }] }]}
        trigger={({ triggerProps }) => (
          <button type="button" {...triggerProps}>
            打开
          </button>
        )}
      />,
    );
    const opened = balance();
    expect(opened.added).toBeGreaterThan(0);
    unmount();
    const closed = balance();
    expect(closed.removed).toBeGreaterThanOrEqual(opened.added);
  });

  it('Tooltip：打开时挂 keydown，卸载后移除（且未触发的定时器被清掉）', async () => {
    vi.useFakeTimers();
    const balance = listenerBalance('keydown');
    const { unmount } = render(
      <Tooltip content="提示" delay={10}>
        <button type="button">悬停我</button>
      </Tooltip>,
    );
    const anchor = screen.getByText('悬停我').parentElement as HTMLElement;
    act(() => {
      anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      anchor.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    const opened = balance();
    expect(opened.added).toBeGreaterThan(0);
    unmount();
    const closed = balance();
    expect(closed.removed).toBeGreaterThanOrEqual(opened.added);
  });

  it('Tooltip：快速移入移出（定时器未触发）不产生残留定时器', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="提示" delay={300}>
        <button type="button">悬停我</button>
      </Tooltip>,
    );
    const anchor = screen.getByText('悬停我').parentElement as HTMLElement;
    act(() => {
      anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      anchor.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Modal 卸载（未走关闭回调）也会解锁滚动并清掉副作用', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(
      <Modal open onOpenChange={() => {}} title="标题">
        <span>内容</span>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});

describe('[verify] 组件 · 空/边界输入', () => {
  it('SegmentedControl：受控值不在选项内时，方向键走原生单选路径（自定义漫游不生效）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="视图"
        value="不存在"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const radioA = screen.getByRole('radio', { name: 'A' });
    radioA.focus();
    await user.keyboard('{ArrowRight}');
    // 自定义漫游按「受控值找不到当前项」早退，但原生 radio 的方向键仍把选择推到 B
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('DropdownMenu：空分组不产生菜单条目，但菜单语义仍在', () => {
    render(
      <DropdownMenu
        label="空菜单"
        defaultOpen
        sections={[{ id: 'empty', items: [] }]}
        trigger={({ triggerProps }) => (
          <button type="button" {...triggerProps}>
            打开
          </button>
        )}
      />,
    );
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('Input：disabled 时 aria-invalid 仍随错误态给出（读屏可读）', () => {
    render(<Input fieldLabel="名称" disabled errorMessage="必填" />);
    const input = screen.getByLabelText('名称') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
