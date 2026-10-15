// @vitest-environment jsdom
/**
 * 出图面板组件测试（seam：用户可观察的界面行为——提交、进度、取消、失败动作）。
 *
 * 用 fake timers 推轮询（不真等）；断言口径 = 可见文案 + 可访问角色 + data-df-* 挂点。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonRequestError } from '../client';
import { fakeImagePort, probeUnreachable, runStatus } from '../test-utils';
import { ImagePanel } from './ImagePanel';

beforeEach(() => {
  // `shouldAdvanceTime`：假时钟随真实时间自走 —— RTL 的 waitFor 靠真实间隔轮询 DOM，
  // 而轮询推进仍由测试显式 advanceTimersByTime 控制（不受自走影响）。
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** 提交提示词（走真实交互路径）。 */
async function submitPrompt(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('textbox', { name: '提示词' }));
  await user.paste('wasteland gear icon');
  await user.click(screen.getByRole('button', { name: '生成图片' }));
}

describe('出图面板（F5）', () => {
  it('提交 → 轮询推进进度条 → 完成并列出产出文件', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = fakeImagePort({
      statusSequence: [
        runStatus({ state: 'running', progress: { value: 3, max: 20 } }),
        runStatus({
          state: 'succeeded',
          artifacts: [
            {
              fileName: 'icon_00001_.png',
              mimeType: 'image/png',
              sizeBytes: 4096,
              sha256: 'b'.repeat(64),
              storedPath: '/data/image/assets/bbbb.png',
            },
          ],
        }),
      ],
    });
    render(<ImagePanel port={port} defaultOpen />);

    await submitPrompt(user);
    // 第一次轮询（提交后立即）
    await vi.advanceTimersByTimeAsync(0);
    const bar = await screen.findByRole('progressbar', { name: '出图进度' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('20');

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => {
      expect(screen.getByText('已生成')).toBeTruthy();
    });
    expect(screen.getByText('icon_00001_.png')).toBeTruthy();
    expect(port.submittedRequests).toHaveLength(1);
  });

  it('运行中：提交禁用、取消可用；点取消后落到「已取消」', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = fakeImagePort({
      statusSequence: [runStatus({ state: 'running', progress: { value: 1, max: 20 } })],
    });
    render(<ImagePanel port={port} defaultOpen />);
    await submitPrompt(user);
    await vi.advanceTimersByTimeAsync(0);

    expect((screen.getByRole('button', { name: '正在提交' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.getByText('已取消')).toBeTruthy();
    });
    expect(port.cancelCalls).toBe(1);
  });

  it('OOM 失败：给出「降档重试」提示与动作，点后以更低分辨率重提交', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = fakeImagePort({
      statusSequence: [
        runStatus({
          state: 'failed',
          failure: {
            code: 'comfy_oom',
            message: '显存不足（OOM）：建议降一档分辨率/步数后重试',
            actions: ['lower-resolution', 'lower-steps', 'retry-later'],
            missing: [],
            available: [],
          },
        }),
      ],
    });
    render(<ImagePanel port={port} defaultOpen />);
    await user.clear(screen.getByRole('spinbutton', { name: '宽' }));
    await user.type(screen.getByRole('spinbutton', { name: '宽' }), '768');
    await user.clear(screen.getByRole('spinbutton', { name: '高' }));
    await user.type(screen.getByRole('spinbutton', { name: '高' }), '768');
    await submitPrompt(user);
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByText(/显存不足（OOM）/)).toBeTruthy();
    });
    expect(screen.getByText('显存不足：建议降一档分辨率与步数后重试。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '降档重试' }));
    await waitFor(() => {
      expect(port.submittedRequests).toHaveLength(2);
    });
    const second = port.submittedRequests[1] as { inputs: { width: number; height: number } };
    expect(second.inputs.width).toBe(576);
    expect(second.inputs.height).toBe(576);
    // 表单同步到降档后的值（所见即所提交）
    expect((screen.getByRole('spinbutton', { name: '宽' }) as HTMLInputElement).value).toBe('576');
  });

  it('未启动态：面板给出未检测到服务的提示与「重新探测」动作（真跑探测接口）', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = fakeImagePort({ probeSequence: [probeUnreachable(), probeUnreachable()] });
    render(<ImagePanel port={port} defaultOpen />);

    await waitFor(() => {
      expect(screen.getByText('未检测到本地 ComfyUI 服务')).toBeTruthy();
    });
    // daemon 给出的可执行动作逐项渲染（未启动态是一等状态，不是统一报错）
    expect(screen.getByText('一键启动 ComfyUI')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重新探测' }));
    expect(port.probeCalls).toBe(2);
  });

  it('提交期失败（未启动，异常路径）：失败视图带可执行动作，且不丢提示词', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = fakeImagePort({
      submitError: new DaemonRequestError('comfy_unreachable', '未检测到本地 ComfyUI 服务', {
        actions: ['retry-probe', 'set-base-url'],
        missing: [],
        available: [],
      }),
    });
    render(<ImagePanel port={port} defaultOpen />);
    await submitPrompt(user);
    await waitFor(() => {
      expect(screen.getByText('未检测到本地 ComfyUI 服务')).toBeTruthy();
    });
    // 未启动态的一等语义：失败信息旁给出可执行动作
    expect(screen.getByText('检查服务地址')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '提示词' }) as HTMLTextAreaElement).value).toBe(
      'wasteland gear icon',
    );
  });
});
