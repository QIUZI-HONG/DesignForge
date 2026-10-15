/**
 * 首页列表筛选/搜索/排序测试（FE-02）。
 *
 * 断言口径：对外行为（搜索命中、时间窗口、排序结果与顺序），
 * 期望列表来自手工构造的独立事实（名称/时间），不复算实现。
 */
import type { DocumentSummary } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import {
  filterDocuments,
  matchesQuery,
  normalizeQuery,
  selectDocumentList,
  sortDocuments,
} from './filter';

const NOW = new Date('2026-10-15T12:00:00.000Z');

/** 造一个文档摘要（只填本模块关心的字段）。 */
function doc(id: string, name: string, updatedAt: string, createdAt = updatedAt): DocumentSummary {
  return {
    id,
    name,
    directory: `/tmp/${id}.dfg`,
    createdAt,
    updatedAt,
    pageCount: 1,
    sizeBytes: 1024,
  };
}

const DOCS: DocumentSummary[] = [
  doc('c', '海报 A', '2026-10-15T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
  doc('a', 'Landing Page', '2026-09-20T09:00:00.000Z', '2026-09-19T09:00:00.000Z'),
  doc('b', '海报 B', '2026-10-10T09:00:00.000Z', '2026-10-10T08:00:00.000Z'),
];

describe('normalizeQuery / matchesQuery', () => {
  it('归一：去首尾空白、折叠内部空白、转小写', () => {
    expect(normalizeQuery('  Landing   Page ')).toBe('landing page');
  });

  it('空串命中一切', () => {
    expect(matchesQuery('任意名字', '   ')).toBe(true);
  });

  it('命中不区分大小写', () => {
    expect(matchesQuery('Landing Page', 'landing')).toBe(true);
    expect(matchesQuery('Landing Page', 'PAGE')).toBe(true);
  });

  it('中文子串命中，未命中返回 false', () => {
    expect(matchesQuery('海报 A', '海报')).toBe(true);
    expect(matchesQuery('海报 A', '落地页')).toBe(false);
  });
});

describe('filterDocuments（时间范围）', () => {
  const base = { query: '', now: NOW } as const;

  it('today：只保留今天（24h 内）更新过的', () => {
    const result = filterDocuments(DOCS, { ...base, range: 'today' });
    expect(result.map((item) => item.id)).toEqual(['c']);
  });

  it('week：保留 7 天内更新过的', () => {
    const result = filterDocuments(DOCS, { ...base, range: 'week' });
    expect(result.map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('month：保留 30 天内更新过的', () => {
    const result = filterDocuments(DOCS, { ...base, range: 'month' });
    expect(result.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('all：全量（顺序保持入参）', () => {
    const result = filterDocuments(DOCS, { ...base, range: 'all' });
    expect(result.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('sortDocuments', () => {
  it('最近更新优先（降序）', () => {
    expect(sortDocuments(DOCS, 'updated-desc').map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('创建时间降序', () => {
    expect(sortDocuments(DOCS, 'created-desc').map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('名称升序（zh-CN 排序：汉字在拉丁字母前）', () => {
    expect(sortDocuments(DOCS, 'name-asc').map((item) => item.name)).toEqual([
      '海报 A',
      '海报 B',
      'Landing Page',
    ]);
  });

  it('不改入参（返回新数组）', () => {
    const input = [...DOCS];
    sortDocuments(input, 'name-asc');
    expect(input.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('selectDocumentList（组合）', () => {
  it('先按搜索词与范围过滤，再排序', () => {
    const result = selectDocumentList(DOCS, { query: '海报', range: 'all', now: NOW }, 'name-asc');
    expect(result.map((item) => item.name)).toEqual(['海报 A', '海报 B']);
  });

  it('搜索无命中 → 空数组', () => {
    const result = selectDocumentList(
      DOCS,
      { query: '不存在', range: 'all', now: NOW },
      'name-asc',
    );
    expect(result).toEqual([]);
  });

  it('updatedAt 非法的项排到末尾（不抛错、不抖动）', () => {
    const broken = doc('z', '坏时间', '不是时间');
    const result = sortDocuments([broken, ...DOCS], 'updated-desc');
    expect(result.at(-1)?.id).toBe('z');
  });
});
