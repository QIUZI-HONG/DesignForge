// @vitest-environment jsdom
/**
 * 顶栏保存控件测试（票 06 / spec P1-2：保存失败态的人话化）。
 *
 * 接缝：`DocumentSaveControl` × 文档桥 × 注入的 documents-client（fetch 桩）——
 * 与「杀 daemon 实测」同构：fetch 层直接抛 `TypeError: Failed to fetch`，
 * 断言 `[data-df-save-state]` 上出现中文人话 + 可执行的下一步（重按保存），
 * 原始技术串沉进可折叠技术详情（不再渲染「保存失败：Failed to fetch」）。
 * 命令接线（按钮 ↔ `file.save`）由 slots.test 覆盖，这里按同一装配登记命令。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetCommandRegistry } from '@/features/editor-shell';
import { t } from '@/i18n';
import { createDocumentsClient } from '../persistence/documents-client';
import { registerWorkspaceCommands } from '../register';
import { DocumentSaveControl } from './save-control';
import {
  createEditorWorkspace,
  EMPTY_PRESET,
  resetWorkspace,
  setWorkspace,
} from './workspace-session';

afterEach(() => {
  resetWorkspace();
  resetCommandRegistry();
});

/** 装配一个用注入客户端（fetch 桩）的工作区，登记保存命令并渲染顶栏保存控件。 */
function mountWithFetch(fetchImpl: typeof fetch, options?: { timeoutMs?: number }): void {
  setWorkspace(
    createEditorWorkspace(EMPTY_PRESET, {
      client: createDocumentsClient({
        baseUrl: 'http://127.0.0.1:9',
        fetchImpl,
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
    }),
  );
  registerWorkspaceCommands();
  render(<DocumentSaveControl />);
}

/** 等到保存态落到 error（门禁与测试共用的读点：data-df-save-state）。 */
async function waitForErrorState(): Promise<HTMLElement> {
  return await waitFor(() => {
    const element = document.querySelector<HTMLElement>('[data-df-save-state="error"]');
    if (element === null) throw new Error('保存态尚未落到 error');
    return element;
  });
}

describe('顶栏保存态中文化（票 06 / spec P1-2）', () => {
  it('保存失败（daemon 不可达）→ 人话主句含「请确认 daemon 已启动」，重按保存仍可用', async () => {
    const user = userEvent.setup();
    mountWithFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
    const state = await waitForErrorState();
    expect(state.textContent).toContain('无法连接本地服务');
    expect(state.textContent).toContain('请确认 daemon 已启动');
    expect(state.textContent).toContain('重新保存');
    // 下一步动作与场景匹配：保存按钮就在旁边，失败后仍可重按（既有能力不回退）
    const saveButton = screen.getByRole('button', {
      name: t('editor.action.save'),
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('原始技术串沉进可折叠技术详情（默认收起，带归一错误码），不再直接铺裸英文', async () => {
    const user = userEvent.setup();
    mountWithFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
    await waitForErrorState();
    const details = document.querySelector<HTMLDetailsElement>('[data-df-technical-details]');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('Failed to fetch');
    expect(details?.textContent).toContain('DAEMON_UNREACHABLE');
  });

  it('非网络失败（daemon 明确拒绝）维持既有「保存失败：{原因}」渲染，不出技术详情', async () => {
    const user = userEvent.setup();
    const respondFailure: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: { code: 'doc_exists', message: '同名文档已存在' } }),
          {
            status: 409,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    mountWithFetch(respondFailure);

    await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
    const state = await waitForErrorState();
    expect(state.textContent).toContain('保存失败');
    expect(state.textContent).toContain('doc_exists');
    expect(document.querySelector('[data-df-technical-details]')).toBeNull();
  });

  it('J7 · 传输失败的两种形态收敛为同一文案：网关 502（非 JSON）也渲染统一人话（audit-d04 · D-10 单形态）', async () => {
    const user = userEvent.setup();
    // 同源网关在 daemon 失联时的形态：502 + 非 JSON 正文（修复前这里直出
    // 「保存失败：响应不是合法 JSON（HTTP 502）」技术串，与 abort 的人话双形态并存）
    const respondGateway502: typeof fetch = () =>
      Promise.resolve(new Response('gateway: fetch failed', { status: 502 }));
    mountWithFetch(respondGateway502);

    await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
    const state = await waitForErrorState();
    // 单形态断言：与 fetch abort 同一句人话（J7 旅程的文案步骤同款判据）
    expect(state.textContent).toContain('无法连接本地服务');
    expect(state.textContent).toContain('请确认 daemon 已启动');
    expect(state.textContent).toContain('重新保存');
    // 原文沉进技术详情（报障可引用），不再直出主文案
    const details = document.querySelector<HTMLDetailsElement>('[data-df-technical-details]');
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('HTTP 502');
    // 可重试：保存按钮仍在且未禁用
    const saveButton = screen.getByRole('button', {
      name: t('editor.action.save'),
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('J9 · 保存请求挂死：到注入上限落为失败态（统一人话 + 可重试），不再永久「保存中…」（audit-d04 · D-04）', async () => {
    const user = userEvent.setup();
    // 替身永不落定（daemon 活着但不响应 / 网线被拔）——只能靠超时上限脱身
    const hanging: typeof fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    mountWithFetch(hanging, { timeoutMs: 150 });

    await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
    const state = await waitForErrorState();
    // 统一失败文案（超时归网络族）+ 可执行的下一步
    expect(state.textContent).toContain('无法连接本地服务');
    expect(state.textContent).toContain('重新保存');
    // 原文（超时人话）沉进技术详情
    const details = document.querySelector<HTMLDetailsElement>('[data-df-technical-details]');
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('请求超时');
    // 可重试：重按保存仍可用
    const saveButton = screen.getByRole('button', {
      name: t('editor.action.save'),
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });
});
