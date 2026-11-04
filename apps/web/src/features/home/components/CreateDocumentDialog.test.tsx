// @vitest-environment jsdom
/**
 * 新建文件对话框测试（FE-02 · B5 新建菜单的落地动作）。
 *
 * 校验口径与 daemon 一致（`isValidDocumentName`，契约里的文档名规则）：
 * 前端先拦一道，避免把注定失败的请求打到 daemon；失败也由对话框就地反馈。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
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

  it('分因文案：超长（>64）与非法字符各自给因由，不用「请输入文件名称」兜底（UX-11）', async () => {
    renderDialog();
    const input = screen.getByRole('textbox', { name: '文件名称' });
    await userEvent.clear(input);
    await userEvent.type(input, 'x'.repeat(70));
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getByRole('alert').textContent).toBe('文件名称最多 64 个字符');

    await userEvent.clear(input);
    await userEvent.type(input, 'a/b:c*');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getByRole('alert').textContent).toBe(
      '文件名称不能包含 \\ / : * ? " < > | 等字符，且不能以「.」开头',
    );
  });

  it('默认名与「打开」同一次提交落位（打开后立刻输入不被覆盖 · UX-11 竞态硬化）', () => {
    // 为什么用 createRoot + flushSync 而不是 RTL 的 rerender：竞态发生在
    // 「打开提交完成 → 默认名落位」之间——真实浏览器里 e2e 首跑据此拼出
    // 「未命名设计冒烟文档」（默认名迟到，压在被 automation 写入的值上）。
    // RTL 的 act 会把 effect 一并冲掉，这个窗口在断言里就消失了。
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = { pending: false, onCancel: vi.fn(), onSubmit: vi.fn() };
    try {
      flushSync(() => {
        root.render(<CreateDocumentDialog open={false} {...props} />);
      });
      flushSync(() => {
        root.render(<CreateDocumentDialog open {...props} />);
      });
      // 提交完成、任何 effect 都还没跑：此时输入框就应是默认名
      // （Modal 走 portal，节点在 document.body 下，用 role 查询）
      expect(screen.getByRole('textbox', { name: '文件名称' })).toHaveProperty(
        'value',
        '未命名设计',
      );
    } finally {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
      environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  it('重新打开回到默认名（上次输入不残留）', async () => {
    const props = { open: true, pending: false, onCancel: vi.fn(), onSubmit: vi.fn() };
    const view = render(<CreateDocumentDialog {...props} />);
    const input = screen.getByRole('textbox', { name: '文件名称' });
    await userEvent.clear(input);
    await userEvent.type(input, '草稿名');
    view.rerender(<CreateDocumentDialog {...props} open={false} />);
    view.rerender(<CreateDocumentDialog {...props} open />);
    expect(screen.getByRole('textbox', { name: '文件名称' })).toHaveProperty('value', '未命名设计');
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

  describe('提交失败后焦点归位（票 09）', () => {
    /** 可切 pending/open 的宿主：模拟父级「提交在飞 → 失败回落（对话框仍开）」。 */
    function renderTogglingDialog() {
      const props = { open: true, pending: false, onCancel: vi.fn(), onSubmit: vi.fn() };
      const view = render(<CreateDocumentDialog {...props} />);
      const setProps = (next: Partial<typeof props>) => {
        view.rerender(<CreateDocumentDialog {...props} {...next} />);
      };
      return { props, setProps };
    }

    it('提交失败（pending 回落且对话框仍开）→ 焦点回到名称输入框；Esc 恢复关闭', async () => {
      const user = userEvent.setup();
      const { props, setProps } = renderTogglingDialog();
      // 真实缺陷路径：鼠标点「创建」→ 创建键禁用/恢复 → 真浏览器把焦点落回 body（票 09）
      await user.click(screen.getByRole('button', { name: '创建' }));
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
      // jsdom 不自发复现「禁用聚焦中的按钮 → 丢焦」，按同一时刻的焦点终态模拟（blur 出去）
      screen.getByRole('button', { name: '创建' }).blur();

      setProps({ pending: true }); // 创建在飞
      setProps({ pending: false }); // 失败回落：对话框仍开着

      const input = screen.getByRole('textbox', { name: '文件名称' });
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
      await user.keyboard('{Escape}');
      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });

    it('客户端校验失败（空名）→ 焦点回到首个非法字段（输入框），分因文案不变', async () => {
      const user = userEvent.setup();
      const { props } = renderTogglingDialog();
      await user.clear(screen.getByRole('textbox', { name: '文件名称' }));
      await user.click(screen.getByRole('button', { name: '创建' }));
      expect(props.onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe('请输入文件名称');
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '文件名称' }));
    });

    it('成功路径行为不变：open 随成功关闭，不再把焦点抢回输入框', async () => {
      const user = userEvent.setup();
      const { props, setProps } = renderTogglingDialog();
      await user.click(screen.getByRole('button', { name: '创建' }));
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
      setProps({ pending: true });
      setProps({ open: false, pending: false }); // 成功：父级关对话框
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(screen.queryByRole('textbox', { name: '文件名称' })).toBeNull();
    });
  });
});
