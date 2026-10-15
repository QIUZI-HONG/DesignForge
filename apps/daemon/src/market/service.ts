/**
 * @dforge/daemon · 市场服务（读取 MK-04 产出的索引）。
 *
 * 口径（简报 §2 / 市场规格 §1.5）：
 * - **无索引 → 空态**（state='empty' + warning 'index-missing'），不是错误；
 * - 索引损坏 → 空态 + warning 'index-invalid'（不 500，前端在结果区提示）；
 * - 查询/排序在 daemon 内存内做（BM25/HNSW 检索属 MK-04；本段为过滤 + 质量分排序）；
 * - 装载真实写入走 MCP 确认桩（dryRun → ackToken → 审计），本服务只出**装载提案**。
 */

import { readFile } from 'node:fs/promises';

import type {
  InstallGateMode,
  MarketAsset,
  MarketAssetDetailResponse,
  MarketLoadPlan,
  MarketplaceIndex,
  MarketQueryParams,
  MarketQueryResponse,
  MarketQueryWarning,
} from '@dforge/contracts';
import { displayText, MARKETPLACE_INDEX_SCHEMA, parseMarketplaceIndex } from '@dforge/contracts';

/** 市场服务接口。 */
export interface MarketService {
  /** 查询（含空态/告警）。 */
  query(params: MarketQueryParams): Promise<MarketQueryResponse>;
  /** 详情（未命中返回 found=false，由路由映射错误码）。 */
  detail(assetId: string): Promise<MarketAssetDetailResponse>;
  /** 装载提案（三态；未命中返回 null）。 */
  loadPlan(assetId: string, documentId: string | null): Promise<MarketLoadPlan | null>;
}

interface IndexState {
  index: MarketplaceIndex | null;
  sourcePath: string | null;
  warning: MarketQueryWarning | null;
}

/** 创建市场服务。indexPath 显式指定优先；否则按候选路径探测首个存在者。 */
export function createMarketService(options: {
  indexPath: string | null;
  candidatePaths: string[];
}): MarketService {
  const candidates = options.indexPath === null ? options.candidatePaths : [options.indexPath];

  const loadIndex = async (): Promise<IndexState> => {
    let foundAny = false;
    for (const candidate of candidates) {
      let raw: string;
      try {
        raw = await readFile(candidate, 'utf8');
      } catch {
        continue;
      }
      foundAny = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return {
          index: null,
          sourcePath: candidate,
          warning: { code: 'index-invalid', message: '市场索引 JSON 解析失败（按空态处理）' },
        };
      }
      const result = parseMarketplaceIndex(parsed);
      if (!result.ok) {
        return {
          index: null,
          sourcePath: candidate,
          warning: { code: 'index-invalid', message: `市场索引不兼容：${result.reason}` },
        };
      }
      return { index: result.index, sourcePath: candidate, warning: null };
    }
    if (!foundAny) {
      return {
        index: null,
        sourcePath: null,
        warning: { code: 'index-missing', message: '尚无市场索引（等待采集线产出，属正常空态）' },
      };
    }
    return { index: null, sourcePath: null, warning: null };
  };

  const match = (asset: MarketAsset, params: MarketQueryParams): boolean => {
    if (
      params.kinds !== undefined &&
      params.kinds.length > 0 &&
      !params.kinds.includes(asset.kind)
    ) {
      return false;
    }
    if (params.category !== undefined && asset.facets.category !== params.category) return false;
    if (params.lane !== undefined && asset.facets.lane !== params.lane) return false;
    if (params.mode !== undefined && asset.facets.mode !== params.mode) return false;
    if (params.scene !== undefined && !asset.facets.scenes.includes(params.scene)) return false;
    if (params.tags !== undefined && params.tags.length > 0) {
      const haystack = new Set(asset.facets.tags.map((tag) => tag.toLowerCase()));
      if (!params.tags.some((tag) => haystack.has(tag.toLowerCase()))) return false;
    }
    if (params.loadableOnly === true && asset.installGate.mode !== 'loadable') return false;
    if (params.q !== undefined && params.q.trim().length > 0) {
      const needle = params.q.trim().toLowerCase();
      const haystack = [
        asset.name,
        displayText(asset.displayName, asset.name),
        displayText(asset.summary, ''),
        asset.source.repo,
        ...asset.facets.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  };

  const sortAssets = (assets: MarketAsset[], sort: MarketQueryParams['sort']): MarketAsset[] => {
    const sorted = [...assets];
    switch (sort) {
      case 'name':
        sorted.sort((a, b) =>
          displayText(a.displayName, a.name).localeCompare(
            displayText(b.displayName, b.name),
            'zh-CN',
          ),
        );
        break;
      case 'updated':
        sorted.sort((a, b) => b.source.pushedAt.localeCompare(a.source.pushedAt));
        break;
      default:
        // 默认综合评分（市场规格 §6.1：quality.score 排序；并列时按点赞近的星标增速信号简化处理）
        sorted.sort((a, b) => b.quality.score - a.quality.score || b.source.stars - a.source.stars);
        break;
    }
    return sorted;
  };

  const findAsset = async (assetId: string): Promise<MarketAsset | null> => {
    const state = await loadIndex();
    if (state.index === null) return null;
    return state.index.assets.find((asset) => asset.id === assetId) ?? null;
  };

  return {
    async query(params: MarketQueryParams): Promise<MarketQueryResponse> {
      const state = await loadIndex();
      const warnings: MarketQueryWarning[] = [];
      if (state.warning !== null) warnings.push(state.warning);

      if (state.index === null) {
        return {
          schema: MARKETPLACE_INDEX_SCHEMA,
          state: 'empty',
          generatedAt: null,
          total: 0,
          counts: null,
          items: [],
          warnings,
        };
      }

      const matched = state.index.assets.filter((asset) => match(asset, params));
      const sorted = sortAssets(matched, params.sort);
      const offset = Math.max(0, params.offset ?? 0);
      const limit = Math.min(Math.max(1, params.limit ?? 24), 200);
      const items = sorted.slice(offset, offset + limit);

      return {
        schema: MARKETPLACE_INDEX_SCHEMA,
        state: matched.length === 0 ? 'empty' : 'ok',
        generatedAt: state.index.generatedAt,
        total: matched.length,
        counts: state.index.counts,
        items,
        warnings,
      };
    },

    async detail(assetId: string): Promise<MarketAssetDetailResponse> {
      const asset = await findAsset(assetId);
      return asset === null ? { found: false, assetId } : { found: true, asset };
    },

    async loadPlan(assetId: string, _documentId: string | null): Promise<MarketLoadPlan | null> {
      const asset = await findAsset(assetId);
      if (asset === null) return null;
      const { installGate } = asset;
      const mode: InstallGateMode = installGate.mode;
      const notice =
        mode === 'loadable'
          ? '可装载：将写入 .dfg/market 目录（dryRun 预览 → 确认后单事务写入 → 审计留痕）'
          : mode === 'view-only'
            ? '仅可查看：许可档位不允许装载，可浏览来源并跳转原始仓库'
            : '禁止装载：许可明确禁止再分发 / 已下架 / 品牌复刻风险';
      return {
        assetId: asset.id,
        mode,
        loadable: mode === 'loadable',
        ackRequired: installGate.ackRequired,
        license: {
          spdx: asset.source.license.spdx,
          gate: asset.source.license.gate,
          evidencePath: asset.source.license.evidence.path,
          evidenceSha256: asset.source.license.evidence.sha256,
        },
        targetPathHint: mode === 'loadable' ? `.dfg/market/${asset.kind}/${asset.name}/` : null,
        reasons: installGate.reasons,
        notice,
      };
    },
  };
}

/** 便于测试与前端展示的索引来源说明（含 documentId 提示）。 */
export function describeLoadTarget(plan: MarketLoadPlan, documentId: string | null): string {
  if (plan.targetPathHint === null) return plan.notice;
  if (documentId === null) return `${plan.notice}；落点：${plan.targetPathHint}`;
  return `${plan.notice}；落点：${documentId}/${plan.targetPathHint}`;
}
