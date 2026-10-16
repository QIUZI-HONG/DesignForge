/**
 * @dforge/daemon · 市场路由（读 MK-04 产出的索引；FE-11 / FE-10 市场面板消费）。
 *
 * 空态语义：**无索引 → state='empty' + warning**（不是错误）；索引损坏同样按空态处理；
 * 仅「详情/装载目标缺失」走错误码（market_asset_not_found）。
 * 装载真实写入走 MCP 确认桩（dryRun → ackToken → 审计）；本路由只出**装载提案**。
 */

import type {
  MarketAssetKind,
  MarketCategory,
  MarketLane,
  MarketMode,
  MarketQueryParams,
} from '@dforge/contracts';
import { DAEMON_ROUTES, MARKET_CATEGORIES, MARKET_MODES } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

const KINDS: readonly string[] = ['skill', 'plugin', 'design-system', 'template'];
const LANES: readonly string[] = ['create', 'refine', 'deliver'];

function parseQuery(query: Record<string, unknown>): MarketQueryParams {
  const params: MarketQueryParams = {};
  if (typeof query.q === 'string' && query.q.trim().length > 0) params.q = query.q;
  if (typeof query.kind === 'string') {
    const kinds = query.kind
      .split(',')
      .map((value) => value.trim())
      .filter((value) => KINDS.includes(value));
    if (kinds.length > 0) params.kinds = kinds as MarketAssetKind[];
  }
  if (
    typeof query.category === 'string' &&
    (MARKET_CATEGORIES as readonly string[]).includes(query.category)
  ) {
    params.category = query.category as MarketCategory;
  }
  if (typeof query.lane === 'string' && LANES.includes(query.lane)) {
    params.lane = query.lane as MarketLane;
  }
  if (typeof query.mode === 'string' && (MARKET_MODES as readonly string[]).includes(query.mode)) {
    params.mode = query.mode as MarketMode;
  }
  if (typeof query.scene === 'string' && query.scene.length > 0) params.scene = query.scene;
  if (typeof query.tags === 'string') {
    const tags = query.tags
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (tags.length > 0) params.tags = tags;
  }
  if (query.loadable === '1' || query.loadable === 'true') params.loadableOnly = true;
  if (query.sort === 'score' || query.sort === 'updated' || query.sort === 'name')
    params.sort = query.sort;
  if (typeof query.limit === 'string') {
    const limit = Number.parseInt(query.limit, 10);
    if (Number.isInteger(limit) && limit > 0) params.limit = limit;
  }
  if (typeof query.offset === 'string') {
    const offset = Number.parseInt(query.offset, 10);
    if (Number.isInteger(offset) && offset >= 0) params.offset = offset;
  }
  return params;
}

/** 注册市场路由。 */
export function registerMarketRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.get(DAEMON_ROUTES.marketQuery.path, async (request, reply) => {
    const params = parseQuery((request.query ?? {}) as Record<string, unknown>);
    return sendOk(reply, await context.market.query(params));
  });

  app.get(DAEMON_ROUTES.marketAsset.path, async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const result = await context.market.detail(assetId);
    if (!result.found) {
      return sendFail(reply, 'market_asset_not_found', '资产不存在（可能未采集或已下架）', {
        assetId,
      });
    }
    return sendOk(reply, result);
  });

  app.post(DAEMON_ROUTES.marketLoadPlan.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'bad_request', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.assetId !== 'string' || record.assetId.length === 0) {
      return sendFail(reply, 'bad_request', 'assetId 必须是非空字符串');
    }
    const documentId = typeof record.documentId === 'string' ? record.documentId : null;
    const plan = await context.market.loadPlan(record.assetId, documentId);
    if (plan === null) {
      return sendFail(reply, 'market_asset_not_found', '资产不存在（可能未采集或已下架）', {
        assetId: record.assetId,
      });
    }
    return sendOk(reply, plan);
  });
}
