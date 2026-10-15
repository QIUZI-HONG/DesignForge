// @vitest-environment jsdom
/**
 * 侧栏分区测试（FE-02 · B2）。
 *
 * 断言可观测行为：三个分区条目存在且可选中（aria-current 表选中）、点击回调、
 * 回收站条目带删除记录计数、折叠开合与无障碍名切换。
 * 条目高度（32）与悬停底色属视觉口径，由 CSS 令牌保证、由截图门禁取证——不在单测里断言像素。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HomeSidebar } from './HomeSidebar';

function renderSidebar(overrides: Partial<Parameters<typeof HomeSidebar>[0]> = {}) {
  const props = {
    section: 'recent' as const,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    trashCount: 0,
    ...overrides,
  };
  render(<HomeSidebar {...props} />);
  return props;
}

describe('HomeSidebar', () => {
  it('渲染三个分区条目（最近 / 本地文档 / 回收站）', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: '最近' })).toBeDefined();
    expect(screen.getByRole('button', { name: '本地文档' })).toBeDefined();
    expect(screen.getByRole('button', { name: '回收站' })).toBeDefined();
  });

  it('当前分区带 aria-current（选中态语义）', () => {
    renderSidebar({ section: 'local' });
    expect(screen.getByRole('button', { name: '本地文档' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: '最近' }).getAttribute('aria-current')).toBeNull();
  });

  it('点击分区回调目标分区（不自己改状态）', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: '回收站' }));
    expect(props.onSelect).toHaveBeenCalledWith('trash');
  });

  it('回收站条目显示删除记录条数（>0 时）', () => {
    renderSidebar({ trashCount: 3 });
    expect(screen.getByRole('button', { name: /回收站/ }).textContent).toContain('3');
  });

  it('折叠开关：aria-expanded 反映状态，点击回调', async () => {
    const props = renderSidebar({ collapsed: false });
    const toggle = screen.getByRole('button', { name: '折叠侧栏' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(toggle);
    expect(props.onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('折叠态下条目仍有无障碍名（图标模式不丢语义）', () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole('button', { name: '最近' })).toBeDefined();
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeDefined();
  });
});
