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
import { apiFailure, apiSuccess } from '@dforge/contracts';
import { createDocument, createPage, createRect } from '@dforge/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { resetCommandRegistry } from '@/features/editor-shell';
import { t } from '@/i18n';
import { createDocumentsClient, encodePageBody } from '../persistence/documents-client';
import { registerWorkspaceCommands } from '../register';
import { DocumentSaveControl } from './save-control';
import {
  createEditorWorkspace,
  EMPTY_PRESET,
  getWorkspace,
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

  describe('保存冲突（audit-d06 · D-05 · Q2=A：409 拒绝 + 手动刷新）', () => {
    /**
     * revision 感知桩：先以 revision=3 载入建立基线；首次保存（旧基线）回 409 冲突，
     * 「放行」翻开后保存成功——复现 J8 双窗口先后的应用层时序（载入→他人写→本窗保存）。
     */
    function mountConflictWorkspace(): { allowSaves: () => void } {
      const seeded = createDocument({
        id: 'doc-1',
        name: '冲突文档',
        pages: [
          createPage({
            id: 'page-1',
            name: '页面 1',
            nodes: { n_1: createRect({ id: 'n_1', x: 0, y: 0, width: 40, height: 30 }) },
            rootIds: ['n_1'],
          }),
        ],
      });
      const page = seeded.pages[0];
      if (page === undefined) throw new Error('夹具缺页');
      let revision = 3;
      let rejectSaves = true;
      const respond = (status: number, payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const path = String(input).replace(/^https?:\/\/[^/]+/, '');
        if (method === 'GET' && path === '/documents/doc-1') {
          return respond(
            200,
            apiSuccess({
              document: {
                id: 'doc-1',
                name: seeded.name,
                directory: '/data/doc-1.dfg',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
                pageCount: 1,
                sizeBytes: 0,
                revision,
                pages: [{ id: 'page-1', name: '页面 1', updatedAt: '2026-11-07T00:00:00.000Z' }],
              },
            }),
          );
        }
        if (method === 'GET' && path === '/documents/doc-1/pages/page-1') {
          return respond(200, apiSuccess({ body: encodePageBody(seeded, page), revision }));
        }
        if (method === 'PUT' && path === '/documents/doc-1/pages/page-1') {
          if (rejectSaves) {
            return respond(
              409,
              apiFailure('doc_revision_conflict', '文档已被另一窗口修改：保存基于旧版本，已拒绝', {
                currentRevision: revision,
              }),
            );
          }
          revision += 1;
          return respond(
            200,
            apiSuccess({ page: { id: 'page-1', name: '页面 1' }, revision }),
          );
        }
        return respond(404, apiFailure('not_found', '路由不存在'));
      }) as typeof fetch;

      setWorkspace(
        createEditorWorkspace(EMPTY_PRESET, {
          client: createDocumentsClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }),
        }),
      );
      registerWorkspaceCommands();
      render(<DocumentSaveControl />);
      return {
        allowSaves() {
          rejectSaves = false;
        },
      };
    }

    it('409 冲突 → 独立文案「文档已被另一窗口修改」+ 刷新按钮；不落网络族/通用失败形态', async () => {
      const user = userEvent.setup();
      mountConflictWorkspace();
      // 先载入建立保存基线（冲突语义只保护「载入过」的会话）
      await getWorkspace().documents.load('doc-1');

      await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
      const state = await waitForErrorState();
      // 独立冲突文案（不与网络族/通用失败混同）
      expect(state.textContent).toContain('文档已被另一窗口修改');
      expect(state.textContent).not.toContain('无法连接本地服务');
      expect(state.textContent).not.toContain('保存失败：');
      // 手动刷新路径：冲突态提供「刷新载入最新版本」入口
      expect(document.querySelector('[data-df-save-conflict-refresh]')).not.toBeNull();
      // 原文（daemon 信封的码与人话）沉进可折叠技术详情
      const details = document.querySelector<HTMLDetailsElement>('[data-df-technical-details]');
      expect(details).not.toBeNull();
      expect(details?.textContent).toContain('doc_revision_conflict');
    });

    it('恢复路径：点刷新 → 载入最新版本回「已保存」；再保存 → 成功', async () => {
      const user = userEvent.setup();
      const stub = mountConflictWorkspace();
      await getWorkspace().documents.load('doc-1');
      await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
      await waitForErrorState();

      // 手动刷新：重新载入 daemon 最新版本（放弃本窗口未保存修改——文案已言明）
      const refresh = document.querySelector<HTMLElement>('[data-df-save-conflict-refresh]');
      if (refresh === null) throw new Error('冲突态未提供刷新入口');
      await user.click(refresh);
      await waitFor(() => {
        expect(document.querySelector('[data-df-save-state="saved"]')).not.toBeNull();
      });

      // 刷新后基线已更新：再保存成功（恢复路径闭环）
      stub.allowSaves();
      await user.click(screen.getByRole('button', { name: t('editor.action.save') }));
      await waitFor(() => {
        expect(document.querySelector('[data-df-save-state="saved"]')).not.toBeNull();
      });
    });
  });
});
