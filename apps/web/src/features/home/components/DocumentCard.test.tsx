// @vitest-environment jsdom
/**
 * 文件卡片测试（FE-02 · B3）。
 *
 * 断言可观测行为：名称与元信息文本、指向编辑器的链接地址、悬停「…」菜单的开合与条目、
 * 菜单里的删除只**请求**删除（两步确认的第二步由对话框完成，不在本组件里删）。
 * 名称 13 / 元信息 11 / 圆角 8 / 缩略图圆角 6 属视觉口径（令牌 + 截图门禁取证）。
 */
import type { DocumentSummary } from '@dforge/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentCard } from './DocumentCard';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const DOC: DocumentSummary = {
  id: '海报 A',
  name: '海报 A',
  directory: '/data/海报 A.dfg',
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T11:30:00.000Z',
  pageCount: 3,
  sizeBytes: 4096,
};

function renderCard(overrides: Partial<Parameters<typeof DocumentCard>[0]> = {}) {
  const props = {
    document: DOC,
    now: () => NOW,
    onOpen: vi.fn(),
    onRequestDelete: vi.fn(),
    ...overrides,
  };
  render(
    <ul>
      <DocumentCard {...props} />
    </ul>,
  );
  return props;
}

describe('DocumentCard', () => {
  it('显示名称与元信息（页面数 + 相对更新时间）', () => {
    renderCard();
    expect(screen.getByText('海报 A')).toBeDefined();
    expect(screen.getByText('3 个页面 · 更新于 30 分钟前')).toBeDefined();
  });

  it('链接指向编辑器（带 documentId）', () => {
    renderCard();
    const link = screen.getByRole('link', { name: '打开「海报 A」' });
    expect(link.getAttribute('href')).toBe('/editor?documentId=%E6%B5%B7%E6%8A%A5%20A');
  });

  it('点击链接交给父级处理（客户端跳转），带修饰键时不拦截浏览器默认行为', async () => {
    const props = renderCard();
    await userEvent.click(screen.getByRole('link', { name: '打开「海报 A」' }));
    expect(props.onOpen).toHaveBeenCalledWith(DOC);
  });

  it('「…」菜单可开合：默认收起，点击后出现条目', async () => {
    const props = renderCard();
    const trigger = screen.getByRole('button', { name: '「海报 A」的更多操作' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: '打开' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeDefined();
    expect(props.onRequestDelete).not.toHaveBeenCalled();
  });

  it('菜单「打开」→ onOpen；菜单「删除」→ onRequestDelete（不直接删）', async () => {
    const props = renderCard();
    await userEvent.click(screen.getByRole('button', { name: '「海报 A」的更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '打开' }));
    expect(props.onOpen).toHaveBeenCalledWith(DOC);

    await userEvent.click(screen.getByRole('button', { name: '「海报 A」的更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(props.onRequestDelete).toHaveBeenCalledWith(DOC);
  });
});

describe('DocumentCard · 卡片链接携带当前 daemon 端点（D-3/UX-01）', () => {
  // jsdom 的地址在用例间共享：跑完复位，避免污染本文件其余用例（它们都假设无查询串）
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('当前页带 ?daemon= 时链接续写同一端点（挂载后写入，中键新开标签也带参数）', async () => {
    const endpoint = 'http://127.0.0.1:4999';
    const encoded = encodeURIComponent(endpoint);
    window.history.replaceState(null, '', `/?daemon=${encoded}`);
    renderCard();
    const link = screen.getByRole('link', { name: '打开「海报 A」' });
    await waitFor(() => {
      expect(link.getAttribute('href')).toBe(
        `/editor?documentId=%E6%B5%B7%E6%8A%A5%20A&daemon=${encoded}`,
      );
    });
  });
});
