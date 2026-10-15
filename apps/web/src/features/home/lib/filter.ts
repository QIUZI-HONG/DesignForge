/**
 * 首页列表筛选 / 搜索 / 排序（FE-02）。
 *
 * 纯函数（无 React、无 DOM）：首页的数据视图逻辑集中在这里，组件只做编排；
 * 时间窗口判定注入 `now`，测试与页面取同一口径（避免「测试绿但页面上是另一回事」）。
 */
import type { DocumentSummary } from '@dforge/contracts';

/** 时间范围筛选（B4 筛选行）。 */
export type DocumentRange = 'all' | 'today' | 'week' | 'month';

/** 排序方式（B4 排序下拉）。 */
export type DocumentSort = 'updated-desc' | 'created-desc' | 'name-asc';

/** 列表视图可见项的条件。 */
export interface DocumentQuery {
  /** 搜索词（大小写不敏感、去首尾空白；空串 = 不过滤）。 */
  query: string;
  /** 时间范围（按 updatedAt 判定）。 */
  range: DocumentRange;
  /** 当前时间（时间窗口基准）。 */
  now: Date;
}

/** 搜索词归一：去首尾空白 + 折叠内部空白 + 转小写。 */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 名称是否命中搜索词（子串匹配，大小写不敏感）。 */
export function matchesQuery(name: string, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (normalized === '') return true;
  return name.toLowerCase().includes(normalized);
}

const RANGE_DAYS: Record<Exclude<DocumentRange, 'all'>, number> = {
  today: 1,
  week: 7,
  month: 30,
};

/** 文档是否落在时间范围内（按 updatedAt；解析失败一律视为不在范围内）。 */
export function matchesRange(document: DocumentSummary, range: DocumentRange, now: Date): boolean {
  if (range === 'all') return true;
  const updated = new Date(document.updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated < RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
}

/** 按条件过滤文档列表（搜索 + 时间范围；顺序保持入参顺序）。 */
export function filterDocuments(
  documents: DocumentSummary[],
  query: DocumentQuery,
): DocumentSummary[] {
  return documents.filter(
    (document) =>
      matchesQuery(document.name, query.query) &&
      matchesRange(document, query.range, query.now),
  );
}

/** 排序：返回新数组，不改入参（时间列解析失败的项排到末尾，避免抖动）。 */
export function sortDocuments(
  documents: DocumentSummary[],
  sort: DocumentSort,
): DocumentSummary[] {
  const sorted = [...documents];
  const timeOf = (iso: string): number => {
    const value = new Date(iso).getTime();
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
  };
  switch (sort) {
    case 'updated-desc':
      sorted.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
      break;
    case 'created-desc':
      sorted.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      break;
  }
  return sorted;
}

/** 组合：搜索 → 排序（首页列表的唯一入口）。 */
export function selectDocumentList(
  documents: DocumentSummary[],
  query: DocumentQuery,
  sort: DocumentSort,
): DocumentSummary[] {
  return sortDocuments(filterDocuments(documents, query), sort);
}
