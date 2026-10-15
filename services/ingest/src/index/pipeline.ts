/**
 * ADS 产物管线（MK-04）——DWS 行 → 市场索引 + 检索索引 → schema 校验 → 落盘（§4.1 目录口径）。
 *
 * 产物（ADS 应用层，JSON，可读可 diff）：
 * - `df.marketplace.index.v1.json`（卡片真值，§1 契约）；
 * - `market_search_index.v1.json`（BM25 倒排，§4.1）。
 *
 * 纪律：先校验后落盘（判据链第 4 环）——校验不过不写文件、由调用方按「真失败」处理；
 * 时间戳一律由批次元数据注入（§4.3 去时钟依赖，同输入同产物）。
 * 落盘位置由调用方给定（首版 `data/ads/`；门禁/复跑写证据目录，不污染工作区）。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MarketplaceIndex } from '@dforge/contracts';

import { buildMarketplaceIndex, type MarketplaceBuildOptions } from './build.ts';
import type { DwsAssetRecord } from './dws.ts';
import { type IndexValidationResult, validateMarketplaceIndex } from './schema.ts';
import { buildSearchIndex, type SearchIndex } from './search.ts';

/** ADS 产物集（内存态）。 */
export interface AdsArtifacts {
  index: MarketplaceIndex;
  searchIndex: SearchIndex;
  validation: IndexValidationResult;
}

/** 落盘结果（路径 + 哈希，供证据 JSON 引用）。 */
export interface WrittenAdsArtifacts {
  index: { path: string; sha256: string; length: number };
  searchIndex: { path: string; sha256: string; length: number };
}

/** 产物文件名（§4.1 定稿）。 */
export const ADS_INDEX_FILENAME = 'df.marketplace.index.v1.json';
export const ADS_SEARCH_INDEX_FILENAME = 'market_search_index.v1.json';

/** 构建产物集（含校验结论；不落盘）。 */
export function buildAdsArtifacts(
  records: readonly DwsAssetRecord[],
  options: MarketplaceBuildOptions,
): AdsArtifacts {
  const index = buildMarketplaceIndex(records, options);
  const searchIndex = buildSearchIndex(index.assets, { generatedAt: index.generatedAt });
  return { index, searchIndex, validation: validateMarketplaceIndex(index) };
}

function sha256Of(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/**
 * 落盘产物（**写入前重新校验**，不信任调用方携带的结论；`generatedAt` 等来自产物自身，
 * 保证字节可复现）。写入形状：`<outDir>/<filename>`，UTF-8 + 末尾换行（git diff 友好）。
 */
export async function writeAdsArtifacts(
  outDir: string,
  artifacts: AdsArtifacts,
): Promise<WrittenAdsArtifacts> {
  const validation = validateMarketplaceIndex(artifacts.index);
  if (!validation.ok) {
    const detail = validation.errors
      .slice(0, 5)
      .map((issue) => `${issue.path || '(root)'}: ${issue.code}`)
      .join('; ');
    throw new Error(`索引未通过 schema 校验，拒绝落盘（前 5 条：${detail}）`);
  }
  await mkdir(outDir, { recursive: true });
  const indexText = `${JSON.stringify(artifacts.index, null, 2)}\n`;
  const searchText = `${JSON.stringify(artifacts.searchIndex, null, 2)}\n`;
  const indexPath = join(outDir, ADS_INDEX_FILENAME);
  const searchIndexPath = join(outDir, ADS_SEARCH_INDEX_FILENAME);
  await writeFile(indexPath, indexText, 'utf8');
  await writeFile(searchIndexPath, searchText, 'utf8');
  return {
    index: { path: indexPath, sha256: sha256Of(indexText), length: Buffer.byteLength(indexText) },
    searchIndex: {
      path: searchIndexPath,
      sha256: sha256Of(searchText),
      length: Buffer.byteLength(searchText),
    },
  };
}
