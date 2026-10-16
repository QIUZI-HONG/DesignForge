/**
 * @dforge/daemon · 市场检索索引（BM25 倒排，ADS 产物）的装载与校验。
 *
 * 口径（修复批次 4 · E1；《技能市场规格 v1》§6.2 D3）：
 * - 产物 = `market_search_index.v1.json`（MK-04 产出），与市场索引**同族落盘**：
 *   市场索引在 `<数据根>/market/` 或 `<数据根>/market/ads/`，检索索引随其**同目录**探测；
 * - 切词（中文重叠二元组）与术语等价类扩展（「幻灯片 / PPT / deck」互查）**不在 daemon 重抄
 *   第二份**：直接消费 `@dforge/ingest/ads` 的 `searchMarketIndex`——与 CLI `df market search`
 *   同一条代码路径，中文词项命中口径天然一致（第二份实现必然漂移，即层间词表债）；
 * - 打分参数 k1/b 与归一相关度口径以 ingest 模块常量为准（CLI 同款；产物里的
 *   `algorithm`/`fieldWeights` 是审计快照，打分不二次推断）；
 * - 缺失 → `search-index-missing`；损坏（JSON 不可解析 / schema 不符 / 关键结构缺失）→
 *   `search-index-invalid`——两者都由服务层降级为**字面过滤**并随响应给 warning（不抛错、不 500）。
 *
 * 依赖说明（apps → services 的跨层引用已在修复批次 4 汇报中登记）：守卫预留口径
 * `apps → services/tools → packages` 允许该方向；经 package.json 的 `./ads` 子路径导出引入，
 * 运行时只装载 ADS 层（index/terms/search/schema/pipeline），**不**把采集、Parquet 依赖带进 daemon。
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { MarketQueryWarning } from '@dforge/contracts';
import {
  ADS_SEARCH_INDEX_FILENAME,
  BM25_B,
  BM25_K1,
  SEARCH_INDEX_SCHEMA,
  type SearchIndex,
  type SearchIndexDoc,
} from '@dforge/ingest/ads';

/** 装载结果：可用索引或降级原因（二者互斥；正常态两者皆空）。 */
export interface SearchIndexState {
  index: SearchIndex | null;
  warning: MarketQueryWarning | null;
}

/** 与市场索引同族的检索索引路径（同目录 + ADS 约定文件名）。 */
export function siblingSearchIndexPath(marketIndexPath: string): string {
  return join(dirname(marketIndexPath), ADS_SEARCH_INDEX_FILENAME);
}

/** 数字记录（fieldWeights 的宽容读取；非数值项忽略）。 */
function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'number' && Number.isFinite(item)) record[key] = item;
  }
  return record;
}

/**
 * 宽容解析检索索引（消费方契约：未知字段忽略、坏条目跳过，关键结构缺失才判损坏）。
 * - `schema` 不匹配 → null（调用方按「检索索引损坏」降级）；
 * - `docs`/`postings` 非相应结构 → null；
 * - 单条 posting 坏 → 只丢该条（不拖垮整批，与卡片解析同族）。
 */
export function parseSearchIndex(value: unknown): SearchIndex | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schema !== SEARCH_INDEX_SCHEMA) return null;
  const rawDocs = record.docs;
  if (!Array.isArray(rawDocs)) return null;
  const rawPostings = record.postings;
  if (typeof rawPostings !== 'object' || rawPostings === null || Array.isArray(rawPostings)) {
    return null;
  }

  const docs: SearchIndexDoc[] = [];
  for (const raw of rawDocs) {
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.length === 0) return null;
    if (typeof item.length !== 'number' || !Number.isFinite(item.length)) return null;
    if (typeof item.quality !== 'number' || !Number.isFinite(item.quality)) return null;
    docs.push({ id: item.id, length: item.length, quality: item.quality });
  }

  const postings: Record<string, [number, number][]> = {};
  for (const [term, rawList] of Object.entries(rawPostings as Record<string, unknown>)) {
    if (!Array.isArray(rawList)) continue;
    const pairs: [number, number][] = [];
    for (const rawPair of rawList) {
      if (!Array.isArray(rawPair) || rawPair.length !== 2) continue;
      const [docIndex, tf] = rawPair as [unknown, unknown];
      if (typeof docIndex !== 'number' || !Number.isFinite(docIndex)) continue;
      if (typeof tf !== 'number' || !Number.isFinite(tf)) continue;
      pairs.push([docIndex, tf]);
    }
    if (pairs.length > 0) postings[term] = pairs;
  }

  return {
    schema: SEARCH_INDEX_SCHEMA,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
    // 打分实参取模块常量（与 CLI 同口径）；产物里的 algorithm 是审计快照，不二次推断
    algorithm: { name: 'bm25', k1: BM25_K1, b: BM25_B },
    fieldWeights: numberRecord(record.fieldWeights),
    termTableVersion:
      typeof record.termTableVersion === 'number' && Number.isFinite(record.termTableVersion)
        ? record.termTableVersion
        : 0,
    docCount:
      typeof record.docCount === 'number' && Number.isFinite(record.docCount)
        ? record.docCount
        : docs.length,
    avgDocLength:
      typeof record.avgDocLength === 'number' && Number.isFinite(record.avgDocLength)
        ? record.avgDocLength
        : 0,
    docs,
    postings,
  };
}

/** 读取并校验检索索引：缺失/损坏 → 返回稳定 warning 码，由服务层降级。 */
export async function loadSearchIndex(path: string): Promise<SearchIndexState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {
      index: null,
      warning: {
        code: 'search-index-missing',
        message:
          '未找到 BM25 检索索引（market_search_index.v1.json）：当前按字面匹配，中文查询可能漏命中',
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      index: null,
      warning: {
        code: 'search-index-invalid',
        message: 'BM25 检索索引 JSON 解析失败：当前按字面匹配（可重跑 df market index 重建）',
      },
    };
  }
  const index = parseSearchIndex(parsed);
  if (index === null) {
    return {
      index: null,
      warning: {
        code: 'search-index-invalid',
        message: `BM25 检索索引不兼容（期望 ${SEARCH_INDEX_SCHEMA}）：当前按字面匹配（可重跑 df market index 重建）`,
      },
    };
  }
  return { index, warning: null };
}
