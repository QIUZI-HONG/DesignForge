// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· 密钥纪律。
 *
 * 风险点（任务书 §2）：保存/回显/错误提示/日志/DOM/localStorage/网络请求体里
 * 是否出现明文 key；掩码可否被绕过。
 * 口径：明文只允许出现在**用户正在输入的那次请求体**里；一经落库即清空，
 * 且不得进入 localStorage/sessionStorage/错误文案。
 */
import { isPlausibleApiKey, maskSecret } from '@dforge/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DaemonClientError } from '../api/daemon-client';

import { makeApi, renderWithToast } from './settings-fixtures';
import { SettingsPage } from './settings-page';

const TYPED_KEY = 'sk-adversarial-INPUT-9876543210';

/** 打开 AI 分区（设置页默认落在工作目录分区）。 */
async function openAiSection(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: '设置' });
  await user.click(screen.getByRole('button', { name: 'DeepSeek' }));
}

describe('对抗 · 明文 key 的可见面', () => {
  it('保存成功后：输入框清空、DOM/localStorage/sessionStorage 全无明文、掩码来自 daemon 摘要', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const storageSpy = vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem');
    renderWithToast(<SettingsPage api={api} />);
    await openAiSection(user);

    const input = screen.getByLabelText('API 密钥') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');

    await user.type(input, TYPED_KEY);
    await user.click(screen.getByRole('button', { name: '保存密钥' }));

    await waitFor(() => {
      expect(api.setApiKey).toHaveBeenCalledWith(TYPED_KEY);
    });
    // 落库后草稿清空
    await waitFor(() => {
      expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe('');
    });
    // DOM 任何角落不再有明文
    expect(document.body.innerHTML).not.toContain(TYPED_KEY);
    // 掩码是 daemon 摘要（sk-…wxyz），不是从输入截出来的
    expect(document.body.textContent).toContain('sk-…wxyz');
    expect(document.body.textContent).not.toContain('3210');
    // 浏览器存储面零写入
    expect(JSON.stringify(window.localStorage)).not.toContain(TYPED_KEY);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TYPED_KEY);
    expect(storageSpy).not.toHaveBeenCalled();
    storageSpy.mockRestore();
  });

  it('保存失败（daemon 不可达）：错误文案不含明文；明文只留在输入框（未落库）', async () => {
    const user = userEvent.setup();
    const api = makeApi({
      setApiKey: vi.fn(async () => {
        throw new DaemonClientError({
          kind: 'network',
          message: '无法连接本地服务（http://127.0.0.1:4399）——请确认 daemon 已启动后重试。',
        });
      }),
    });
    renderWithToast(<SettingsPage api={api} />);
    await openAiSection(user);

    await user.type(screen.getByLabelText('API 密钥'), TYPED_KEY);
    await user.click(screen.getByRole('button', { name: '保存密钥' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('无法连接本地服务');
    expect(alert.textContent).not.toContain(TYPED_KEY);
    expect(JSON.stringify(window.localStorage)).not.toContain(TYPED_KEY);
  });

  it('daemon 拒绝（形态非法）时错误来自服务端原文，不回声输入值', async () => {
    const user = userEvent.setup();
    const api = makeApi({
      setApiKey: vi.fn(async () => {
        throw new DaemonClientError({
          kind: 'api',
          message: 'API key 形态不合法（期望 sk- 前缀 + 长串）',
          code: 'credential_invalid',
        });
      }),
    });
    renderWithToast(<SettingsPage api={api} />);
    await openAiSection(user);

    await user.type(screen.getByLabelText('API 密钥'), 'sk-abcdefghij');
    await user.click(screen.getByRole('button', { name: '保存密钥' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('sk-abcdefghij');
  });

  it('掩码摘要只在「已配置」说明里出现一次通路：切到其他分区后 DOM 仍不含明文', async () => {
    const user = userEvent.setup();
    renderWithToast(<SettingsPage api={makeApi()} />);
    await openAiSection(user);
    await user.type(screen.getByLabelText('API 密钥'), TYPED_KEY);
    await user.click(screen.getByRole('button', { name: 'ComfyUI' }));
    expect(document.body.innerHTML).not.toContain(TYPED_KEY);
  });
});

describe('对抗 · 掩码与形态校验实现', () => {
  it('掩码永不回吐中段：≤8 位全遮；sk- 前缀保留 + 末 4 位', () => {
    expect(maskSecret('abcdefgh')).toBe('****');
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-…mnop');
    expect(maskSecret('abcdefghijkl')).toBe('ab…ijkl');
    // 中段字符绝不出现在掩码里
    expect(maskSecret('sk-SECRETMIDDLE-1234')).not.toContain('SECRETMIDDLE');
  });

  it('形态校验拦得住绕过尝试：空格/换行/无前缀/过短/超长前缀变体', () => {
    expect(isPlausibleApiKey('sk-12345678')).toBe(true);
    expect(isPlausibleApiKey('sk-1234567')).toBe(false); // 过短
    expect(isPlausibleApiKey('12345678901234')).toBe(false); // 无前缀
    expect(isPlausibleApiKey('sk-12345678 ')).toBe(false); // 尾随空格
    expect(isPlausibleApiKey(' sk-12345678')).toBe(false); // 前导空格
    expect(isPlausibleApiKey('sk-1234 5678')).toBe(false); // 中段空格
    expect(isPlausibleApiKey('sk-1234\n5678')).toBe(false); // 换行
    expect(isPlausibleApiKey('')).toBe(false);
    expect(isPlausibleApiKey(null)).toBe(false);
    expect(isPlausibleApiKey({ toString: () => 'sk-123456789' })).toBe(false);
  });
});
