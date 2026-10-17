/**
 * 市场列表增量分页（修复批次 5 · DEF-R1）——纯函数状态机。
 *
 * 背景：列表此前固定取 `limit=60` 且无分页，344 个资源中约 284 个不可达，
 * 中文检索 78 命中只显示 60。daemon 早已支持 `limit/offset`（`service.ts` 按
 * offset 切片），缺的是**页面侧累加**。这里把「追加/去重/终点」收敛成纯函数，
 * 供 `useMarketPagination` 与测试共用。
 */
import type { MarketAsset } from '@dforge/contracts';

/** 追加一页并去重（保持既有顺序；同 id 以先出现者为准，防止 offset 漂移导致重复卡）。 */
export function appendMarketPage(
  existing: readonly MarketAsset[],
  incoming: readonly MarketAsset[],
): MarketAsset[] {
  const seen = new Set(existing.map((asset) => asset.id));
  const merged = [...existing];
  for (const asset of incoming) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
}

/** 是否还有下一页（以服务端 total 与已载数量比较；空索引不提供「加载更多」）。 */
export function hasMorePages(loaded: number, total: number): boolean {
  return total > 0 && loaded < total;
}
