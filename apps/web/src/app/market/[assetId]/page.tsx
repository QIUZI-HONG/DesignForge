'use client';

/**
 * 资源详情路由（D2；`/market/[assetId]`）。
 *
 * `assetId` 形如 `gh:owner/repo#path`——路由段里用 `encodeURIComponent` 编码，本页做**防御式解码**
 * （Next 已解码时二次解码是无害的：无 `%` 序列即原样返回）。
 *
 * 状态（E2 分流，修复批次 4）：加载 → 详情视图；**资产不存在**（daemon `market_asset_not_found`
 * 或信封 `found=false`）→ 独立「未找到该资产」空态 + 去市场出口；**连接/服务错误** → 错误态
 * （带 daemon 错误码与重试）——两类彻底分流，不再把 not-found 挂到「无法连接本地服务」外壳。
 * 装载确认（D4）由本页持有：先取提案（`/market/load-plan`），再打开确认框。
 */

import type { DF_ERROR_CODES } from '@dforge/contracts';
import { Button, EmptyState, ErrorState } from '@dforge/ui';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AssetDetailView,
  badgeRowStyle,
  headerStyle,
  hintStyle,
  isUpdateAvailable,
  LoadConfirmDialog,
  MarketErrorState,
  subtitleStyle,
  titleStyle,
  useLoadPlan,
  useLoadRecords,
  useMarketAsset,
} from '@/features/market';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

/** 解码路由参数（防御式：已解码的字符串不含 `%` 时原样返回）。 */
export function decodeAssetId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 详情缺失的 daemon 错误码（E2 分流依据；`satisfies` 保证与契约码表同源，删码即编译失败）。 */
const MARKET_ASSET_NOT_FOUND_CODE =
  'market_asset_not_found' satisfies (typeof DF_ERROR_CODES)[number];

/** 资产不存在空态（E2；`data-df-empty="not-found"` 六态挂点保持逐字不变）。 */
function AssetNotFoundState({ onBack }: { onBack: () => void }) {
  return (
    <div data-df-state="empty" data-df-empty="not-found">
      <EmptyState
        title={t('market.detail.notFound.title')}
        description={t('market.detail.notFound.desc')}
        action={
          <Button variant="secondary" onClick={onBack}>
            {t('market.detail.notFound.action')}
          </Button>
        }
      />
    </div>
  );
}

/** 资源详情页。 */
export default function MarketAssetPage() {
  const router = useRouter();
  const params = useParams<{ assetId: string }>();
  const assetId = decodeAssetId(String(params.assetId ?? ''));
  const { status, asset, error, errorCode, reload } = useMarketAsset(assetId);
  const { records, loadedIds, save, remove } = useLoadRecords();
  const [confirming, setConfirming] = useState(false);
  const loadPlan = useLoadPlan(asset === null ? null : asset.id);

  const back = (): void => {
    // 回跳市场列表：续写当前端点参数（D-3/UX-01）——回跳后列表取数仍命中同一 daemon
    router.push(withDaemonEndpoint('/market'));
  };

  const record = records.find((item) => item.assetId === assetId) ?? null;

  if (status === 'loading') {
    return (
      <header style={headerStyle} data-df-state="loading" data-df-loading="detail">
        <h1 style={titleStyle}>{t('market.detail.loading')}</h1>
        <p style={subtitleStyle}>{t('market.loading')}</p>
      </header>
    );
  }

  // 资产不存在与连接/服务错误分流：not-found 不挂「无法连接本地服务」外壳（E2）
  if (status === 'error' && errorCode !== MARKET_ASSET_NOT_FOUND_CODE) {
    return (
      <MarketErrorState
        message={error ?? ''}
        {...(errorCode === null ? {} : { code: errorCode })}
        onRetry={reload}
      />
    );
  }

  if (asset === null) {
    return <AssetNotFoundState onBack={back} />;
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

      {loadPlan.status === 'loading' && confirming ? (
        <p style={hintStyle} data-df-state="loading" data-df-loading="load-plan">
          {t('market.detail.planLoading')}
        </p>
      ) : null}

      {loadPlan.status === 'error' ? (
        <ErrorState
          title={t('market.detail.error.title')}
          description={loadPlan.error ?? ''}
          onRetry={() => {
            setConfirming(false);
          }}
          retryLabel={t('market.error.retry')}
          code="MARKET_LOAD_PLAN_FAILED"
          diagnosticsLabel={t('state.diagnostics')}
        />
      ) : null}

      <footer style={badgeRowStyle}>
        <span style={hintStyle}>{t('market.detail.installHint')}</span>
      </footer>
    </>
  );
}
