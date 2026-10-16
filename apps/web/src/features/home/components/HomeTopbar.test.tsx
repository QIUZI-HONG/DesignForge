// @vitest-environment jsdom
/**
 * 顶栏测试（FE-02 · B1 顶栏 56 / B5 新建菜单 / B9 全局搜索 / B10 设置入口）。
 *
 * 断言可观测行为：
 * - 新建菜单：展开后「设计文件」可选中（回调），「从模板新建」为禁用项（F15：留着理由）；
 * - 全局搜索：输入即出下拉、两条结果线分组（本地文档 / 技能市场）、点结果回调、
 *   Esc 关闭、清除按钮回调；
 * - 设置入口（D2）：下拉含「设置」「键盘快捷键」两条**可用链接**（href 续写当前 daemon
 *   端点参数，指到已交付的设置页 / 编辑器快捷键说明）。
 */
import type { DocumentSummary } from '@dforge/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HomeTopbar } from './HomeTopbar';

const DOC: DocumentSummary = {
  id: '海报 A',
  name: '海报 A',
  directory: '/data/海报 A.dfg',
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T11:30:00.000Z',
  pageCount: 1,
  sizeBytes: 1024,
};

function renderTopbar(overrides: Partial<Parameters<typeof HomeTopbar>[0]> = {}) {
  const props = {
    query: '',
    onQueryChange: vi.fn(),
    documentHits: [] as DocumentSummary[],
    onOpenDocument: vi.fn(),
    market: { loading: false, available: true, items: [] },
    onOpenMarket: vi.fn(),
    onCreateDesignFile: vi.fn(),
    ...overrides,
  };
  render(<HomeTopbar {...props} />);
  return props;
}

describe('HomeTopbar · 新建菜单（B5）', () => {
  it('展开「新建」→ 设界自有条目：设计文件（可选）+ 从模板新建（禁用，带理由）', async () => {
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByRole('menuitem', { name: /设计文件/ })).toBeDefined();
    const template = screen.getByRole('menuitem', { name: /从模板新建/ });
    expect(template.getAttribute('aria-disabled')).toBe('true');
  });

  it('选择「设计文件」→ onCreateDesignFile', async () => {
    const props = renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: '新建' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /设计文件/ }));
    expect(props.onCreateDesignFile).toHaveBeenCalledTimes(1);
  });
});

describe('HomeTopbar · 全局搜索（B9）', () => {
  it('无输入时不出下拉', () => {
    renderTopbar();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('输入后出下拉，并给出两条结果线（本地文档 / 技能市场）', async () => {
    renderTopbar({
      query: '海报',
      documentHits: [DOC],
      market: {
        loading: false,
        available: true,
        items: [{ id: 's/a', name: '海报技能', kind: 'skill' }],
      },
    });
    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    expect(screen.getByText('本地文档')).toBeDefined();
    expect(screen.getByText('技能市场')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '海报 A' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '海报技能' })).toBeDefined();
  });

  it('点本地命中 → onOpenDocument；点市场命中 → onOpenMarket', async () => {
    const props = renderTopbar({
      query: '海报',
      documentHits: [DOC],
      market: {
        loading: false,
        available: true,
        items: [{ id: 's/a', name: '海报技能', kind: 'skill' }],
      },
    });
    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '海报 A' }));
    expect(props.onOpenDocument).toHaveBeenCalledWith(DOC);

    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '海报技能' }));
    expect(props.onOpenMarket).toHaveBeenCalledWith('s/a');
  });

  it('两组都无命中 → 无结果空态 + 清除搜索', async () => {
    const props = renderTopbar({ query: '不存在' });
    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    expect(screen.getByText('没有找到相关结果')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(props.onQueryChange).toHaveBeenCalledWith('');
  });

  it('市场索引未就绪 → 该结果线显示降级说明（搜索整体不报错）', async () => {
    renderTopbar({ query: '海报', market: { loading: false, available: false, items: [] } });
    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    expect(screen.getByText('技能市场未就绪（索引未生成）')).toBeDefined();
  });

  it('市场检索中 → 该结果线显示载入中', async () => {
    renderTopbar({ query: '海报', market: { loading: true, available: true, items: [] } });
    await userEvent.click(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }));
    expect(screen.getByText('正在搜索…')).toBeDefined();
  });

  it('Esc 关闭下拉（焦点路径，不依赖鼠标移开）', async () => {
    renderTopbar({ query: '海报', documentHits: [DOC] });
    const input = screen.getByRole('searchbox', { name: '搜索文件与技能资产' });
    await userEvent.click(input);
    expect(screen.getByRole('menu')).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('输入触发 onQueryChange（受控组件）', async () => {
    const props = renderTopbar();
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索文件与技能资产' }), '海');
    expect(props.onQueryChange).toHaveBeenCalledWith('海');
  });
});

describe('HomeTopbar · 设置入口（B10 无账号简化版 / D2）', () => {
  it('展开设置下拉：两条入口都是可用链接（不再禁用），href 指向已交付目标页', async () => {
    // 当前页带端点参数（D-3 口径）：入口 href 必须续写它，否则跳转后整页断链
    const endpoint = 'http://127.0.0.1:4999';
    const encoded = encodeURIComponent(endpoint);
    window.history.replaceState(null, '', `/market?daemon=${encoded}`);
    renderTopbar();
    await userEvent.click(screen.getByRole('button', { name: '设置与帮助' }));
    expect(screen.getByText('本地优先 · 无需账号')).toBeDefined();

    const settings = screen.getByRole('menuitem', { name: '设置' });
    expect(settings.tagName).toBe('A');
    expect(settings.getAttribute('aria-disabled')).toBeNull();
    await waitFor(() => {
      expect(settings.getAttribute('href')).toBe(`/settings?daemon=${encoded}`);
    });

    const shortcuts = screen.getByRole('menuitem', { name: '键盘快捷键' });
    expect(shortcuts.tagName).toBe('A');
    expect(shortcuts.getAttribute('aria-disabled')).toBeNull();
    await waitFor(() => {
      expect(shortcuts.getAttribute('href')).toBe(`/editor?shortcuts=1&daemon=${encoded}`);
    });

    window.history.replaceState(null, '', '/');
  });
});
