/**
 * @dforge/daemon · 市场检索索引（BM25 倒排，ADS 产物）的装载。
 *
 * 口径（修复批次 4 · E1；《技能市场规格 v1》§6.2 D3）：
 * - 产物 = `market_search_index.v1.json`（MK-04 产出），与市场索引**同族落盘**：
 *   市场索引在 `<数据根>/market/` 或 `<数据根>/market/ads/`，检索索引随其**同目录**探测；
 * - 切词（中文重叠二元组）与术语等价类扩展（「幻灯片 / PPT / deck」互查）**不在 daemon 重抄
 *   第二份**：直接消费 `@dforge/ingest/ads` 的 `searchMarketIndex`——与 CLI `df market search`
 *   同一条代码路径，中文词项命中口径天然一致（第二份实现必然漂移，即层间词表债）；
 * - **解析/校验同源收口**（arch-v1 · 票② · #3）：不再维护本模块的深解析，改用
 *   `@dforge/ingest/ads` 的 `readSearchIndex`（与 CLI 读入面同一实现、同一宽容度）；
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
  readSearchIndex,
  SEARCH_INDEX_SCHEMA,
  type SearchIndex,
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
  const result = readSearchIndex(raw);
  if (!result.ok) {
    return {
      index: null,
      warning: {
        code: 'search-index-invalid',
        message: `BM25 检索索引不可用（期望 ${SEARCH_INDEX_SCHEMA}；${result.reason}）：当前按字面匹配（可重跑 df market index 重建）`,
      },
    };
  }
  return { index: result.value, warning: null };
}
