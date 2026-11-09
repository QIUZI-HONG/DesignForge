/**
 * @dforge/daemon · 市场路由（读 MK-04 产出的索引；FE-11 / FE-10 市场面板消费）。
 *
 * 空态语义：**无索引 → state='empty' + warning**（不是错误）；索引损坏同样按空态处理；
 * 仅「详情/装载目标缺失」走错误码（market_asset_not_found）。
 * 装载真实写入走 MCP 确认桩（dryRun → ackToken → 审计）；本路由只出**装载提案**。
 */

import { DAEMON_ROUTES, decodeMarketQuery } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

/** Fastify 的 query 记录 → URLSearchParams（只收字符串值；数组/对象按旧 parseQuery 口径忽略）。 */
function toSearchParams(query: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') search.set(key, value);
  }
  return search;
}

/** 注册市场路由。 */
export function registerMarketRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.get(DAEMON_ROUTES.marketQuery.path, async (request, reply) => {
    // 查询串口径收口 contracts `decodeMarketQuery`（arch-v1 · 票② · #4）：
    // 与原 routes/market.ts parseQuery 表逐项一致（容忍、逐项校验、丢弃非法值）。
    const params = decodeMarketQuery(
      toSearchParams((request.query ?? {}) as Record<string, unknown>),
    );
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
    // 可装载提案随响应签发一次性 ackToken（票③）：等价复刻 MCP 桩 propose 的
    // 「提案 + 一次性短时效 token + 审计 pending」语义，POST /market/install 消费。
    if (plan.loadable) {
      const issued = await context.marketInstall.issue({ assetId: plan.assetId });
      return sendOk(reply, {
        ...plan,
        ackToken: issued.ackToken,
        ackExpiresAt: issued.expiresAt,
      });
    }
    return sendOk(reply, plan);
  });

  // 真实装载（票③）：消费一次性 ackToken → 拉取源内容 → digest 对齐 → 真写落盘 → 审计
  app.post(DAEMON_ROUTES.marketInstall.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'bad_request', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.assetId !== 'string' || record.assetId.length === 0) {
      return sendFail(reply, 'bad_request', 'assetId 必须是非空字符串');
    }
    if (typeof record.ackToken !== 'string' || record.ackToken.length === 0) {
      return sendFail(reply, 'bad_request', 'ackToken 必须是非空字符串');
    }
    const result = await context.marketInstall.install({
      assetId: record.assetId,
      ackToken: record.ackToken,
    });
    if (!result.ok) {
      return sendFail(reply, result.code, result.message, result.details);
    }
    return sendOk(reply, result.response);
  });
}
