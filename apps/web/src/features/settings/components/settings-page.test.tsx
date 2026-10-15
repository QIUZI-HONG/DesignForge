// @vitest-environment jsdom
/**
 * 设置页组件测试（FE-09 · 清单 E3）。
 *
 * 断言角度（验收标准 §5/§7）：可观测行为——分区导航切换、表单校验提示、
 * 保存态流转（保存中 → 已保存 → 失败重试）、ComfyUI 未启动态、凭据掩码纪律
 * （明文 key 不得出现在 DOM 任何角落）、以及六态证据挂点（data-df-state）的存在性。
 * 依赖注入：`api` 传入假数据面（记录调用），不起 daemon、不出网。
 */
import type { ConfigResponse } from '@dforge/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DaemonClientError } from '../api/daemon-client';
import type { SettingsApi } from '../api/settings-api';

import {
  CONFIG_RESPONSE,
  deferred,
  makeApi,
  NORMALIZED_WORKSPACE,
  REPORT_COMFY_DOWN,
  REPORT_COMFY_UP,
  renderWithToast,
} from './settings-fixtures';
import { SettingsPage } from './settings-page';

/** 渲染设置页（注入假数据面）。 */
function renderPage(api: SettingsApi) {
  return renderWithToast(<SettingsPage api={api} />);
}

/* ---------- 用例 ---------- */

describe('设置页 · 加载与分区导航', () => {
  it('加载期有 loading 态挂点，就绪后渲染标题与四分区导航', async () => {
    const api = makeApi();
    const { container } = renderPage(api);
    expect(container.querySelector('[data-df-state="loading"]')).not.toBeNull();

    expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: '设置分区' });
    for (const name of ['工作目录', 'DeepSeek', 'ComfyUI', '埋点与数据']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // 默认落在第一个分区（工作目录），且其导航项为当前项
    expect(screen.getByRole('button', { name: '工作目录' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(nav).toBeTruthy();
    await waitFor(() => {
      expect(container.querySelector('[data-df-state="loading"]')).toBeNull();
    });
  });

  it('切换分区：AI / ComfyUI / 埋点各自渲染对应表单', async () => {
    const user = userEvent.setup();
    renderPage(makeApi());

    await user.click(await screen.findByRole('button', { name: 'DeepSeek' }));
    expect(screen.getByLabelText('API 密钥')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'ComfyUI' }));
    expect(screen.getByLabelText('服务地址')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '埋点与数据' }));
    expect(screen.getByText('/home/u/.dforge')).toBeTruthy();
  });

  it('加载失败：error 态挂点 + 重新加载可恢复', async () => {
    const loadConfig = vi
      .fn<SettingsApi['loadConfig']>()
      .mockRejectedValueOnce(
        new DaemonClientError({ kind: 'network', message: '本地服务未启动（测试）' }),
      )
      .mockResolvedValueOnce(CONFIG_RESPONSE);
    const api = makeApi({ loadConfig });
    const user = userEvent.setup();
    const { container } = renderPage(api);

    expect(await screen.findByText('无法连接本地服务')).toBeTruthy();
    expect(screen.getByText('本地服务未启动（测试）')).toBeTruthy();
    expect(container.querySelector('[data-df-state="error"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeTruthy();
  });
});

describe('设置页 · 凭据掩码纪律', () => {
  it('只显示掩码；输入框为 password；保存新密钥后清空输入且 DOM 中无明文', async () => {
    const rawKey = 'sk-abcdefgh12345678';
    const setApiKey = vi.fn(async () => ({
      ...CONFIG_RESPONSE.credentials.deepseek,
      maskedKey: 'sk-…5678',
    }));
    const api = makeApi({ setApiKey });
    const user = userEvent.setup();
    const { container } = renderPage(api);

    await user.click(await screen.findByRole('button', { name: 'DeepSeek' }));
    expect(screen.getByText('已配置：sk-…wxyz（本机加密凭据库）')).toBeTruthy();

    const input = screen.getByLabelText('API 密钥');
    expect(input.getAttribute('type')).toBe('password');

    await user.type(input, rawKey);
    await user.click(screen.getByRole('button', { name: '保存密钥' }));

    expect(await screen.findByText('已配置：sk-…5678（本机加密凭据库）')).toBeTruthy();
    expect(setApiKey).toHaveBeenCalledWith(rawKey);
    expect((input as HTMLInputElement).value).toBe('');
    expect(container.innerHTML.includes(rawKey)).toBe(false);
  });

  it('清除密钥：落库后回到未配置降级说明', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole('button', { name: 'DeepSeek' }));
    await user.click(screen.getByRole('button', { name: '清除密钥' }));

    expect(await screen.findByText(/未配置密钥：AI 为降级态/)).toBeTruthy();
    expect(api.clearApiKey).toHaveBeenCalledTimes(1);
  });

  it('密钥形态不合法：内联报错且不发请求', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole('button', { name: 'DeepSeek' }));
    await user.type(screen.getByLabelText('API 密钥'), 'not-a-key');
    await user.click(screen.getByRole('button', { name: '保存密钥' }));

    expect(await screen.findByText('密钥形态不正确（期望 sk- 前缀 + 长串）')).toBeTruthy();
    expect(api.setApiKey).not.toHaveBeenCalled();
  });
});

describe('设置页 · 工作目录与保存态', () => {
  it('空值校验：内联报错、不发请求', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    renderPage(api);

    const input = await screen.findByLabelText('工作目录');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('不能为空。')).toBeTruthy();
    expect(api.patchConfig).not.toHaveBeenCalled();
  });

  it('保存中 → 已保存：输入框回填 daemon 归一化后的路径', async () => {
    const pending = deferred<ConfigResponse>();
    const patchConfig = vi.fn(() => pending.promise);
    const api = makeApi({ patchConfig });
    const user = userEvent.setup();
    const { container } = renderPage(api);

    const input = await screen.findByLabelText('工作目录');
    await user.clear(input);
    await user.type(input, '~/设计');
    await user.click(screen.getByRole('button', { name: '保存' }));

    // 保存中：按钮进入 loading（可访问名切换 + aria-busy），且保存按钮带 disabled 态挂点
    const busy = screen.getByRole('button', { name: '保存中…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-df-state="disabled"]')).not.toBeNull();

    pending.resolve({
      ...CONFIG_RESPONSE,
      config: { ...CONFIG_RESPONSE.config, workspaceDir: NORMALIZED_WORKSPACE },
    });

    expect(await screen.findByText('已保存')).toBeTruthy();
    expect(patchConfig).toHaveBeenCalledWith({ workspaceDir: '~/设计' });
    expect((screen.getByLabelText('工作目录') as HTMLInputElement).value).toBe(
      NORMALIZED_WORKSPACE,
    );
  });

  it('保存失败：原样展示 daemon 文案，重试成功后转已保存', async () => {
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
    renderPage(api);

    // 先制造改动（无改动时保存按钮禁用），再触发失败 → 重试
    await user.type(await screen.findByLabelText('工作目录'), '~/x');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('工作目录不可写：/root/x')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('已保存')).toBeTruthy();
    expect(patchConfig).toHaveBeenCalledTimes(2);
  });

  it('无改动时保存按钮呈禁用（disabled 态证据挂点随按钮）', async () => {
    const api = makeApi();
    const { container } = renderPage(api);

    const save = await screen.findByRole('button', { name: '保存' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-df-state="disabled"]')).not.toBeNull();
  });
});

describe('设置页 · ComfyUI 未启动态', () => {
  it('未启动：展示不可用说明与建议动作；重新探测后转已连接', async () => {
    const checkConnectivity = vi
      .fn<SettingsApi['checkConnectivity']>()
      .mockResolvedValueOnce(REPORT_COMFY_DOWN)
      .mockResolvedValueOnce(REPORT_COMFY_UP);
    const api = makeApi({ checkConnectivity });
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole('button', { name: 'ComfyUI' }));
    expect(screen.getByText('未探测：点击「重新探测」检查本地服务。')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '重新探测' }));
    expect(await screen.findByText('未检测到本地服务。')).toBeTruthy();
    expect(screen.getByText('不可用')).toBeTruthy();
    expect(screen.getByText('重试探测')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '重新探测' }));
    expect(await screen.findByText('已连接 http://127.0.0.1:8188')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
  });
});

describe('设置页 · 埋点与数据', () => {
  it('数据目录展示 daemon 数据根；复制路径弹 Toast', async () => {
    // userEvent.setup 会装自己的剪贴板桩，故先 setup 再覆盖（后写者生效）
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const api = makeApi();
    renderPage(api);

    await user.click(await screen.findByRole('button', { name: '埋点与数据' }));
    expect(screen.getByText('/home/u/.dforge')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '复制路径' }));
    expect(await screen.findByText('已复制数据目录路径')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('/home/u/.dforge');
  });
});

describe('设置页 · 六态证据挂点', () => {
  it('hover / active 挂点随控件常驻（供后续截图与状态门禁定位）', async () => {
    const { container } = renderPage(makeApi());
    await screen.findByRole('heading', { level: 1, name: '设置' });

    expect(container.querySelector('[data-df-state="hover"]')).not.toBeNull();
    expect(container.querySelector('[data-df-state="active"]')).not.toBeNull();
  });
});
