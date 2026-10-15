// @vitest-environment jsdom
/**
 * 回收站记录列表测试（FE-02 · B2 回收站分区的展开形态）。
 *
 * 口径（本票边界）：daemon 删除是物理删除，回收站只保留**删除记录**——
 * 列表只提供「彻底删除记录」（清本机记录），页面顶部要如实说明正文不可恢复。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TrashList } from './TrashList';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function renderList(overrides: Partial<Parameters<typeof TrashList>[0]> = {}) {
  const props = {
    records: [
      { id: '海报 A', name: '海报 A', deletedAt: '2026-10-15T11:30:00.000Z' },
      { id: '旧稿', name: '旧稿', deletedAt: '2026-10-13T09:00:00.000Z' },
    ],
    now: () => NOW,
    onPurge: vi.fn(),
    ...overrides,
  };
  render(<TrashList {...props} />);
  return props;
}

describe('TrashList', () => {
  it('如实说明：只记录、不可恢复', () => {
    renderList();
    expect(screen.getByText(/正文已被物理删除，无法从这里恢复/)).toBeDefined();
  });

  it('按记录渲染名称与删除时间（相对时间）', () => {
    renderList();
    expect(screen.getByText('海报 A')).toBeDefined();
    expect(screen.getByText('删除于 30 分钟前')).toBeDefined();
    expect(screen.getByText('删除于 2 天前')).toBeDefined();
  });

  it('「彻底删除记录」按记录回调（带记录 id）', async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole('button', { name: '彻底删除记录：旧稿' }));
    expect(props.onPurge).toHaveBeenCalledWith('旧稿');
  });

  it('空记录列表不渲染列表壳（空态由上层给）', () => {
    const { container } = render(<TrashList records={[]} now={() => NOW} onPurge={vi.fn()} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
