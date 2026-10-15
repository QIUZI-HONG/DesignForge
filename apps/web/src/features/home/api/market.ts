/**
 * 市场检索客户端（FE-02；B9 搜索结果的「技能市场」结果线）。
 *
 * 边界（daemon 契约 §market）：**索引缺失/无匹配都是空态而非错误**；daemon 不可达时
 * 同样降级为 `available:false`——首页搜索框不能因为市场侧不可用而整体报错
 * （市场索引由采集线产出，未跑采集时本就该是空的）。
 *
 * 详情/装载不在本票（归 FE-10/FE-11）：结果线只做「跳市场」的入口。
 */
import {
  DAEMON_ROUTES,
  displayText,
  isApiFailure,
  isApiSuccess,
  type MarketAssetKind,
  type MarketQueryResponse,
} from '@dforge/contracts';

/** 结果线条数上限（下拉里的一行分组，给多了喧宾夺主）。 */
export const MARKET_RESULT_LIMIT = 5;

/** 一条市场命中（下拉展示用）。 */
export interface MarketSearchHit {
  id: string;
  name: string;
  kind: MarketAssetKind;
}

/** 检索结果（`available:false` = 市场侧不可用/未就绪，UI 显示降级提示行）。 */
export interface MarketSearchResult {
  available: boolean;
  items: MarketSearchHit[];
}

/** 检索选项。 */
export interface MarketSearchOptions {
  baseUrl: string;
  query: string;
  fetchImpl?: typeof fetch;
  limit?: number;
}

/** 检索技能市场资产（任何失败都降级为可用性标记，不抛错）。 */
export async function searchMarketAssets(
  options: MarketSearchOptions,
): Promise<MarketSearchResult> {
  const query = options.query.trim();
  if (query === '') return { available: true, items: [] };

  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? MARKET_RESULT_LIMIT;
  const url = new URL(`${options.baseUrl.replace(/\/$/, '')}${DAEMON_ROUTES.marketQuery.path}`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  let payload: unknown;
  try {
    const response = await fetchImpl(url);
    payload = await response.json();
  } catch {
    return { available: false, items: [] };
  }
  if (isApiFailure(payload) || !isApiSuccess<MarketQueryResponse>(payload)) {
    return { available: false, items: [] };
  }
  const items = Array.isArray(payload.result.items) ? payload.result.items : [];
  return {
    available: true,
    items: items.slice(0, limit).map((asset) => ({
      id: asset.id,
      name: displayText(asset.displayName, asset.name),
      kind: asset.kind,
    })),
  };
}
