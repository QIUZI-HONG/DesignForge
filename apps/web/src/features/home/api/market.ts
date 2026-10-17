/**
 * 市场检索客户端（FE-02；B9 搜索结果的「技能市场」结果线）。
 *
 * 边界（daemon 契约 §market）：**索引缺失/无匹配都是空态而非错误**；daemon 不可达时
 * 同样降级为 `available:false`——首页搜索框不能因为市场侧不可用而整体报错
 * （市场索引由采集线产出，未跑采集时本就该是空的）。
 *
 * 超时口径（修复批次 3 · 工作包 C）：与文档网关共用同一超时归一（`gateway-timeout`）
 * ——daemon 不响应时**到上限**降级为 `available:false`，市场分组不会永久停在
 * 「正在搜索…」（首页侧另有一层兜底，两者是同一上限，见 `components/HomeView`）。
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

import { isSearchDegraded } from '@/features/market';

import { fetchWithinTimeout, GATEWAY_TIMEOUT_MS } from './gateway-timeout';

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
  /**
   * 检索索引降级（有卡片但检索退化为字面匹配，E1 补口 · 复核 Spec c）：
   * 首页市场结果线与市场页同口径，给「暂按字面匹配」提示（复用市场侧 i18n 键）。
   */
  searchDegraded: boolean;
}

/** 检索选项。 */
export interface MarketSearchOptions {
  baseUrl: string;
  query: string;
  fetchImpl?: typeof fetch;
  limit?: number;
  /** 统一超时上限（毫秒；测试注入小值，缺省 {@link GATEWAY_TIMEOUT_MS}）。 */
  timeoutMs?: number;
}

/** 检索技能市场资产（任何失败都降级为可用性标记，不抛错）。 */
export async function searchMarketAssets(
  options: MarketSearchOptions,
): Promise<MarketSearchResult> {
  const query = options.query.trim();
  if (query === '') return { available: true, items: [], searchDegraded: false };

  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? MARKET_RESULT_LIMIT;
  const url = new URL(`${options.baseUrl.replace(/\/$/, '')}${DAEMON_ROUTES.marketQuery.path}`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  let payload: unknown;
  try {
    const response = await fetchWithinTimeout(
      fetchImpl,
      url.toString(),
      {},
      options.timeoutMs ?? GATEWAY_TIMEOUT_MS,
    );
    payload = await response.json();
  } catch {
    // 含超时（GatewayTimeoutError）：市场侧一律降级，不抛给页面
    return { available: false, items: [], searchDegraded: false };
  }
  if (isApiFailure(payload) || !isApiSuccess<MarketQueryResponse>(payload)) {
    return { available: false, items: [], searchDegraded: false };
  }
  const items = Array.isArray(payload.result.items) ? payload.result.items : [];
  return {
    available: true,
    items: items.slice(0, limit).map((asset) => ({
      id: asset.id,
      name: displayText(asset.displayName, asset.name),
      kind: asset.kind,
    })),
    // 降级判定与市场页同一实现（`@/features/market` 公开面）：`search-index-*` → 字面匹配
    searchDegraded: isSearchDegraded(payload.result.warnings),
  };
}
