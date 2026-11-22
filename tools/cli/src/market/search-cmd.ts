/**
 * `df market search` —— 检索（判据链第 5 环）。
 *
 * 两种模式：
 * - 单查询：`--q <串>` → 打印命中（id / 名称 / 质量分 / 相关度 / 命中词）；
 * - 查询集：`--query-set` → 跑 `query-set.ts` 全部示例查询，逐条断言（≥1 命中；≥5 条 ≥3 命中），
 *   记录耗时分布（P95 基线，首版不设硬门槛，规格《市场首实现》§4 第 5 环）。
 *
 * 检索路径：**只读 ADS 产物**（`df.marketplace.index.v1.json` + `market_search_index.v1.json`），
 * 走 `searchMarketIndex`（倒排产物直查，不重建索引）——证据脚本/daemon 同款路径。
 *
 * 退出码：0 通过 / 1 断言失败（查询集某条不达下限、ADS 产物存在但损坏）/
 *         2 阻塞（ADS 产物缺失）。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type MarketAsset, parseMarketplaceIndex } from '@dforge/contracts';
import { ads } from '@dforge/ingest';
import type { MarketCommandOutcome } from './outcome.ts';
import { type DataPaths, resolveDataPaths } from './paths.ts';
import {
  MARKET_EXAMPLE_QUERIES,
  type MarketExampleQuery,
  QUERY_SET_MIN_QUERIES_WITH_3,
  QUERY_SET_MIN_TOTAL,
} from './query-set.ts';

/** 出口形状取全库唯一真源（见 outcome.ts）；保留本名，调用点不动。 */
export type SearchCommandResult = MarketCommandOutcome;

export interface SearchQueryOutcome {
  id: string;
  q: string;
  hits: number;
  ms: number;
  passed: boolean;
  minHits: number;
  topIds: string[];
  expectAnyRepoOk: boolean | null;
}

export interface LoadedAds {
  assets: MarketAsset[];
  searchIndex: ads.SearchIndex;
  indexSha256: string;
  searchIndexSha256: string;
}

/** 读入结果（判别式）：缺产物 → 阻塞（exit 2）；坏产物 → 断言失败（exit 1）。 */
export type AdsLoadResult =
  | { ok: true; loaded: LoadedAds }
  | { ok: false; kind: 'missing' | 'invalid'; reason: string };

/** 读 ADS 产物（index + search index）。 */
export async function loadAdsArtifacts(paths: DataPaths): Promise<AdsLoadResult> {
  let indexText: string;
  let searchText: string;
  try {
    indexText = await readFile(`${paths.ads}/${ads.ADS_INDEX_FILENAME}`, 'utf8');
    searchText = await readFile(`${paths.ads}/${ads.ADS_SEARCH_INDEX_FILENAME}`, 'utf8');
  } catch {
    return {
      ok: false,
      kind: 'missing',
      reason: `ADS 产物缺失（${paths.ads}/${ads.ADS_INDEX_FILENAME}）`,
    };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(indexText) as unknown;
  } catch {
    return {
      ok: false,
      kind: 'invalid',
      reason: `市场索引 JSON 解析失败（${ads.ADS_INDEX_FILENAME}）`,
    };
  }
  const parsed = parseMarketplaceIndex(parsedJson);
  if (!parsed.ok) {
    return { ok: false, kind: 'invalid', reason: `市场索引不兼容：${parsed.reason}` };
  }
  // 检索索引走 ingest 读入面（arch-v1 · 票② · #3）：去掉此前的 `JSON.parse as` 零校验。
  const searchResult = ads.readSearchIndex(searchText);
  if (!searchResult.ok) {
    return { ok: false, kind: 'invalid', reason: `检索索引不可用：${searchResult.reason}` };
  }
  const searchIndex = searchResult.value;
  const sha256Of = (text: string): string =>
    `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  return {
    ok: true,
    loaded: {
      assets: parsed.index.assets,
      searchIndex,
      indexSha256: sha256Of(indexText),
      searchIndexSha256: sha256Of(searchText),
    },
  };
}

/** 执行一条查询（只按倒排产物；返回命中 id 与耗时）。 */
export function runOneQuery(
  loaded: LoadedAds,
  q: string,
  limit: number,
): { ids: string[]; allIds: string[]; total: number; terms: string[]; ms: number } {
  const started = performance.now();
  // 语义校验（expectAnyRepo）要看**全量命中**，展示只取前 limit 条
  const response = ads.searchMarketIndex(loaded.searchIndex, q, { limit: Math.max(limit, 1000) });
  const ms = performance.now() - started;
  return {
    ids: response.hits.slice(0, limit).map((hit) => hit.id),
    allIds: response.hits.map((hit) => hit.id),
    total: response.total,
    terms: response.terms,
    ms,
  };
}

/** 跑示例查询集（逐条断言 + P95 基线）。 */
export function runQuerySet(
  loaded: LoadedAds,
  queries: readonly MarketExampleQuery[],
): { outcomes: SearchQueryOutcome[]; p95Ms: number; withAtLeast3: number; failed: string[] } {
  const outcomes: SearchQueryOutcome[] = [];
  const repoOf = new Map(loaded.assets.map((asset) => [asset.id, asset.source.repo]));
  for (const query of queries) {
    const result = runOneQuery(loaded, query.q, 20);
    const repos = new Set(result.allIds.map((id) => repoOf.get(id) ?? ''));
    const expectOk =
      query.expectAnyRepo === undefined
        ? null
        : query.expectAnyRepo.some((repo) => repos.has(repo));
    outcomes.push({
      id: query.id,
      q: query.q,
      hits: result.total,
      ms: Math.round(result.ms * 100) / 100,
      passed: result.total >= query.minHits && (expectOk === null || expectOk),
      minHits: query.minHits,
      topIds: result.ids.slice(0, 3),
      expectAnyRepoOk: expectOk,
    });
  }
  const withAtLeast3 = outcomes.filter((outcome) => outcome.hits >= 3).length;
  const failed = outcomes.filter((outcome) => !outcome.passed).map((outcome) => outcome.id);
  const p95Ms = ads.percentile(
    outcomes.map((outcome) => outcome.ms),
    0.95,
  );
  return { outcomes, p95Ms, withAtLeast3, failed };
}

/** 执行检索命令。 */
export async function runSearchCommand(
  options: { dataRoot: string; q: string | null; limit: number; querySet: boolean },
  log: (line: string) => void,
): Promise<SearchCommandResult> {
  const paths = resolveDataPaths(options.dataRoot);
  const loadedResult = await loadAdsArtifacts(paths);
  if (!loadedResult.ok) {
    if (loadedResult.kind === 'missing') {
      return {
        exitCode: 2,
        summary: { dataRoot: paths.root },
        blockedReason: `${loadedResult.reason}——先跑 df market index`,
      };
    }
    log(`ADS 产物不可用：${loadedResult.reason}`);
    return {
      exitCode: 1,
      summary: { dataRoot: paths.root, error: loadedResult.reason },
      blockedReason: null,
    };
  }
  const loaded = loadedResult.loaded;

  if (options.querySet) {
    const { outcomes, p95Ms, withAtLeast3, failed } = runQuerySet(loaded, MARKET_EXAMPLE_QUERIES);
    for (const outcome of outcomes) {
      log(
        `  ${outcome.passed ? '✓' : '✗'} [${outcome.id}] "${outcome.q}" → ${outcome.hits} 命中` +
          `（下限 ${outcome.minHits}，${outcome.ms}ms${outcome.expectAnyRepoOk === false ? '，来源仓期望未命中' : ''}）` +
          `${outcome.topIds[0] === undefined ? '' : ` · top: ${outcome.topIds[0]}`}`,
      );
    }
    log(
      `查询集：${outcomes.length} 条，达标 ${outcomes.length - failed.length} 条，≥3 命中 ${withAtLeast3} 条，P95 ${p95Ms}ms`,
    );
    const ok =
      outcomes.length >= QUERY_SET_MIN_TOTAL &&
      failed.length === 0 &&
      withAtLeast3 >= QUERY_SET_MIN_QUERIES_WITH_3;
    return {
      exitCode: ok ? 0 : 1,
      summary: {
        dataRoot: paths.root,
        queries: outcomes.length,
        failed,
        withAtLeast3,
        p95Ms,
        indexSha256: loaded.indexSha256,
        outcomes,
      },
      blockedReason: null,
    };
  }

  if (options.q === null || options.q.trim() === '') {
    return {
      exitCode: 2,
      summary: { dataRoot: paths.root },
      blockedReason: '未指定查询（--q <串> 或 --query-set）',
    };
  }

  const result = runOneQuery(loaded, options.q, options.limit);
  const byId = new Map(loaded.assets.map((asset) => [asset.id, asset]));
  log(
    `查询「${options.q}」：${result.total} 命中（${result.ms.toFixed(2)}ms，词项 ${result.terms.join(',')}）`,
  );
  for (const id of result.ids) {
    const asset = byId.get(id);
    if (asset === undefined) continue;
    log(
      `  · ${asset.displayName['zh-CN'] ?? asset.name}（${asset.kind}，质量 ${asset.quality.score.toFixed(2)}）` +
        ` — ${asset.source.repo}@${asset.source.ref.slice(0, 7)} · ${id}`,
    );
  }
  return {
    exitCode: 0,
    summary: {
      dataRoot: paths.root,
      q: options.q,
      total: result.total,
      ms: result.ms,
      terms: result.terms,
      ids: result.ids,
    },
    blockedReason: null,
  };
}
