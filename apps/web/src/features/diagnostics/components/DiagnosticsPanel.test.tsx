// @vitest-environment jsdom
/**
 * 诊断面板组件测试（seam：用户可观察的界面行为——环境行、连通性逐项状态与重试、日志尾部）。
 *
 * 断言口径：可见文案（i18n 真源）+ 可访问角色；数据形状由 environment.test.ts 覆盖。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeDiagnosticsPort } from '../test-utils';
import { DiagnosticsPanel } from './DiagnosticsPanel';

/** 测试用环境注入（jsdom 的 UA 不稳定，固定一份）。 */
const ENV = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  language: 'zh-CN',
  devicePixelRatio: 1.5,
  viewport: { width: 1440, height: 900 },
};

describe('诊断面板（F8）', () => {
  it('渲染版本与环境：daemon 版本、运行时长（ICU 拼接）、工作目录、视口与像素比', async () => {
    const port = fakeDiagnosticsPort();
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);

    await screen.findByText('@dforge/daemon 0.1.0');
    const envSection = screen.getByRole('region', { name: '版本与环境' });
    expect(within(envSection).getByText('本地服务版本')).toBeTruthy();
    expect(within(envSection).getByText('1 小时 2 分')).toBeTruthy();
    expect(within(envSection).getByText('/home/user/designs')).toBeTruthy();
    expect(within(envSection).getByText('1440×900')).toBeTruthy();
    expect(within(envSection).getByText('浏览器')).toBeTruthy();
  });

  it('连通性自检逐项：三项各自状态与可执行动作都渲染（未启动 + 未配置同屏）', async () => {
    const port = fakeDiagnosticsPort();
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);

    const section = await screen.findByRole('region', { name: '连通性自检' });
    const comfy = within(section).getByText('ComfyUI 出图').closest('[data-df-connectivity-item]');
    const ai = within(section)
      .getByText('DeepSeek（文本 AI）')
      .closest('[data-df-connectivity-item]');
    expect(comfy?.getAttribute('data-df-connectivity-status')).toBe('unavailable');
    expect(within(comfy as HTMLElement).getByText('不可用')).toBeTruthy();
    expect(ai?.getAttribute('data-df-connectivity-status')).toBe('not-configured');
    expect(within(ai as HTMLElement).getByText('未配置')).toBeTruthy();
    // daemon 项正常
    const daemonItem = within(section).getByText('本地服务').closest('[data-df-connectivity-item]');
    expect(daemonItem?.getAttribute('data-df-connectivity-status')).toBe('ok');
    // 逐项动作（重启探测 / 配置凭据）与逐项重试
    expect(within(comfy as HTMLElement).getByText('检查服务地址')).toBeTruthy();
    expect(within(section).getByRole('button', { name: '重试：ComfyUI 出图' })).toBeTruthy();
  });

  it('逐项重试与「重新自检」都会重新发起自检（同一 daemon 调用，本段无逐项端点）', async () => {
    const user = userEvent.setup();
    const port = fakeDiagnosticsPort();
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);
    await screen.findByRole('region', { name: '连通性自检' });
    expect(port.connectivityCalls).toBe(1);

    await user.click(screen.getByRole('button', { name: '重试：ComfyUI 出图' }));
    await waitFor(() => {
      expect(port.connectivityCalls).toBe(2);
    });
    await user.click(screen.getByRole('button', { name: '重新自检' }));
    await waitFor(() => {
      expect(port.connectivityCalls).toBe(3);
    });
  });

  it('日志尾部：默认展示最后 N 条（含事件名与载荷摘要）与来源说明', async () => {
    const port = fakeDiagnosticsPort();
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);

    const section = await screen.findByRole('region', { name: '日志尾部' });
    expect(within(section).getByText(/ai\.degraded/)).toBeTruthy();
    expect(within(section).getByText(/image\.run\.submitted/)).toBeTruthy();
    expect(within(section).getByText('来源：本地事件日志（仅本机，不上云）')).toBeTruthy();
  });

  it('日志为空 → 空态文案（不是空白）', async () => {
    const port = fakeDiagnosticsPort({ events: { events: [], total: 0 } });
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);
    const section = await screen.findByRole('region', { name: '日志尾部' });
    expect(within(section).getByText('暂无日志。')).toBeTruthy();
  });

  it('daemon 不可达 → 错误横幅 + 环境行「未连接」，点重试恢复后正常渲染（F14 错误态族）', async () => {
    const user = userEvent.setup();
    const port = fakeDiagnosticsPort({ healthFailures: 1 });
    render(<DiagnosticsPanel port={port} env={ENV} open onOpenChange={() => undefined} />);

    expect(await screen.findByText('本地服务不可达')).toBeTruthy();
    expect(screen.getByText(/未能连接本地 daemon/)).toBeTruthy();
    // 环境行给出「未连接」而非空白（面板在同一布局下可断言两态）
    const envSection = screen.getByRole('region', { name: '版本与环境' });
    expect(within(envSection).getAllByText('未连接').length).toBeGreaterThan(0);
    // 连通性段在无数据时同样给出未连接提示，而不是三条假状态
    const connSection = screen.getByRole('region', { name: '连通性自检' });
    expect(within(connSection).getByText('未连接')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(screen.getByText('@dforge/daemon 0.1.0')).toBeTruthy();
    });
    expect(port.healthCalls).toBe(2);
    expect(screen.queryByText('本地服务不可达')).toBeNull();
  });
});
