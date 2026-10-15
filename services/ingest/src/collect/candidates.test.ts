/**
 * 候选发现测试（规格 §3.1/§3.3/§3.5：topic 只作候选，不作资产认定）。
 *
 * 断言：查询构造（8 topic 集 + 水位）、双排序合并去重（repo id 为键）、
 * 清单仓单列（awesome-*）、分页只按 Link 走（禁手拼 page）。
 */

import { describe, expect, it } from 'vitest';

import {
  buildSearchUrl,
  DEFAULT_TOPICS,
  discoverCandidates,
  isListRepo,
  parseSearchResponse,
} from './candidates.ts';

const SEARCH_JSON = (items: unknown[], totalCount = items.length) => ({
  items,
  total_count: totalCount,
});

function searchItem(over: Partial<Record<string, unknown>> & { id: number; full_name: string }) {
  const [owner, name] = over.full_name.split('/');
  return {
    id: over.id,
    full_name: over.full_name,
    name,
    owner: { login: owner },
    description: over.description ?? 'desc',
    stargazers_count: over.stargazers_count ?? 100,
    pushed_at: over.pushed_at ?? '2026-10-01T00:00:00Z',
    default_branch: 'main',
    archived: false,
    fork: false,
    size: 1234,
    homepage: null,
    topics: over.topics ?? [],
    license: over.license ?? { spdx_id: 'MIT' },
  };
}

describe('DEFAULT_TOPICS 与查询构造（规格《市场首实现》§2.1：8 个 topic）', () => {
  it('8 个 topic 查询集齐备（issue #30 原样）', () => {
    expect(DEFAULT_TOPICS).toEqual([
      'agent-skill',
      'claude-skill',
      'ai-skill',
      'claude-plugin',
      'mcp-server',
      'design-system',
      'design-tokens',
      'html-template',
    ]);
  });

  it('查询含 topic、排除 fork、可带 since 水位；URL 编码正确', () => {
    const url = buildSearchUrl({
      query: 'topic:agent-skill fork:false pushed:>=2026-10-01T00:00:00Z',
      sort: 'stars',
      perPage: 20,
    });
    expect(url).toBe(
      'https://api.github.com/search/repositories?q=topic%3Aagent-skill+fork%3Afalse+pushed%3A%3E%3D2026-10-01T00%3A00%3A00Z&sort=stars&order=desc&per_page=20',
    );
    // 禁手拼 page 参数（规格 §3.5）：首请求不含 page（`per_page` 不是 page）。
    expect(/[?&]page=/.test(url)).toBe(false);
  });
});

describe('parseSearchResponse 与 isListRepo（规格 §2.1.4：清单仓单列）', () => {
  it('解析搜索条目为候选（repo id 为收口键）', () => {
    const parsed = parseSearchResponse(
      SEARCH_JSON([
        searchItem({ id: 42, full_name: 'anthropics/skills', topics: ['agent-skill'] }),
      ]),
    );
    expect(parsed.items[0]).toMatchObject({
      repoId: 42,
      fullName: 'anthropics/skills',
      owner: 'anthropics',
      name: 'skills',
      stars: 100,
      licenseSpdx: 'MIT',
      isList: false,
    });
    expect(parsed.totalCount).toBe(1);
  });

  it('awesome-* 与 curated list 描述 → isList 单列（研究 #4 §6.2 实测 7 条）', () => {
    expect(isListRepo({ name: 'awesome-design-md', description: 'x' })).toBe(true);
    expect(isListRepo({ name: 'Awesome-Design-Tokens', description: 'x' })).toBe(true);
    expect(isListRepo({ name: 'awesome', description: 'x' })).toBe(true);
    expect(
      isListRepo({ name: 'design-md', description: 'A curated list of design md files' }),
    ).toBe(true);
    expect(
      isListRepo({
        name: 'system-design-primer',
        description: 'Learn how to design large-scale systems',
      }),
    ).toBe(false);
    expect(isListRepo({ name: 'awesomeness', description: '普通仓' })).toBe(false);
  });
});

describe('discoverCandidates：双排序合并去重 + Link 分页（规格 §3.3/§3.5）', () => {
  it('同一仓被多 topic/多排序召回 → 按 repo id 合并，discoveredBy 留痕', async () => {
    const calls: string[] = [];
    const pages: Record<string, unknown> = {
      'agent-skill|stars': SEARCH_JSON([
        searchItem({ id: 1, full_name: 'a/skill-one', topics: ['agent-skill'] }),
      ]),
      'agent-skill|updated': SEARCH_JSON([
        searchItem({ id: 1, full_name: 'a/skill-one', topics: ['agent-skill'] }),
        searchItem({ id: 2, full_name: 'b/awesome-x', description: 'awesome list of skills' }),
      ]),
    };
    const deps = {
      searchByUrl: async (url: string) => {
        calls.push(url);
        const topic = /q=topic%3A([^&]+)/.exec(url)?.[1] ?? '';
        const sort = /sort=([^&]+)/.exec(url)?.[1] ?? '';
        const key = `${decodeURIComponent(topic).split('+')[0]?.replace('topic:', '')}|${sort}`;
        return { json: pages[key] ?? SEARCH_JSON([]), linkNext: null };
      },
    };

    const result = await discoverCandidates(deps, {
      topics: ['agent-skill'],
      sorts: ['stars', 'updated'],
      perTopic: 20,
    });

    expect(calls).toHaveLength(2); // 1 topic × 2 排序
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.discoveredBy).toEqual([
      { topic: 'agent-skill', sort: 'stars' },
      { topic: 'agent-skill', sort: 'updated' },
    ]);
    expect(result.listRepos.map((c) => c.fullName)).toEqual(['b/awesome-x']);
    expect(result.queries).toEqual([
      { topic: 'agent-skill', sort: 'stars', pages: 1, items: 1, totalCount: 1 },
      { topic: 'agent-skill', sort: 'updated', pages: 1, items: 2, totalCount: 2 },
    ]);
  });

  it('翻页只按 Link 的 next URL（不手拼 page）', async () => {
    const seen: string[] = [];
    const deps = {
      searchByUrl: async (url: string) => {
        seen.push(url);
        if (seen.length === 1) {
          return {
            json: SEARCH_JSON([searchItem({ id: 1, full_name: 'a/one' })]),
            linkNext:
              'https://api.github.com/search/repositories?q=topic%3Aagent-skill%20fork%3Afalse&sort=stars&per_page=20&page=2',
          };
        }
        return { json: SEARCH_JSON([searchItem({ id: 2, full_name: 'b/two' })]), linkNext: null };
      },
    };

    const result = await discoverCandidates(deps, {
      topics: ['agent-skill'],
      sorts: ['stars'],
      perTopic: 20,
      maxPagesPerQuery: 2,
    });

    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain('page=2'); // 来自 Link，而非手拼
    expect(result.candidates.map((c) => c.fullName)).toEqual(['a/one', 'b/two']);
  });

  it('永不手拼 page：首请求 URL 不含 page（规格 §3.5 官方文档明示）', async () => {
    const seen: string[] = [];
    const deps = {
      searchByUrl: async (url: string) => {
        seen.push(url);
        return { json: SEARCH_JSON([]), linkNext: null };
      },
    };
    await discoverCandidates(deps, { topics: ['design-tokens'], sorts: ['stars'], perTopic: 5 });
    expect(seen.every((u) => !/[?&]page=/.test(u))).toBe(true);
    expect(seen[0]).toContain('per_page=5');
  });

  it('返回量上限遵循 perTopic（取页内前 N 条）', async () => {
    const deps = {
      searchByUrl: async () =>
        ({
          json: SEARCH_JSON(
            Array.from({ length: 30 }, (_, i) =>
              searchItem({ id: i + 1, full_name: `o/r${i + 1}` }),
            ),
          ),
          linkNext: null,
        }) as const,
    };
    const result = await discoverCandidates(deps, {
      topics: ['agent-skill'],
      sorts: ['stars'],
      perTopic: 5,
    });
    expect(result.candidates).toHaveLength(5);
  });

  it('since 水位进入查询（增量游标，规格 §3.3）', async () => {
    const seen: string[] = [];
    const deps = {
      searchByUrl: async (url: string) => {
        seen.push(url);
        return { json: SEARCH_JSON([]), linkNext: null };
      },
    };
    await discoverCandidates(deps, {
      topics: ['agent-skill'],
      sorts: ['stars'],
      perTopic: 5,
      since: '2026-10-01T00:00:00Z',
    });
    expect(decodeURIComponent(seen[0] ?? '')).toContain('pushed:>=2026-10-01T00:00:00Z');
  });
});
