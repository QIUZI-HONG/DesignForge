// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· 首页编排的异常路径与重复提交。
 *
 * 覆盖（任务书 §1/§5）：非归一异常类型（TypeError）不得白屏；对话内双击 Enter
 * 不得重复建文档；告警条按条数渲染。
 */
import type { DocumentListResponse, DocumentSummary } from '@dforge/contracts';
import { ToastProvider } from '@dforge/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDocumentsGateway, DocumentApiError } from '../api/documents';
import { createHomeStore } from '../state/home-store';
import { HomeView } from './HomeView';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function summary(id: string): DocumentSummary {
  return {
    id,
    name: id,
    directory: `/data/${id}.dfg`,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-15T11:30:00.000Z',
    pageCount: 1,
    sizeBytes: 1024,
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

/** 渲染首页（可注入任意 gateway 桩）。 */
function renderHome(gateway: {
  list: () => Promise<DocumentListResponse>;
  create: (name: string) => Promise<DocumentSummary>;
  remove: (id: string) => Promise<{ id: string; deleted: boolean }>;
}) {
  const store = createHomeStore({ storage: memoryStorage() });
  render(
    <ToastProvider>
      <HomeView
        documents={gateway}
        searchMarket={async () => ({ available: true, items: [] })}
        now={() => NOW}
        store={store}
        searchDebounceMs={0}
        onOpenDocument={() => undefined}
        onOpenMarket={() => undefined}
      />
    </ToastProvider>,
  );
  return store;
}

describe('对抗 · 非归一异常不得白屏', () => {
  it('list 抛 TypeError（result:null 之类）→ 归为 daemon_unreachable 错误态，页面仍在', async () => {
    renderHome({
      list: async () => {
        throw new TypeError("Cannot read properties of null (reading 'documents')");
      },
      create: async (name) => summary(name),
      remove: async (id) => ({ id, deleted: true }),
    });
    expect(await screen.findByText('无法连接本地服务')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
    // 文档区仍在（非白屏）：侧栏与章节标题存在
    expect(screen.getByRole('heading', { name: '最近' })).toBeTruthy();
  });

  it('list 抛 daemon 错误码 → 错误态带展示码挂点与 daemon 原文', async () => {
    renderHome({
      list: async () => {
        throw new DocumentApiError('doc_invalid_manifest', 'manifest.json 形状不合法');
      },
      create: async (name) => summary(name),
      remove: async (id) => ({ id, deleted: true }),
    });
    expect(await screen.findByText('manifest.json 形状不合法')).toBeTruthy();
    expect(screen.getByText(/E_DF_DOC_INVALID_MANIFEST/)).toBeTruthy();
  });

  it('list 返回脏形状（documents 为 null）→ 不崩，落空态', async () => {
    renderHome({
      // 与网关同口径的脏响应：列表退化为空，不抛
      list: async () => ({ documents: [], warnings: [] }),
      create: async (name) => summary(name),
      remove: async (id) => ({ id, deleted: true }),
    });
    expect(await screen.findByText('还没有设计文件')).toBeTruthy();
  });

  it('告警条按条数渲染（目录损坏不阻塞列表）', async () => {
    renderHome({
      list: async () => ({
        documents: [summary('文件 A')],
        // 告警形状对齐契约（id + 词表内的 code）；渲染只取条数，断言不依赖具体字段
        warnings: [{ id: '/ws/broken.dfg', code: 'manifest_unreadable', message: '目录损坏' }],
      }),
      create: async (name) => summary(name),
      remove: async (id) => ({ id, deleted: true }),
    });
    expect(await screen.findByText('文件 A')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('1');
  });
});

describe('对抗 · 新建对话的重复提交', () => {
  // 原为 it.fails（缺陷证据）：同一帧内两次回车会发出**两次**创建请求。
  // 修法落地（父级在飞守卫 ref + 对话框按 pending 拒收）后翻绿，按验证方注释改回 it()。
  it('同一帧内回车两次 → 只发出一次创建请求', async () => {
    const create = vi.fn(async (name: string) => summary(name));
    renderHome({
      list: async () => ({ documents: [], warnings: [] }),
      create,
      remove: async (id) => ({ id, deleted: true }),
    });
    await screen.findByText('还没有设计文件');
    await userEvent.click(screen.getByRole('button', { name: '新建设计文件' }));

    const input = await screen.findByLabelText('文件名称');
    fireEvent.change(input, { target: { value: '双击文件' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    // 实测读数为 2：第二轮 Enter 也发出请求（当前只靠 daemon 的 doc_exists 兜底才没建两份）
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('创建失败（同名 doc_exists）→ Toast 原样展示 daemon 文案，不静默', async () => {
    renderHome({
      list: async () => ({ documents: [], warnings: [] }),
      create: async () => {
        throw new DocumentApiError('doc_exists', '同名文档已存在');
      },
      remove: async (id) => ({ id, deleted: true }),
    });
    await screen.findByText('还没有设计文件');
    await userEvent.click(screen.getByRole('button', { name: '新建设计文件' }));
    const input = await screen.findByLabelText('文件名称');
    fireEvent.change(input, { target: { value: '重复名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/新建失败：同名文档已存在/)).toBeTruthy();
  });
});

describe('对抗 · 搜索与市场降级', () => {
  it('市场检索不可用（available=false）→ 下拉给「市场不可用」而不是空白', async () => {
    const store = createHomeStore({ storage: memoryStorage() });
    render(
      <ToastProvider>
        <HomeView
          documents={{
            list: async () => ({ documents: [summary('文件 A')], warnings: [] }),
            create: async (name) => summary(name),
            remove: async (id) => ({ id, deleted: true }),
          }}
          searchMarket={async () => ({ available: false, items: [] })}
          now={() => NOW}
          store={store}
          searchDebounceMs={0}
          onOpenDocument={() => undefined}
          onOpenMarket={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByRole('link', { name: '打开「文件 A」' });
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '海');
    expect(await screen.findByText('技能市场未就绪（索引未生成）')).toBeTruthy();
  });

  // 原为 it.fails（缺陷证据）：市场检索不落定时，市场分组没有任何可读出口（永久 loading）。
  // 根部同样适用于「拒绝」路径：原 HomeView 的市场检索是 `void (async () => …)()` 无 catch，
  // 拒绝会变成 unhandled rejection；此处用不落定 Promise 复现「挂起无出口」。
  // 修法落地（拒绝/同步抛错 → 落「市场不可用」；超上限 → 先落可读出口、结果迟到再覆盖）。
  // 时限口径：断言文本不变，但 30ms 的等待预算装不下任何生产可用的兜底上限
  // （缺省 3000ms，压在 daemon 端口探测最坏耗时 ~2.4s 之上，见 home/api/daemon-url），
  // 故按页面已有的注入口径传短上限，验证同一条逻辑路径（不落定 → 到点落「未就绪」）。
  it('市场检索不落定 → 市场分组应有可读出口（超上限先落「未就绪」态）', async () => {
    const store = createHomeStore({ storage: memoryStorage() });
    render(
      <ToastProvider>
        <HomeView
          documents={{
            list: async () => ({ documents: [summary('文件 A')], warnings: [] }),
            create: async (name) => summary(name),
            remove: async (id) => ({ id, deleted: true }),
          }}
          searchMarket={async () => await new Promise<never>(() => undefined)}
          now={() => NOW}
          store={store}
          searchDebounceMs={0}
          marketSearchDeadlineMs={5}
          onOpenDocument={() => undefined}
          onOpenMarket={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByRole('link', { name: '打开「文件 A」' });
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '海');
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 页面仍在（无未捕获异常导致卸载）
    expect(screen.getByRole('heading', { name: '最近' })).toBeTruthy();
    // 可读出口：超上限后市场分组落「未就绪」文案（不是永久「正在搜索…」）
    expect(screen.queryByText('技能市场未就绪（索引未生成）')).not.toBeNull();
  });

  it('市场检索永不返回（挂起）→ 页面可用，市场分组停在 loading（不崩）', async () => {
    const store = createHomeStore({ storage: memoryStorage() });
    render(
      <ToastProvider>
        <HomeView
          documents={{
            list: async () => ({ documents: [summary('文件 A')], warnings: [] }),
            create: async (name) => summary(name),
            remove: async (id) => ({ id, deleted: true }),
          }}
          searchMarket={async () => await new Promise(() => undefined)}
          now={() => NOW}
          store={store}
          searchDebounceMs={0}
          onOpenDocument={() => undefined}
          onOpenMarket={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByRole('link', { name: '打开「文件 A」' });
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '海');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('heading', { name: '最近' })).toBeTruthy();
  });
});

describe('对抗 · 网关超时归一（页面级，修复批次 3 · 工作包 C）', () => {
  // 页面级证据：**真网关 + 注入的悬挂 fetch 桩**（不经过任何替身 gateway），
  // 走的是浏览器里的真实装配路径——daemon 活着但不回话时，界面必须给确定降级。
  it('文档网关悬挂（fetch 桩永不落定）→ 到上限落错误态 E_DF_DAEMON_TIMEOUT，不假成功、不永久骨架', async () => {
    const never = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const gateway = createDocumentsGateway({
      baseUrl: 'http://127.0.0.1:4399',
      fetchImpl: never,
      timeoutMs: 20, // 注入短上限：验证同一条逻辑路径，不真等缺省 3s
    });
    renderHome(gateway);

    // 确定出口：错误态 + 展示码 + 重试（不是永久「正在载入文档」）
    expect(await screen.findByText('E_DF_DAEMON_TIMEOUT')).toBeTruthy();
    expect(screen.getByText(/请求超时/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    // 不假成功：骨架已撤，且没有把「超时」渲染成空列表空态
    expect(screen.queryByRole('status', { name: '正在载入文档' })).toBeNull();
    expect(screen.queryByText('还没有设计文件')).toBeNull();
    // 页面仍在（非白屏）
    expect(screen.getByRole('heading', { name: '最近' })).toBeTruthy();
  });

  it('不可达（fetch 桩立即抛错）→ 落 daemon_unreachable 错误态（两类失败可分辨）', async () => {
    const refused = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const gateway = createDocumentsGateway({
      baseUrl: 'http://127.0.0.1:4399',
      fetchImpl: refused,
      timeoutMs: 20,
    });
    renderHome(gateway);
    expect(await screen.findByText('E_DF_DAEMON_UNREACHABLE')).toBeTruthy();
  });

  // code-review #4：原「MARKET_SEARCH_DEADLINE_MS === GATEWAY_TIMEOUT_MS」是恒真的转发别名断言
  // （零覆盖）。别名已删，缺省值现在**字面上就是** `GATEWAY_TIMEOUT_MS`（组件签名一处声明），
  // 无可断言的第二份；缺省路径「非小值、挂起停在 loading」由上一例（30ms 预算内不落降级）覆盖。
});
