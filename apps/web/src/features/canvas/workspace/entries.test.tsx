// @vitest-environment jsdom
/**
 * 入口接线（修复批次 4 · 工作包 D1/D3）——命令层可观测行为回归。
 *
 * 缺陷现场：
 * - D-6 / UX-10：AI 抽屉受控开合无触发点（无按钮、命令面板搜「AI」无匹配）；
 *   出图/诊断面板零挂载；
 * - D-7：编辑器文件菜单 `file.new` / `file.export` 无注册者 → 永久禁用（死入口）。
 *
 * 本测试锁命令层契约（DOM 与真实浏览器路径由 `slots.test.tsx` 与
 * `verify-ai-two-state` / `verify-image-two-state` 的 UI 段承担）：
 * 1. `view.ai` 已注册且开合状态可被命令写（toggle + `pressed()` 跟随）；
 * 2. `file.export` 执行后右栏切到「导出」页签；
 * 3. `file.new` 落点为首页新建入口（`?create=1`），且经单点续写 daemon 端点参数。
 */
import { apiFailure, apiSuccess } from '@dforge/contracts';
import { createDocument, createPage } from '@dforge/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeCommand,
  getCommand,
  resetCommandRegistry,
  useEditorUi,
} from '@/features/editor-shell';

import { createDocumentsClient, encodePageBody } from '../persistence/documents-client';
import {
  connectDocumentBridge,
  connectQueryEntryPoints,
  newFileEntryHref,
  registerWorkspaceCommands,
} from '../register';
import { useWorkspaceUi } from './ui-state';
import {
  createEditorWorkspace,
  EMPTY_PRESET,
  resetWorkspace,
  setWorkspace,
} from './workspace-session';

afterEach(() => {
  resetCommandRegistry();
  resetWorkspace();
  useWorkspaceUi.setState({ rightPanelTab: 'inspect', aiDrawerOpen: false });
  useEditorUi.setState({ commandPaletteOpen: false, shortcutsOpen: false });
  window.history.replaceState(null, '', '/editor');
});

describe('view.ai · AI 抽屉入口（D-6 / UX-10）', () => {
  it('命令已注册；执行一次打开、再执行一次关闭（开合状态可被命令写）', async () => {
    registerWorkspaceCommands();
    expect(getCommand('view.ai')).toBeDefined();
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(false);
    await executeCommand('view.ai');
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(true);
    await executeCommand('view.ai');
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(false);
  });

  it('pressed() 跟随开合状态（入口 aria-pressed 的依据）', async () => {
    registerWorkspaceCommands();
    expect(getCommand('view.ai')?.pressed?.()).toBe(false);
    await executeCommand('view.ai');
    expect(getCommand('view.ai')?.pressed?.()).toBe(true);
  });
});

describe('file.export · 导出入口（D-7）', () => {
  it('命令已注册（AppMenu 条目据此点亮），执行后右栏切到「导出」页签', async () => {
    registerWorkspaceCommands();
    expect(getCommand('file.export')).toBeDefined();
    await executeCommand('file.export');
    expect(useWorkspaceUi.getState().rightPanelTab).toBe('export');
  });
});

describe('file.new · 新建入口（D-7）', () => {
  it('命令已注册且可用；落点为首页新建入口（?create=1 自动打开新建对话框）', () => {
    registerWorkspaceCommands();
    expect(getCommand('file.new')).toBeDefined();
    expect(getCommand('file.new')?.enabled?.() ?? true).toBe(true);
    expect(newFileEntryHref()).toBe('/?create=1');
  });

  it('当前页带 ?daemon= 时落点续写端点参数（与 B 包同一保参口径）', () => {
    const endpoint = 'http://127.0.0.1:4999';
    window.history.replaceState(null, '', `/editor?daemon=${encodeURIComponent(endpoint)}`);
    expect(newFileEntryHref()).toBe(`/?create=1&daemon=${encodeURIComponent(endpoint)}`);
  });
});

describe('查询串入口（D2/D3：站内跳转落地即达）', () => {
  it('?shortcuts=1 打开快捷键说明、?ai=1 打开 AI 抽屉', () => {
    window.history.replaceState(null, '', '/editor?shortcuts=1&ai=1');
    connectQueryEntryPoints();
    expect(useEditorUi.getState().shortcutsOpen).toBe(true);
    expect(useWorkspaceUi.getState().aiDrawerOpen).toBe(true);
  });
});

describe('文档载入锁（复核 J1：随工作区生命周期复位，SPA 导航换文档必须重新载入）', () => {
  /** 极简假 daemon：每个文档一页（`page-1`），文档名 = 文档 id；顺带计数请求。 */
  function fakeDaemon() {
    const requests: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      const respond = (status: number, payload: unknown): Response =>
        ({
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(payload),
        }) as unknown as Response;
      const summary = /^\/documents\/([^/]+)$/.exec(path);
      if (summary !== null) {
        const id = decodeURIComponent(summary[1] as string);
        return respond(200, apiSuccess({ document: { id, name: id, pageCount: 1 } }));
      }
      const page = /^\/documents\/([^/]+)\/pages\/([^/]+)$/.exec(path);
      if (page !== null) {
        const id = decodeURIComponent(page[1] as string);
        const pageId = decodeURIComponent(page[2] as string);
        if (pageId !== 'page-1') return respond(404, apiFailure('not_found', '页面不存在'));
        const scene = createPage({ id: 'page-1' });
        const document_ = createDocument({ id, name: id, pages: [scene] });
        return respond(
          200,
          apiSuccess({ page: { id: pageId }, body: encodePageBody(document_, scene) }),
        );
      }
      return respond(404, apiFailure('not_found', `未实现：${path}`));
    };
    return {
      requests,
      client: createDocumentsClient({ baseUrl: 'http://daemon.test', fetchImpl }),
    };
  }

  /** 装一个注入了夹具 daemon 的工作区单体（拿到 custom client）。 */
  function installWorkspace(client: ReturnType<typeof fakeDaemon>['client']) {
    const workspace = createEditorWorkspace(EMPTY_PRESET, { client });
    setWorkspace(workspace);
    return workspace;
  }

  const atEditor = (documentId: string): void => {
    window.history.replaceState(null, '', `/editor?documentId=${encodeURIComponent(documentId)}`);
  };

  it('SPA 导航「文档 A → 文档 B」：同 id 重复调用不重复载入，换 id 必须重新载入（缺陷现场：B 不载入）', async () => {
    atEditor('文档 A');
    const daemon = fakeDaemon();
    const workspace = installWorkspace(daemon.client);

    connectDocumentBridge();
    await vi.waitFor(() => {
      expect(workspace.canvas.document().name).toBe('文档 A');
    });

    // 同一挂载里重复调用（bootstrap effect + 槽触发的引导）：同 id 去重，不重复拉取
    const requestsBefore = daemon.requests.length;
    connectDocumentBridge();
    await Promise.resolve();
    expect(daemon.requests.length).toBe(requestsBefore);

    // 首页 → 文档 B（客户端导航：地址变化、工作区单体仍在）
    atEditor('文档 B');
    connectDocumentBridge();
    await vi.waitFor(() => {
      expect(workspace.canvas.document().name).toBe('文档 B');
    });
  });

  it('resetWorkspace() 后：同一文档可再次载入（锁随生命周期复位，不残留）', async () => {
    atEditor('文档 A');
    const first = installWorkspace(fakeDaemon().client);
    connectDocumentBridge();
    await vi.waitFor(() => {
      expect(first.canvas.document().name).toBe('文档 A');
    });

    // 复位（测试与热重载口径）：新单体 = 新锁——同一地址必须能再次载入
    resetWorkspace();
    const second = installWorkspace(fakeDaemon().client);
    connectDocumentBridge();
    await vi.waitFor(() => {
      expect(second.canvas.document().name).toBe('文档 A');
    });
  });
});
