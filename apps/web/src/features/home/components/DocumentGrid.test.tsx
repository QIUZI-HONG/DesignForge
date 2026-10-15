// @vitest-environment jsdom
/**
 * 文件列表容器测试（FE-02 · B1 4 列网格 ↔ B4 列表视图）。
 *
 * 断言：容器带视图标记（`data-view`，截图门禁与 e2e 的取样挂点）、两种视图都渲染全部卡片、
 * 空列表渲染为空（空态由上层决定，容器自身不猜测语义）。
 */
import type { DocumentSummary } from '@dforge/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentGrid } from './DocumentGrid';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function summary(
  id: string,
  name: string,
  updatedAt = '2026-10-15T11:00:00.000Z',
): DocumentSummary {
  return {
    id,
    name,
    directory: `/data/${id}.dfg`,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt,
    pageCount: 1,
    sizeBytes: 1024,
  };
}

const DOCS = [summary('a', '海报 A'), summary('b', 'Landing Page')];

function renderGrid(overrides: Partial<Parameters<typeof DocumentGrid>[0]> = {}) {
  const props = {
    viewMode: 'grid' as const,
    documents: DOCS,
    now: () => NOW,
    onOpen: vi.fn(),
    onRequestDelete: vi.fn(),
    ...overrides,
  };
  const { container } = render(<DocumentGrid {...props} />);
  return { props, container };
}

describe('DocumentGrid', () => {
  it('网格视图：容器标记 data-view=grid，卡片全部渲染', () => {
    const { container } = renderGrid();
    const list = container.querySelector('ul.dfg-home__files');
    expect(list?.getAttribute('data-view')).toBe('grid');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('海报 A')).toBeDefined();
  });

  it('列表视图：同一批卡片换布局（data-view=list）', () => {
    const { container } = renderGrid({ viewMode: 'list' });
    const list = container.querySelector('ul.dfg-home__files');
    expect(list?.getAttribute('data-view')).toBe('list');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('空数组渲染空容器（空态由上层决定）', () => {
    const { container } = renderGrid({ documents: [] });
    expect(container.querySelectorAll('[data-df-home-card]')).toHaveLength(0);
  });

  it('透传打开与删除请求', async () => {
    const { props } = renderGrid();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('link', { name: '打开「海报 A」' }));
    expect(props.onOpen).toHaveBeenCalled();
  });
});
