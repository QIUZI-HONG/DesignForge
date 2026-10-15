'use client';

/**
 * 资源详情路由（D2；`/market/[assetId]`）。
 *
 * `assetId` 形如 `gh:owner/repo#path`——路由段里用 `encodeURIComponent` 编码，本页做**防御式解码**
 * （Next 已解码时二次解码是无害的：无 `%` 序列即原样返回）。
 *
 * 状态：加载 → 详情视图；未命中（found=false）→ 「资源不存在」空态；请求失败 → 错误态。
 * 装载确认（D4）由本页持有：先取提案（`/market/load-plan`），再打开确认框。
 */

import { Button, EmptyState, ErrorState } from '@dforge/ui';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AssetDetailView } from '@/features/market/components/AssetDetailView';
import { LoadConfirmDialog } from '@/features/market/components/LoadConfirmDialog';
import { MarketErrorState } from '@/features/market/components/MarketStates';
import { isUpdateAvailable } from '@/features/market/load-store';
import {
  badgeRowStyle,
  headerStyle,
  hintStyle,
  subtitleStyle,
  titleStyle,
} from '@/features/market/styles';
import { useLoadPlan, useLoadRecords, useMarketAsset } from '@/features/market/use-market';
import { t } from '@/i18n';

/** 解码路由参数（防御式：已解码的字符串不含 `%` 时原样返回）。 */
export function decodeAssetId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 资源详情页。 */
export default function MarketAssetPage() {
  const router = useRouter();
  const params = useParams<{ assetId: string }>();
  const assetId = decodeAssetId(String(params.assetId ?? ''));
  const { status, asset, error } = useMarketAsset(assetId);
  const { records, loadedIds, save, remove } = useLoadRecords();
  const [confirming, setConfirming] = useState(false);
  const loadPlan = useLoadPlan(asset === null ? null : asset.id);

  const back = (): void => {
    router.push('/market');
  };

  const record = records.find((item) => item.assetId === assetId) ?? null;

  if (status === 'loading') {
    return (
      <header style={headerStyle}>
        <h1 style={titleStyle}>{t('market.detail.loading')}</h1>
        <p style={subtitleStyle}>{t('market.loading')}</p>
      </header>
    );
  }

  if (status === 'error') {
    return <MarketErrorState message={error ?? ''} onRetry={() => {}} />;
  }

  if (asset === null) {
    return (
      <div data-df-state="empty" data-df-empty="not-found">
        <EmptyState
          title={t('market.detail.notFound.title')}
          description={t('market.detail.notFound.desc')}
          action={
            <Button variant="secondary" onClick={back}>
              {t('market.detail.notFound.action')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <>
      <AssetDetailView
        asset={asset}
        loaded={loadedIds.includes(asset.id)}
        updateAvailable={isUpdateAvailable(record, { digest: asset.digest })}
        plan={loadPlan.plan}
        loadedAt={record?.approvedAt ?? null}
        onBack={back}
        onLoadClick={() => {
          setConfirming(true);
        }}
        onUninstall={() => {
          remove(asset.id);
        }}
      />

      {loadPlan.plan === null ? null : (
        <LoadConfirmDialog
          open={confirming}
          asset={asset}
          plan={loadPlan.plan}
          ownedBefore={loadedIds.includes(asset.id)}
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          onLoaded={(loadedRecord) => {
            save(loadedRecord);
            setConfirming(false);
          }}
        />
      )}

      {loadPlan.status === 'error' ? (
        <ErrorState
          title={t('market.detail.error.title')}
          description={loadPlan.error ?? ''}
          onRetry={() => {
            setConfirming(false);
          }}
          retryLabel={t('market.error.retry')}
          code="MARKET_LOAD_PLAN_FAILED"
        />
      ) : null}

      <footer style={badgeRowStyle}>
        <span style={hintStyle}>{t('market.detail.installHint')}</span>
      </footer>
    </>
  );
}
