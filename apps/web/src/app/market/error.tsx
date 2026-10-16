'use client';

/**
 * 市场路由段的渲染期错误边界（Next App Router 段级边界：`/market` 及其子段）。
 *
 * W1 缺陷的一半是「无错误边界 → 渲染期异常整树卸载 = 白屏」。形状校验已把可预见的
 * 坏数据拦在解包点，本边界是**最后一道**：任何未预期的渲染期异常都在此处收敛为
 * 可见错误态（六态之一的 error 挂点）并给「重试」（Next 的 `reset` 重新渲染该段），
 * 而不是留下一张白页。
 */
import { ErrorState } from '@dforge/ui';

import { t } from '@/i18n';

export default function MarketErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div data-df-state="error" data-df-error="render">
      <ErrorState
        title={t('market.error.crash.title')}
        description={t('market.error.crash.desc')}
        code={
          error.digest === undefined ? 'E_DF_MARKET_RENDER' : `E_DF_MARKET_RENDER/${error.digest}`
        }
        diagnosticsLabel={t('state.diagnostics')}
        onRetry={reset}
        retryLabel={t('market.error.retry')}
      />
    </div>
  );
}
