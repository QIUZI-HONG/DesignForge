// @vitest-environment jsdom
/**
 * 四步引导组件测试（FE-09 · 清单 E4）。
 *
 * 断言角度：当前步高亮（aria-current=step）、已完成勾选 / 跳过分形、前进/回退/跳过、
 * 「完成」把每步结果落库到 daemon（patchConfig / setApiKey 逐分区载荷）、
 * 保存失败原样文案 + 重试；密钥明文不留在 DOM。
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DaemonClientError } from '../api/daemon-client';
import type { SettingsApi } from '../api/settings-api';

import { OnboardingWizard } from './onboarding-wizard';
import { CONFIG_RESPONSE, makeApi, renderWithToast } from './settings-fixtures';

/** 步骤条（有序列表）里的四步。 */
function stepItems(): HTMLElement[] {
  return within(screen.getByRole('list', { name: '引导步骤' })).getAllByRole('listitem');
}

describe('四步引导 · 步骤机与步骤条', () => {
  it('四步与设置分区同源同序；初始第一步为当前步，其余待办', async () => {
    renderWithToast(<OnboardingWizard api={makeApi()} />);

    const items = stepItems();
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('工作目录'),
      expect.stringContaining('DeepSeek'),
      expect.stringContaining('ComfyUI'),
      expect.stringContaining('埋点与数据'),
    ]);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([
      'step',
      null,
      null,
      null,
    ]);
    expect(screen.getByText('已处理 0/4 步')).toBeTruthy();
    // 第一步表单已就地渲染（与设置分区同组件）
    expect(await screen.findByLabelText('工作目录')).toBeTruthy();
    // 首步不可回退
    expect((screen.getByRole('button', { name: '上一步' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('下一步 = 落库当前步 + 前进：第一步记「已完成」，第二步高亮', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderWithToast(<OnboardingWizard api={api} />);

    const input = await screen.findByLabelText('工作目录');
    await user.clear(input);
    await user.type(input, '~/设计');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(api.patchConfig).toHaveBeenCalledWith({ workspaceDir: '~/设计' });
    expect(await screen.findByText('已处理 1/4 步')).toBeTruthy();
    const items = stepItems();
    expect(items[0]?.textContent).toContain('已完成');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByLabelText('API 密钥')).toBeTruthy();
  });

  it('可跳过：不落库、记「已跳过」并前进', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderWithToast(<OnboardingWizard api={api} />);

    await screen.findByLabelText('工作目录');
    await user.click(screen.getByRole('button', { name: '跳过' }));

    expect(api.patchConfig).not.toHaveBeenCalled();
    expect(stepItems()[0]?.textContent).toContain('已跳过');
    expect(stepItems()[1]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('已处理 1/4 步')).toBeTruthy();
  });

  it('回退：旧结果不越权显示（当前步优先），再前进可改判结果', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderWithToast(<OnboardingWizard api={api} />);

    await screen.findByLabelText('工作目录');
    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.click(screen.getByRole('button', { name: '上一步' }));

    // 回到首步：呈 current（不是「已跳过」），且首步回退按钮重新禁用
    const items = stepItems();
    expect(items[0]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.textContent).not.toContain('已跳过');

    // 改判：本步直接「下一步」（无改动也落库一次，幂等）→ 记「已完成」
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(api.patchConfig).toHaveBeenCalledWith({ workspaceDir: '/home/u/设界' });
    expect(stepItems()[0]?.textContent).toContain('已完成');
  });

  it('AI 步：密钥写入后前进，明文不留在 DOM', async () => {
    const rawKey = 'sk-abcdefgh12345678';
    const api = makeApi();
    const user = userEvent.setup();
    const { container } = renderWithToast(<OnboardingWizard api={api} />);

    await screen.findByLabelText('工作目录');
    await user.click(screen.getByRole('button', { name: '跳过' }));
    await user.type(await screen.findByLabelText('API 密钥'), rawKey);
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(api.setApiKey).toHaveBeenCalledWith(rawKey);
    expect(container.innerHTML.includes(rawKey)).toBe(false);
    expect(screen.getByLabelText('服务地址')).toBeTruthy();
  });

  it('保存失败：停留当前步、原样展示 daemon 文案；重试成功后前进', async () => {
    const patchConfig = vi
      .fn<SettingsApi['patchConfig']>()
      .mockRejectedValueOnce(
        new DaemonClientError({
          kind: 'api',
          code: 'config_invalid',
          message: '工作目录不可写：/root/x',
          status: 400,
        }),
      )
      .mockResolvedValueOnce(CONFIG_RESPONSE);
    const api = makeApi({ patchConfig });
    const user = userEvent.setup();
    renderWithToast(<OnboardingWizard api={api} />);

    await screen.findByLabelText('工作目录');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('工作目录不可写：/root/x')).toBeTruthy();
    expect(stepItems()[0]?.getAttribute('aria-current')).toBe('step');

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已处理 1/4 步')).toBeTruthy();
    expect(stepItems()[1]?.getAttribute('aria-current')).toBe('step');
  });
});

describe('四步引导 · 完成态落库', () => {
  it('末步「完成」：埋点开关落库 + 完成卡呈现全部结果；进入工作台触发跳转', async () => {
    const api = makeApi();
    const onFinish = vi.fn();
    const user = userEvent.setup();
    renderWithToast(<OnboardingWizard api={api} onFinish={onFinish} />);

    await screen.findByLabelText('工作目录');
    await user.click(screen.getByRole('button', { name: '跳过' })); // 工作目录（跳过）
    await user.click(await screen.findByRole('button', { name: '跳过' })); // AI（跳过）
    await user.click(await screen.findByRole('button', { name: '跳过' })); // 出图（跳过）
    // 末步：埋点开关（默认「仅本地」）→ 完成
    expect(await screen.findByText('已处理 3/4 步')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '完成' }));

    expect(api.patchConfig).toHaveBeenCalledWith({ telemetry: { enabled: true } });
    expect(await screen.findByText('引导完成')).toBeTruthy();
    const items = stepItems();
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(screen.getByText('已处理 4/4 步')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '进入工作台' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
