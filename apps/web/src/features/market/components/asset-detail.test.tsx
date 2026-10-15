// @vitest-environment jsdom
/**
 * 详情视图与评分面板测试（接缝：`AssetDetailView` / `QualityPanel` 的可观测行为）。
 *
 * 断言 D2 逐区口径：左预览占位不造假、右栏基本信息（来源 repo/commit/路径、许可、版本、ID）、
 * 概述原文 + 语言声明、五维雷达（无信号空心）、扣分原因、能力清单、装载按钮三态与卸载入口。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAsset, makeLoadPlan } from '../__fixtures__/market';
import { AssetDetailView } from './AssetDetailView';
import { QualityPanel } from './QualityPanel';

afterEach(() => {
  cleanup();
});

const noop = (): void => undefined;

function renderDetail(overrides: Partial<Parameters<typeof AssetDetailView>[0]> = {}) {
  const props = {
    asset: makeAsset(),
    loaded: false,
    updateAvailable: false,
    plan: makeLoadPlan(),
    loadedAt: null,
    onBack: noop,
    onLoadClick: noop,
    onUninstall: noop,
    ...overrides,
  };
  return { ...render(<AssetDetailView {...props} />), props };
}

describe('AssetDetailView · 左预览右信息（D2）', () => {
  it('预览区如实说明「未提供预览产物」，不生成示意图', () => {
    renderDetail();
    expect(screen.getByText('预览')).toBeTruthy();
    expect(screen.getByText(/未提供预览产物/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '在 GitHub 打开' })).toBeTruthy();
  });

  it('基本信息含 repo/commit 短哈希/路径/作者/版本/ID/星标', () => {
    renderDetail();
    expect(screen.getByText(/acme\/skills · commit a1b2c3d/)).toBeTruthy();
    expect(screen.getByText('skills/pdf-export')).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getByText('1.2.0')).toBeTruthy();
    expect(screen.getByText('gh:acme/skills#skills/pdf-export')).toBeTruthy();
    expect(screen.getByText('1200')).toBeTruthy();
  });

  it('概述显示原文；英文原文给语言声明（§6.3，不切换界面语言）', () => {
    const { unmount } = renderDetail({
      asset: makeAsset({ description: 'Export designs to paginated PDF files.' }),
    });
    expect(screen.getByText(/资产原文（英文）/)).toBeTruthy();
    unmount();
    renderDetail();
    expect(screen.getByText('导出分页 PDF 的工作流说明。')).toBeTruthy();
  });

  it('缺 description 时如实说明，不补造内容', () => {
    const asset = makeAsset();
    delete asset.description;
    renderDetail({ asset });
    expect(screen.getByText(/未提供长文概述/)).toBeTruthy();
  });

  it('能力与安全区列出能力项与静态审计结论', () => {
    renderDetail({ asset: makeAsset({ capabilities: ['prompt:inject', 'subprocess'] }) });
    expect(screen.getByText('能力与安全')).toBeTruthy();
    expect(screen.getByText('执行子进程')).toBeTruthy();
    expect(screen.getByText(/静态审计结论：通过/)).toBeTruthy();
  });

  it('「试试这样用」按标签/场景给判断依据，并声明话术来源', () => {
    renderDetail();
    expect(screen.getByText('试试这样用')).toBeTruthy();
    expect(screen.getByText(/示例话术取自资产自身文档/)).toBeTruthy();
    expect(screen.getByText('pdf')).toBeTruthy();
    expect(screen.getByText('ppt-design')).toBeTruthy();
  });

  it('更多区展示 digest 与溯源时刻', () => {
    renderDetail();
    expect(
      screen.getByText('sha256:9f2c0000000000000000000000000000000000000000000000000000000000ff'),
    ).toBeTruthy();
    expect(screen.getByText('2026-10-15T22:05:11Z')).toBeTruthy();
  });
});

describe('AssetDetailView · 安装三态与卸载（D2/D4 边界）', () => {
  it('可装载：按钮可点并触发装载回调', async () => {
    const user = userEvent.setup();
    const onLoadClick = vi.fn();
    renderDetail({ onLoadClick });
    await user.click(screen.getByRole('button', { name: '装载' }));
    expect(onLoadClick).toHaveBeenCalledTimes(1);
  });

  it('仅看：按钮灰化带原因，点击不触发', async () => {
    const user = userEvent.setup();
    const onLoadClick = vi.fn();
    renderDetail({
      asset: makeAsset({
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: [],
          ackRequired: [],
        },
      }),
      onLoadClick,
    });
    const button = screen.getByRole('button', { name: '仅看' });
    expect(button.getAttribute('data-df-state')).toBe('disabled');
    await user.click(button);
    expect(onLoadClick).not.toHaveBeenCalled();
  });

  it('已装载：按钮为「已装载」，出现卸载入口，且显示本地装载时刻', async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    renderDetail({
      loaded: true,
      updateAvailable: true,
      loadedAt: '2026-10-15T23:00:00Z',
      onUninstall,
    });
    expect(screen.getByRole('button', { name: '已装载' })).toBeTruthy();
    expect(screen.getByText('可更新')).toBeTruthy();
    expect(screen.getByText('2026-10-15T23:00:00Z')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '卸载' }));
    expect(onUninstall).toHaveBeenCalledTimes(1);
  });

  it('下架资产给出下架说明与卸载入口（不静默删除）', () => {
    renderDetail({
      loaded: true,
      asset: makeAsset({
        yanked: { reason: '许可变更', at: '2026-10-15T00:00:00Z', source: 'license-change' },
      }),
    });
    expect(screen.getByRole('alert').textContent).toContain('许可变更');
  });

  it('返回按钮回传 onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderDetail({ onBack });
    await user.click(screen.getByRole('button', { name: '返回市场' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('QualityPanel · 雷达与扣分原因（§5.3）', () => {
  const quality = {
    score: 0.82,
    dims: { spec: 0.9, maintenance: 0.7, docs: 0.8, security: 0.9, ecosystem: 0 },
    explain: {
      ecosystem: { signals: [], deductions: [] },
      docs: {
        signals: [{ code: 'readme', value: 1, weight: 0.4 }],
        deductions: [{ code: 'D2', reason: '无使用示例', delta: -0.2 }],
      },
    },
  };

  it('五维齐、无信号维标「无信号」且雷达点为空心（区别于 0 分）', () => {
    const { container } = render(<QualityPanel quality={quality} />);
    expect(container.querySelectorAll('[data-df-market="dim-row"]')).toHaveLength(5);
    expect(screen.getByText('生态热度')).toBeTruthy();
    expect(screen.getByText('无信号')).toBeTruthy();
    const dots = [...container.querySelectorAll('[data-df-market="radar-dot"]')];
    expect(dots).toHaveLength(5);
    expect(
      dots
        .find((dot) => dot.getAttribute('data-df-dim') === 'ecosystem')
        ?.getAttribute('data-df-signal'),
    ).toBe('none');
    expect(
      dots
        .find((dot) => dot.getAttribute('data-df-dim') === 'spec')
        ?.getAttribute('data-df-signal'),
    ).toBe('present');
  });

  it('扣分原因按维度列出（词表码给人话文案）', () => {
    render(<QualityPanel quality={quality} />);
    expect(screen.getByText('为什么是这个分')).toBeTruthy();
    expect(screen.getByText(/D2 无使用示例/)).toBeTruthy();
  });

  it('缺 explain 时如实说明「未提供扣分原因」，不补造', () => {
    render(
      <QualityPanel
        quality={{
          score: 0.5,
          dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
        }}
      />,
    );
    expect(screen.getByText(/未提供扣分原因/)).toBeTruthy();
  });
});
