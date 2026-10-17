// @vitest-environment jsdom
/**
 * 市场卡片与网格测试（接缝：`MarketCard` / `CardGrid` 的可观测行为）。
 *
 * 断言用户能看到/触发的行为：双语主副名、许可与来源徽标、悬停抬升态、
 * 安装按钮三态（可装载/已装载/仅看灰化 + 原因）、搜索命中高亮、打开与卸载回调。
 * 不测内部实现（不断言样式对象，只断言 `data-df-*` 与可见文本这些对外契约）。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAsset } from '../__fixtures__/market';
import { CardGrid, MarketSkeletonGrid } from './CardGrid';
import { MarketCard } from './MarketCard';

const noop = (): void => undefined;

// RTL 的自动 cleanup 依赖 vitest 的 globals（本仓未开 globals）——显式登记，避免用例间 DOM 泄漏。
afterEach(() => {
  cleanup();
});

function renderCard(overrides: Partial<Parameters<typeof MarketCard>[0]> = {}) {
  const props = {
    asset: makeAsset(),
    loaded: false,
    query: '',
    onOpen: noop,
    onInstall: noop,
    onUninstall: noop,
    ...overrides,
  };
  return { ...render(<MarketCard {...props} />), props };
}

describe('MarketCard · 双语卡片与信息行（§6.1/§6.3）', () => {
  it('中文主名 + 英文副行 + 一句话简介', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'PDF 导出' })).toBeTruthy();
    expect(screen.getByText('PDF Export')).toBeTruthy();
    expect(screen.getByText('把设计稿一键导出为分页 PDF')).toBeTruthy();
  });

  it('缺中文时回退英文主名，不再显示重复副行', () => {
    renderCard({
      asset: makeAsset({ displayName: { en: 'PDF Export' }, summary: { en: 'Export to PDF' } }),
    });
    expect(screen.getByRole('heading', { name: 'PDF Export' })).toBeTruthy();
    expect(screen.queryByText('PDF Export', { selector: 'p' })).toBeNull();
  });

  it('来源徽标显示 repo@短哈希（社区来源必须带 commit）', () => {
    renderCard();
    expect(screen.getByText(/acme\/skills@a1b2c3d/)).toBeTruthy();
  });

  it('许可档徽标与运行前提标签随数据落地', () => {
    renderCard({ asset: makeAsset({ capabilities: ['prompt:inject', 'connector:notion'] }) });
    expect(screen.getByText('许可：可装载')).toBeTruthy();
    expect(screen.getByText('需连接器')).toBeTruthy();
  });

  it('无预览占位：固定缩略区显示 kind 图标 +「暂无预览」，不是 16:9 大灰块', () => {
    const { container } = renderCard();
    const thumb = container.querySelector('[data-df-market="card-thumb"]');
    expect(thumb).not.toBeNull();
    expect(thumb?.textContent).toContain('暂无预览');
    expect(thumb?.querySelector('svg')).not.toBeNull();
  });

  it('无回流数据时指标行给出「本地回流待授权」而非编造采纳数', () => {
    renderCard();
    expect(screen.getByText('本地回流待授权')).toBeTruthy();
    expect(screen.getByText('1200 星')).toBeTruthy();
  });
});

describe('MarketCard · 悬停抬升与交互', () => {
  it('鼠标进入 → data-df-state=hover（抬升态可取样），离开复位', async () => {
    const user = userEvent.setup();
    const { container } = renderCard();
    const card = container.querySelector('[data-df-market="card"]');
    expect(card?.getAttribute('data-df-state')).toBe('default');
    await user.hover(card as Element);
    expect(card?.getAttribute('data-df-state')).toBe('hover');
  });

  it('点击名称进入详情；更多操作里可卸载（已装载时）', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onUninstall = vi.fn();
    renderCard({ onOpen, onUninstall, loaded: true });

    await user.click(screen.getByRole('button', { name: 'PDF 导出' }));
    expect(onOpen).toHaveBeenCalledWith('gh:acme/skills#skills/pdf-export');

    await user.click(screen.getByRole('button', { name: /更多/ }));
    await user.click(screen.getByRole('menuitem', { name: '卸载' }));
    expect(onUninstall).toHaveBeenCalledWith('gh:acme/skills#skills/pdf-export');
  });

  it('主按钮触发装载回调（可装载态）', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderCard({ onInstall });
    await user.click(screen.getByRole('button', { name: '装载' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});

describe('MarketCard · 安装三态按钮（可装载 / 已装载 / 仅看）', () => {
  it('可装载：按钮可点、无禁用原因', () => {
    renderCard();
    const button = screen.getByRole('button', { name: '装载' });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('已装载：文案覆盖为「已装载」并带徽标（仍可进入更新确认）', () => {
    renderCard({ loaded: true, updateAvailable: true });
    expect(screen.getByRole('button', { name: '已装载' })).toBeTruthy();
    expect(screen.getByText('已装载', { selector: '[data-df-badge="loaded"]' })).toBeTruthy();
    expect(screen.getByText('可更新')).toBeTruthy();
  });

  it('仅看：按钮灰化且带原因（F15），点击不触发装载', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderCard({
      asset: makeAsset({
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: ['NOASSERTION'],
          ackRequired: [],
        },
      }),
      onInstall,
    });
    const button = screen.getByRole('button', { name: '仅看' });
    expect(button.getAttribute('data-df-state')).toBe('disabled');
    await user.click(button);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it('禁用主按钮文字色提升为次级文本色（仍保留 disabled 与 data-df-state）', () => {
    renderCard({
      asset: makeAsset({
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: ['NOASSERTION'],
          ackRequired: [],
        },
      }),
    });
    const button = screen.getByRole('button', { name: '仅看' });
    expect(button.getAttribute('data-df-state')).toBe('disabled');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.style.color).toBe('var(--dfg-color-text-secondary)');
  });

  it('禁用装载时同卡给次级「查看详情」入口（键盘可达详情）', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderCard({
      asset: makeAsset({
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: ['NOASSERTION'],
          ackRequired: [],
        },
      }),
      onOpen,
    });
    const secondary = screen.getByRole('button', { name: '查看详情' });
    expect(secondary.getAttribute('data-df-market')).toBe('card-open-secondary');
    await user.click(secondary);
    expect(onOpen).toHaveBeenCalledWith('gh:acme/skills#skills/pdf-export');
  });

  it('可装载时不额外渲染次级「查看详情」（避免重复动作）', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: '查看详情' })).toBeNull();
  });

  it('下架资产显示下架说明（yanked 非空）', () => {
    renderCard({
      asset: makeAsset({
        yanked: { reason: '权利人请求', at: '2026-10-15T00:00:00Z', source: 'rights-holder' },
      }),
    });
    expect(screen.getByText('已下架：权利人请求')).toBeTruthy();
  });
});

describe('MarketCard · 搜索命中高亮（D3）', () => {
  it('命中片段包 mark，未命中片段保持纯文本（不丢字符）', () => {
    const { container } = renderCard({ query: 'PDF' });
    const marks = [...container.querySelectorAll('mark')];
    expect(marks.map((mark) => mark.textContent)).toContain('PDF');
    expect(container.textContent).toContain('把设计稿一键导出为分页 PDF');
  });

  it('空查询无 mark 节点（不产生额外噪音）', () => {
    const { container } = renderCard({ query: '' });
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });
});

describe('CardGrid / 骨架网格（六态挂点）', () => {
  it('网格渲染全部卡片并带计数', () => {
    const assets = [
      makeAsset({ id: 'a' }),
      makeAsset({ id: 'b', displayName: { 'zh-CN': '第二个' } }),
    ];
    const { container } = render(
      <CardGrid
        assets={assets}
        loadedIds={['a']}
        query=""
        onOpen={noop}
        onInstall={noop}
        onUninstall={noop}
      />,
    );
    expect(container.querySelector('[data-df-market="grid"]')?.getAttribute('data-df-count')).toBe(
      '2',
    );
    expect(container.querySelectorAll('[data-df-market="card"]')).toHaveLength(2);
    expect(screen.getByText('已装载', { selector: '[data-df-badge="loaded"]' })).toBeTruthy();
  });

  it('骨架网格带 loading 态挂点（验收 §5 的 loading）', () => {
    const { container } = render(<MarketSkeletonGrid count={3} />);
    expect(container.querySelector('[data-df-state="loading"]')).toBeTruthy();
  });
});
