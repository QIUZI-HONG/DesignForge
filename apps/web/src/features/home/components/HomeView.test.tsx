// @vitest-environment jsdom
/**
 * 首页编排集成测试（FE-02）。
 *
 * 这层测的是**页面级行为**：数据加载三态、搜索与筛选的联动、两步删除的先后、
 * 新建后回到列表、回收站记录、AI 提示区的桩动作。
 * 依赖注入：文档接口/市场检索/时钟/store 全部由外部给（缺省实现只跑在浏览器里）。
 */
import type { DocumentListResponse, DocumentSummary } from '@dforge/contracts';
import { ToastProvider } from '@dforge/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DocumentApiError } from '../api/documents';
import { createHomeStore } from '../state/home-store';
import { HomeView } from './HomeView';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function summary(id: string, updatedAt = '2026-10-15T11:30:00.000Z'): DocumentSummary {
  return {
    id,
    name: id,
    directory: `/data/${id}.dfg`,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt,
    pageCount: 2,
    sizeBytes: 2048,
  };
}

/** 内存版存储替身（删除记录用）。 */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

/** 假文档接口：内存列表 + 调用记录。 */
function fakeGateway(initial: DocumentSummary[]) {
  let docs = [...initial];
  const list = vi.fn(
    async (): Promise<DocumentListResponse> => ({ documents: [...docs], warnings: [] }),
  );
  const create = vi.fn(async (name: string) => {
    const created = summary(name);
    docs = [created, ...docs];
    return created;
  });
  const remove = vi.fn(async (id: string) => {
    docs = docs.filter((document) => document.id !== id);
    return { id, deleted: true };
  });
  return { gateway: { list, create, remove }, list, create, remove };
}

function renderHome(
  options: {
    docs?: DocumentSummary[];
    gateway?: ReturnType<typeof fakeGateway>;
    searchMarket?: Parameters<typeof HomeView>[0]['searchMarket'];
    onOpenDocument?: Parameters<typeof HomeView>[0]['onOpenDocument'];
    onOpenMarket?: Parameters<typeof HomeView>[0]['onOpenMarket'];
    onOpenAi?: Parameters<typeof HomeView>[0]['onOpenAi'];
    autoOpenCreate?: boolean;
  } = {},
) {
  const fake = options.gateway ?? fakeGateway(options.docs ?? []);
  const store = createHomeStore({ storage: memoryStorage() });
  render(
    <ToastProvider>
      <HomeView
        documents={fake.gateway}
        searchMarket={options.searchMarket ?? (async () => ({ available: true, items: [] }))}
        now={() => NOW}
        store={store}
        searchDebounceMs={0}
        onOpenDocument={options.onOpenDocument ?? (() => {})}
        onOpenMarket={options.onOpenMarket ?? (() => {})}
        onOpenAi={options.onOpenAi ?? (() => {})}
        autoOpenCreate={options.autoOpenCreate ?? false}
      />
    </ToastProvider>,
  );
  return { fake, store };
}

describe('HomeView · 加载与三态', () => {
  it('先出骨架，载入完成后出卡片', async () => {
    renderHome({ docs: [summary('海报 A')] });
    expect(screen.getByRole('status', { name: '正在载入文档' })).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: '正在载入文档' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });

  it('空目录 → 「还没有设计文件」空态，主按钮打开新建对话框', async () => {
    renderHome({ docs: [] });
    await screen.findByText('还没有设计文件');
    await userEvent.click(screen.getByRole('button', { name: '新建设计文件' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('textbox', { name: '文件名称' })).toBeDefined();
  });

  it('接口失败 → 错误态（带错误码），重试后恢复', async () => {
    const fake = fakeGateway([]);
    fake.list.mockRejectedValueOnce(new DocumentApiError('daemon_unreachable', '本地服务不可达。'));
    renderHome({ gateway: fake });

    await screen.findByText('无法连接本地服务');
    // 错误码沉到「诊断信息」折叠（G6/UX-16）：人话在主位，默认收起
    const code = screen.getByText('E_DF_DAEMON_UNREACHABLE');
    const diagnostics = code.closest('details');
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.open).toBe(false);
    expect(screen.getByText('诊断信息')).toBeDefined();
    // 计数不可得时说「—」，不谎报「0 个文档」（UX-19）
    expect(screen.queryByText('0 个文档')).toBeNull();
    expect(screen.getByText('—')).toBeDefined();

    fake.list.mockResolvedValueOnce({ documents: [summary('海报 A')], warnings: [] });
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: '打开「海报 A」' })).toBeDefined();
    expect(screen.getByText('1 个文档')).toBeDefined();
  });

  it('列表告警（目录损坏）显示为提示条，不阻塞列表', async () => {
    const fake = fakeGateway([summary('海报 A')]);
    fake.list.mockResolvedValueOnce({
      documents: [summary('海报 A')],
      warnings: [{ id: '坏目录', code: 'manifest_invalid', message: 'manifest 非法' }],
    });
    renderHome({ gateway: fake });
    expect(await screen.findByText('1 个目录未能读取')).toBeDefined();
    expect(screen.getByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });
});

describe('HomeView · 新建与打开', () => {
  it('新建：对话框提交 → 调 daemon → Toast + 新卡片出现', async () => {
    const { fake } = renderHome({ docs: [] });
    await screen.findByText('还没有设计文件');

    await userEvent.click(screen.getByRole('button', { name: '新建设计文件' }));
    const input = screen.getByRole('textbox', { name: '文件名称' });
    await userEvent.clear(input);
    await userEvent.type(input, '海报 B');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(fake.create).toHaveBeenCalledWith('海报 B');
    });
    expect(await screen.findByText('已新建「海报 B」')).toBeDefined();
    expect(await screen.findByRole('link', { name: '打开「海报 B」' })).toBeDefined();
  });

  it('点卡片 → onOpenDocument（缺省跳编辑器，测试注入替身）', async () => {
    const onOpenDocument = vi.fn();
    renderHome({ docs: [summary('海报 A')], onOpenDocument });
    await userEvent.click(await screen.findByRole('link', { name: '打开「海报 A」' }));
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: '海报 A' }));
  });
});

describe('HomeView · 两步删除（B12）', () => {
  it('第一步只弹确认，不调删除接口；确认后才删', async () => {
    const { fake } = renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });

    await userEvent.click(screen.getByRole('button', { name: '「海报 A」的更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));

    // 第一步：只出对话框
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('删除「海报 A」？')).toBeDefined();
    expect(fake.remove).not.toHaveBeenCalled();

    // 第二步：确认
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(fake.remove).toHaveBeenCalledWith('海报 A');
    });
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '打开「海报 A」' })).toBeNull();
    });
    expect(await screen.findByText('已删除「海报 A」')).toBeDefined();
  });

  it('确认对话框取消 → 不删、卡片仍在', async () => {
    const { fake } = renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });
    await userEvent.click(screen.getByRole('button', { name: '「海报 A」的更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(fake.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });

  it('删除后回收站分区出现该记录（可彻底删除记录）', async () => {
    const { fake } = renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });
    await userEvent.click(screen.getByRole('button', { name: '「海报 A」的更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(fake.remove).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByRole('button', { name: /^回收站/ }));
    expect(await screen.findByText(/正文已被物理删除/)).toBeDefined();
    expect(screen.getByText('海报 A')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '彻底删除记录：海报 A' }));
    await waitFor(() => {
      expect(screen.queryByText('海报 A')).toBeNull();
    });
  });
});

describe('HomeView · 搜索与筛选', () => {
  it('搜索词过滤卡片（本地文档），清空后恢复', async () => {
    renderHome({ docs: [summary('海报 A'), summary('Landing Page')] });
    expect(await screen.findByRole('link', { name: '打开「Landing Page」' })).toBeDefined();

    const search = screen.getByRole('searchbox', { name: '搜索文件与技能资产' });
    await userEvent.type(search, '海报');
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '打开「Landing Page」' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });

  it('搜索无果 → 「没有找到相关文件」空态，清除筛选后恢复', async () => {
    renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '不存在');

    await screen.findByText('没有找到相关文件');
    await userEvent.click(screen.getByRole('button', { name: '清除筛选条件' }));
    expect(await screen.findByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });

  it('视图切换：网格 ↔ 列表（容器 data-view）', async () => {
    renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });
    const files = document.querySelector('ul.dfg-home__files');
    expect(files?.getAttribute('data-view')).toBe('grid');
    await userEvent.click(screen.getByRole('radio', { name: '列表' }));
    expect(document.querySelector('ul.dfg-home__files')?.getAttribute('data-view')).toBe('list');
  });

  it('时间范围筛选到「今天」时，早于窗口的文档被挡掉', async () => {
    renderHome({ docs: [summary('今天改的'), summary('很久以前', '2026-08-01T10:00:00.000Z')] });
    expect(await screen.findByRole('link', { name: '打开「很久以前」' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '时间范围：全部' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '今天' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '打开「很久以前」' })).toBeNull();
    });
  });
});

describe('HomeView · 侧栏与回收站空态', () => {
  it('切到回收站且无记录 → 「回收站为空」，返回本地文档后恢复列表', async () => {
    renderHome({ docs: [summary('海报 A')] });
    await screen.findByRole('link', { name: '打开「海报 A」' });
    await userEvent.click(screen.getByRole('button', { name: /^回收站/ }));
    await screen.findByText('回收站为空');
    await userEvent.click(screen.getByRole('button', { name: '返回本地文档' }));
    expect(await screen.findByRole('link', { name: '打开「海报 A」' })).toBeDefined();
  });

  it('侧栏折叠按钮可开合（图标模式）', async () => {
    renderHome({ docs: [] });
    await screen.findByText('还没有设计文件');
    await userEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeDefined();
  });
});

describe('HomeView · AI 提示区（D3：与编辑器实态同步）', () => {
  it('点「打开 AI 助手」→ 交回 onOpenAi 导航回调（不再给「暂未接入」Toast）', async () => {
    const onOpenAi = vi.fn();
    renderHome({ docs: [], onOpenAi });
    await screen.findByText('还没有设计文件');
    await userEvent.click(screen.getByRole('button', { name: '打开 AI 助手' }));
    expect(onOpenAi).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/暂未接入/)).toBeNull();
  });

  it('autoOpenCreate（/?create=1 落点）→ 挂载即打开新建对话框', async () => {
    renderHome({ docs: [], autoOpenCreate: true });
    expect(await screen.findByRole('dialog', { name: '新建设计文件' })).toBeDefined();
  });
});

describe('HomeView · 市场结果线', () => {
  it('输入搜索词即查市场，命中回传给顶栏下拉', async () => {
    const searchMarket = vi.fn(async () => ({
      available: true,
      items: [{ id: 'skill/a', name: '图标技能', kind: 'skill' as const }],
    }));
    renderHome({ docs: [], searchMarket });
    await screen.findByText('还没有设计文件');
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '图标');

    await waitFor(() => {
      expect(searchMarket).toHaveBeenCalledWith('图标');
    });
    expect(await screen.findByRole('menuitem', { name: '图标技能' })).toBeDefined();
  });

  it('市场检索被拒 → 落「市场未就绪」降级（不留 unhandled rejection、不停在加载）', async () => {
    const searchMarket = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    renderHome({ docs: [], searchMarket });
    await screen.findByText('还没有设计文件');
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '图标');

    expect(await screen.findByText('技能市场未就绪（索引未生成）')).toBeDefined();
  });
});
