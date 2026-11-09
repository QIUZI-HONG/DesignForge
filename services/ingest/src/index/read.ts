/**
 * ADS 产物读入面（arch-v1 · 票② · #3）——判别式返回，坏产物不抛异常。
 *
 * 背景：同一份 ADS 产物此前有三个读者、三种严格度——daemon 深解析（宽容）、CLI deploy
 * 浅查（严格 schema）、CLI search `JSON.parse as`（零校验）。本模块把「读 + 校验 + 归一化」
 * 收成一处：
 * - `readSearchIndex(text)`：检索索引（`market_search_index.v1.json`）文本 → `SearchIndex`；
 *   宽容口径见 `schema.ts` 的 `parseSearchIndexArtifact`（坏 posting 项按条丢弃、坏 doc 判整份）；
 * - `readAdsArtifacts(dir)`：目录里的两张产物 → `{index, searchIndex}`；市场索引走**生产侧
 *   严格校验**（与 CLI deploy 写前门同口径），检索索引缺失按可选产物返回 null。
 *
 * 失败语义交给调用方：daemon 映射「空态 + warning（search-index-invalid）」，CLI 自行决定
 * exit 1（坏产物）或 exit 2（缺产物）——读入面不替调用方决定退出码。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MarketplaceIndex } from '@dforge/contracts';
import { parseMarketplaceIndex } from '@dforge/contracts';

import { ADS_INDEX_FILENAME, ADS_SEARCH_INDEX_FILENAME } from './pipeline.ts';
import { formatIndexIssues, parseSearchIndexArtifact, validateMarketplaceIndex } from './schema.ts';
import type { SearchIndex } from './search.ts';

/** 检索索引读入结果（判别式；`reason` 可进 CLI 文案与 daemon warning）。 */
export type ReadSearchIndexResult =
  | { ok: true; value: SearchIndex }
  | { ok: false; reason: string };

/** ADS 产物集读入结果（检索索引缺失 → `searchIndex: null`，不是失败）。 */
export type ReadAdsArtifactsResult =
  | { ok: true; index: MarketplaceIndex; searchIndex: SearchIndex | null }
  | { ok: false; reason: string };

/** 读检索索引文本：JSON 解析失败或关键结构不可用 → `ok:false`（不抛异常）。 */
export function readSearchIndex(text: string): ReadSearchIndexResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: '检索索引不是合法 JSON' };
  }
  const result = parseSearchIndexArtifact(parsed);
  return result.ok ? { ok: true, value: result.index } : result;
}

/**
 * 读 ADS 产物集（`<dir>/df.marketplace.index.v1.json` + `<dir>/market_search_index.v1.json`）。
 *
 * - 市场索引缺失/不可读/非 JSON/schema 不过 → `ok:false`（写入方按断言失败处理）；
 * - 检索索引缺失 → `ok:true` + `searchIndex:null`（可选产物；调用方自行决定是否必需）；
 * - 检索索引存在但损坏 → `ok:false`（不把坏产物静默当空）。
 */
export async function readAdsArtifacts(dir: string): Promise<ReadAdsArtifactsResult> {
  let indexText: string;
  try {
    indexText = await readFile(join(dir, ADS_INDEX_FILENAME), 'utf8');
  } catch {
    return { ok: false, reason: `市场索引产物缺失或不可读（${ADS_INDEX_FILENAME}）` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(indexText) as unknown;
  } catch {
    return { ok: false, reason: `市场索引不是合法 JSON（${ADS_INDEX_FILENAME}）` };
  }

  const validation = validateMarketplaceIndex(parsed);
  if (!validation.ok) {
    const detail = formatIndexIssues(validation.errors.slice(0, 3)).join('；');
    return { ok: false, reason: `市场索引未通过 schema 校验：${detail}` };
  }
  const parsedIndex = parseMarketplaceIndex(parsed);
  if (!parsedIndex.ok) {
    return { ok: false, reason: `市场索引不可用：${parsedIndex.reason}` };
  }

  let searchText: string | null = null;
  try {
    searchText = await readFile(join(dir, ADS_SEARCH_INDEX_FILENAME), 'utf8');
  } catch {
    searchText = null;
  }
  if (searchText === null) {
    return { ok: true, index: parsedIndex.index, searchIndex: null };
  }
  const searchResult = readSearchIndex(searchText);
  if (!searchResult.ok) {
    return { ok: false, reason: `检索索引不可用：${searchResult.reason}` };
  }
  return { ok: true, index: parsedIndex.index, searchIndex: searchResult.value };
}
