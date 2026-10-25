'use client';

/**
 * CardGrid —— 卡片网格（D1）与骨架网格（加载态，验收标准 §5）。
 *
 * 网格列宽走 `styles.gridStyle`（8 栅格上的自适应列）；骨架用 `@dforge/ui` 的
 * `SkeletonCard`（F13 加载态族），块数 3–5 口径由该组件承担。
 */

import type { MarketAsset } from '@dforge/contracts';
import { SkeletonCard } from '@dforge/ui';

import { MarketCard } from './MarketCard';

import '../market.css';

/** 网格 props（回调与卡片同形；`loadedIds` 决定「已装载」态）。 */
export interface CardGridProps {
  assets: readonly MarketAsset[];
  loadedIds: readonly string[];
  query: string;
  onOpen: (assetId: string) => void;
  onInstall: (asset: MarketAsset) => void;
  onUninstall: (assetId: string) => void;
  /** 可更新判定（digest 与本地记录不同）。 */
  isUpdateAvailable?: (asset: MarketAsset) => boolean;
}

/** 卡片网格。 */
export function CardGrid({
  assets,
  loadedIds,
  query,
  onOpen,
  onInstall,
  onUninstall,
  isUpdateAvailable,
}: CardGridProps) {
  const loaded = new Set(loadedIds);
  return (
    <div className="dfg-market__grid" data-df-market="grid" data-df-count={assets.length}>
      {assets.map((asset) => (
        <MarketCard
          key={asset.id}
          asset={asset}
          loaded={loaded.has(asset.id)}
          updateAvailable={isUpdateAvailable?.(asset) ?? false}
          query={query}
          onOpen={onOpen}
          onInstall={onInstall}
          onUninstall={onUninstall}
        />
      ))}
    </div>
  );
}

/** 加载骨架网格（卡片骨架 3–5 块口径由 `SkeletonCard` 承担）。 */
export function MarketSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="dfg-market__grid" data-df-market="grid" data-df-state="loading" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={`skeleton-${String(index)}`} />
      ))}
    </div>
  );
}
