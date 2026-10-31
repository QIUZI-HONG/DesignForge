/**
 * TechnicalDetails（可折叠技术详情）行为测试（票 06 / spec P1-2）。
 *
 * 断言角度：默认收起（报障时才展开）、错误码与原始技术信息都在折叠区内、
 * 调用方给的标签是唯一文案（组件不内置任何语言）、无内容时不渲染空折叠件。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TechnicalDetails } from './TechnicalDetails';

describe('TechnicalDetails（可折叠技术详情）', () => {
  it('默认收起：码与原始信息在折叠区内，点击标签展开后可见（报障可引用）', async () => {
    const user = userEvent.setup();
    render(<TechnicalDetails label="技术详情" code="DAEMON_UNREACHABLE" raw="Failed to fetch" />);

    const toggle = screen.getByText('技术详情');
    const details = toggle.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false); // 默认收起：原始技术串不直接铺开
    expect(details?.contains(screen.getByText('DAEMON_UNREACHABLE'))).toBe(true);
    expect(details?.contains(screen.getByText('Failed to fetch'))).toBe(true);

    await user.click(toggle);
    expect(details?.open).toBe(true); // 展开后可见
  });

  it('码挂 data-df-error-code、原文挂 data-df-error-raw（门禁取样挂点）', () => {
    render(
      <TechnicalDetails
        label="技术详情"
        code="DAEMON_UNREACHABLE"
        raw="TypeError: Failed to fetch"
      />,
    );
    expect(document.querySelector('[data-df-error-code="DAEMON_UNREACHABLE"]')).not.toBeNull();
    expect(document.querySelector('[data-df-error-raw]')?.textContent).toBe(
      'TypeError: Failed to fetch',
    );
  });

  it('只有原始信息没有码（如透传失败）：折叠件仍在，不渲染空码位', () => {
    render(<TechnicalDetails label="技术详情" raw="doc_not_found：文档不存在" />);
    expect(screen.getByText('doc_not_found：文档不存在')).toBeTruthy();
    expect(document.querySelector('[data-df-error-code]')).toBeNull();
  });

  it('码与原文都没有 → 不渲染（不给界面留空折叠件）', () => {
    const { container } = render(<TechnicalDetails label="技术详情" />);
    expect(container.querySelector('details')).toBeNull();
  });
});
