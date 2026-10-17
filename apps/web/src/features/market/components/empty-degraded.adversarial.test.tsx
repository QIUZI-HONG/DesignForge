// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· 空态与降级面（任务书 §3）。
 *
 * 覆盖：市场索引缺失/损坏（给采集指引而非空白）、坏响应体不静默、状态分类口径不混、
 * 读屏挂点。组件基线用例已覆盖「四类空态文案」，本文件补**坏数据出口**与**分类优先级**。
 */
import type { MarketQueryResponse } from '@dforge/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { classifyMarketOutcome, MARKET_COLLECT_COMMAND, readEnvelope } from '../../market/api';
import {
  MarketEmptyState,
  MarketErrorState,
  MarketWarningBanner,
} from '../../market/components/MarketStates';

afterEach(cleanup);

/** 造最小查询响应（只带分类关心的字段）。 */
function queryResponse(overrides: Partial<MarketQueryResponse> = {}): MarketQueryResponse {
  return {
    schema: 'df.marketplace.index/v1',
    state: 'empty',
    generatedAt: null,
    total: 0,
    counts: null,
    items: [],
    warnings: [],
    ...overrides,
  };
}

describe('对抗 · 市场空态与坏数据', () => {
  it('索引缺失：空态 + 采集命令（不是空白、不伪造卡片）', () => {
    render(<MarketEmptyState kind="index-missing" />);
    expect(screen.getByText(/索引尚未产出/)).toBeTruthy();
    expect(screen.getByText(new RegExp(MARKET_COLLECT_COMMAND))).toBeTruthy();
  });

  it('索引损坏：与缺失区分口径（说明版本/字段不合契约）', () => {
    render(<MarketEmptyState kind="index-invalid" />);
    expect(screen.getByText(/无法解析/)).toBeTruthy();
  });

  it('readEnvelope：HTML/纯文本响应体（反代错页）→ 判失败且文案可读', () => {
    const result = readEnvelope('<html><body>502 Bad Gateway</body></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toContain('不是可识别的 JSON 信封');
    }
  });

  it('readEnvelope：ok:true 但缺 result → 绝不当成功（防「静默空」）', () => {
    expect(readEnvelope({ ok: true }).ok).toBe(false);
  });

  // 原为 it.fails（缺陷证据）：市场 readEnvelope 只查 `'result' in value`，
  // `{ok:true,result:null}` 被判成功 → 下游 `classifyMarketOutcome(null)` 崩、
  // 页面结果区静默空白（见 app/market/page-null-result.adversarial.test.tsx）。
  // 修法落地（result 判空归一为失败）后按验证方注释改回 it()。
  it('readEnvelope：result 为 null → 也判失败（result:null 不得被当成功）', () => {
    expect(readEnvelope({ ok: true, result: null }).ok).toBe(false);
  });

  it('分类优先级：索引缺失/损坏压过「无结果」；部分失败只在有结果时出现', () => {
    expect(
      classifyMarketOutcome(
        queryResponse({
          warnings: [{ code: 'index-missing', message: '尚无索引' }],
        }),
      ),
    ).toBe('index-missing');
    expect(
      classifyMarketOutcome(
        queryResponse({
          warnings: [{ code: 'index-invalid', message: '坏' }],
        }),
      ),
    ).toBe('index-invalid');
    expect(classifyMarketOutcome(queryResponse())).toBe('no-result');
    expect(
      classifyMarketOutcome(
        queryResponse({
          state: 'ok',
          total: 1,
          items: [{ id: 'gh:a/b#x' } as MarketQueryResponse['items'][number]],
        }),
      ),
    ).toBe('ok');
    expect(
      classifyMarketOutcome(
        queryResponse({
          state: 'ok',
          total: 1,
          items: [{ id: 'gh:a/b#x' } as MarketQueryResponse['items'][number]],
          warnings: [{ code: 'partial-failure', message: '1 个来源不可达' }],
        }),
      ),
    ).toBe('partial');
  });

  it('错误态：daemon 未启动的引导文案 + 重试回调可用', () => {
    let retried = 0;
    render(
      <MarketErrorState
        message="无法连接本地服务（127.0.0.1:4318）"
        onRetry={() => {
          retried += 1;
        }}
      />,
    );
    screen.getByRole('button', { name: /重试/ }).click();
    expect(retried).toBe(1);
  });

  it('告警条：部分失败提示是 role=status（读屏可播报）', () => {
    render(<MarketWarningBanner message="1 个来源暂时不可达" />);
    expect(screen.getByRole('status').textContent).toContain('1 个来源暂时不可达');
  });

  it('空态容器有 data-df-state 挂点（截图/门禁定位）', () => {
    const { container } = render(<MarketEmptyState kind="index-missing" />);
    expect(container.querySelector('[data-df-state="empty"]')).not.toBeNull();
  });
});
