/**
 * 候选发现（规格 §3.1/§3.3/§3.5）。
 *
 * 纪律：**topic 只作候选发现，不作资产认定**（研究 #4 §0.1：`design-system` 池首条是
 * 后端架构书、`figma-plugin` 池首条是设计系统）——本模块只负责把候选仓收窄，
 * 认定一律交给探针 + 内容校验（identify.ts）。
 *
 * 机制：
 *  - 8 个 topic × `sort=stars|updated` 双版本合并去重（规格《市场首实现》§2.1）；
 *  - 默认排除 fork（搜索 API 默认行为，显式写进查询）；
 *  - `since` 水位进查询（增量巡检，规格 §3.3：水位 = 上次运行开始 − 5 分钟，由调用方算）；
 *  - 翻页**只按 Link header 的 next URL**（§3.5：禁手拼 page、禁预测 URL 结构）；
 *  - 清单仓（awesome-* / curated list）单列 `isList`（规格 §2.1.4：kind=list 不入索引）。
 */

import type { Candidate, CandidateSource } from './types.ts';

export type { Candidate, CandidateSource };

/** 8 个 topic 查询集（issue #30 原样；研究 #4 §1 实测供给量）。 */
export const DEFAULT_TOPICS = [
  'agent-skill',
  'claude-skill',
  'ai-skill',
  'claude-plugin',
  'mcp-server',
  'design-system',
  'design-tokens',
  'html-template',
] as const;

export type CandidateSort = 'stars' | 'updated';

/** 构造首请求 URL（唯一允许构造查询串的地方；首请求不含 page）。 */
export function buildSearchUrl(opts: {
  query: string;
  sort: CandidateSort;
  perPage: number;
}): string {
  const params = new URLSearchParams({
    q: opts.query,
    sort: opts.sort,
    order: 'desc',
    per_page: String(opts.perPage),
  });
  return `https://api.github.com/search/repositories?${params.toString()}`;
}

/** 组装 topic 查询（保序：topic → fork:false → pushed:>=水位）。 */
export function buildTopicQuery(topic: string, since?: string | null): string {
  const parts = [`topic:${topic}`, 'fork:false'];
  if (since) parts.push(`pushed:>=${since}`);
  return parts.join(' ');
}

/**
 * 清单仓判定（规格 §2.1.4）：`awesome-*` 命名，或描述自述 curated/awesome list。
 * 清单仓单列 kind=list，不入索引、不参与评分（可作发现源）。
 */
export function isListRepo(input: { name: string; description: string | null }): boolean {
  if (/^awesome([-_.]|$)/i.test(input.name)) return true;
  const description = input.description ?? '';
  return /(awesome|curated)\s+(list|collection|resources)/i.test(description);
}

/** 从搜索响应解析候选（repo id 为收口键，研究 #4 §6.1：同一仓会被多 topic 召回）。 */
export function parseSearchResponse(json: unknown): { items: Candidate[]; totalCount: number } {
  const record = (json ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items: Candidate[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const fullName = typeof item.full_name === 'string' ? item.full_name : null;
    const repoId = typeof item.id === 'number' ? item.id : null;
    if (fullName === null || repoId === null) continue;
    const [owner = '', name = ''] = fullName.split('/');
    const license = item.license;
    const licenseSpdx =
      license !== null &&
      typeof license === 'object' &&
      typeof (license as Record<string, unknown>).spdx_id === 'string'
        ? ((license as Record<string, unknown>).spdx_id as string)
        : null;
    const description = typeof item.description === 'string' ? item.description : null;
    items.push({
      repoId,
      fullName,
      owner,
      name,
      description,
      stars: typeof item.stargazers_count === 'number' ? item.stargazers_count : 0,
      pushedAt: typeof item.pushed_at === 'string' ? item.pushed_at : '',
      defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : 'main',
      archived: item.archived === true,
      fork: item.fork === true,
      sizeKb: typeof item.size === 'number' ? item.size : 0,
      homepage: typeof item.homepage === 'string' ? item.homepage : null,
      topics: Array.isArray(item.topics)
        ? item.topics.filter((t): t is string => typeof t === 'string')
        : [],
      licenseSpdx,
      discoveredBy: [],
      isList: isListRepo({ name, description }),
    });
  }
  const totalCount = typeof record.total_count === 'number' ? record.total_count : items.length;
  return { items, totalCount };
}

export interface DiscoveryOptions {
  topics: string[];
  sorts: CandidateSort[];
  /** 每 topic 取的条目上限（页内截断；配合 maxPagesPerQuery）。 */
  perTopic: number;
  since?: string | null;
  /** 每查询最多翻几页（默认 1；深翻页不做，规格 §3.5 禁止 → 用时间窗切片替代）。 */
  maxPagesPerQuery?: number;
}

export interface DiscoveryResult {
  /** 非清单仓候选（进结构探针）。 */
  candidates: Candidate[];
  /** 清单仓（kind=list 单列，不入索引）。 */
  listRepos: Candidate[];
  /** 每次查询的账目（进证据 JSON；排名漂移可复核）。 */
  queries: {
    topic: string;
    sort: CandidateSort;
    pages: number;
    items: number;
    totalCount: number;
  }[];
}

/** 候选发现主流程（并发度 1：逐查询串行，Link 翻页串行）。 */
export async function discoverCandidates(
  deps: CandidateSource,
  opts: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const maxPages = opts.maxPagesPerQuery ?? 1;
  const merged = new Map<number, Candidate>();
  const queries: DiscoveryResult['queries'] = [];

  for (const topic of opts.topics) {
    for (const sort of opts.sorts) {
      const first = buildSearchUrl({
        query: buildTopicQuery(topic, opts.since ?? null),
        sort,
        perPage: opts.perTopic,
      });
      let url: string | null = first;
      let page = 0;
      let took = 0;
      let totalCount = 0;

      while (url !== null && page < maxPages) {
        page += 1;
        const response = await deps.searchByUrl(url);
        const parsed = parseSearchResponse(response.json);
        totalCount = parsed.totalCount;
        for (const item of parsed.items) {
          if (took >= opts.perTopic) break;
          took += 1;
          const existing = merged.get(item.repoId);
          if (existing) {
            if (!existing.discoveredBy.some((d) => d.topic === topic && d.sort === sort)) {
              existing.discoveredBy.push({ topic, sort });
            }
          } else {
            merged.set(item.repoId, {
              ...item,
              discoveredBy: [{ topic, sort }],
            });
          }
        }
        // 翻页只按 Link 走（规格 §3.5）。
        url = took < opts.perTopic ? response.linkNext : null;
      }
      queries.push({ topic, sort, pages: page, items: took, totalCount });
    }
  }

  const all = [...merged.values()];
  // 稳定序：先按发现顺序（Map 保序）分组，再各自按 stars 降序（可复现）。
  const candidates = all.filter((c) => !c.isList);
  const listRepos = all.filter((c) => c.isList);
  return { candidates, listRepos, queries };
}
