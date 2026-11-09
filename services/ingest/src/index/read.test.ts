/**
 * ADS 产物读入面测试（arch-v1 · 票② · #3）。
 *
 * 接缝：`@dforge/ingest/ads` 的 `readSearchIndex(text)` 与 `readAdsArtifacts(dir)`——
 * 判别式返回，坏产物给可读 reason，**不抛异常**（daemon 把失败映射为空态 + warning，
 * CLI 自行决定 exit 1 / exit 2）。
 *
 * 口径证据：
 * - 检索索引的宽容度与 daemon 原深解析一致（坏 posting 项按条丢弃、坏 doc 判整份不可用）；
 * - 市场索引走生产侧严格校验（与 CLI deploy 写前校验同口径）。
 */

import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type DwsAssetRecord, readDwsSample } from './dws.ts';
import {
  ADS_INDEX_FILENAME,
  ADS_SEARCH_INDEX_FILENAME,
  buildAdsArtifacts,
  writeAdsArtifacts,
} from './pipeline.ts';
import { readAdsArtifacts, readSearchIndex } from './read.ts';
import { buildSearchIndex, SEARCH_INDEX_SCHEMA } from './search.ts';

const OPTIONS = {
  generatedAt: '2026-10-15T23:00:00Z',
  collector: {
    name: 'df-market',
    version: '0.1.0',
    runId: '20261015-2300',
    odsWatermark: '2026-10-15T22:40:00Z',
  },
};

function readFixture(): DwsAssetRecord[] {
  const raw = readFileSync(
    new URL('./__fixtures__/dws-assets.sample.json', import.meta.url),
    'utf8',
  );
  return readDwsSample(JSON.parse(raw)).assets;
}

function buildSearchArtifact(): Record<string, unknown> {
  const index = buildAdsArtifacts(readFixture(), OPTIONS).searchIndex;
  return JSON.parse(JSON.stringify(index)) as Record<string, unknown>;
}

async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'df-ads-read-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('readSearchIndex（检索索引读入）', () => {
  it('合法产物 → ok:true，归一化后与构建结果一致（字段口径不漂移）', () => {
    const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
    const text = JSON.stringify(artifacts.searchIndex);
    const result = readSearchIndex(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(artifacts.searchIndex);
    expect(result.value.schema).toBe(SEARCH_INDEX_SCHEMA);
    expect(result.value.docCount).toBe(16);
    expect(Object.keys(result.value.postings).length).toBeGreaterThan(0);
  });

  it('非 JSON 文本 → ok:false 且 reason 可读（不抛异常）', () => {
    const result = readSearchIndex('{ 不是 JSON');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('JSON');
  });

  it('根不是对象（数组/标量）→ ok:false', () => {
    for (const text of ['[]', 'null', '"text"']) {
      const result = readSearchIndex(text);
      expect(result.ok, text).toBe(false);
    }
  });

  it('schema 不匹配 → ok:false 且点名期望 schema', () => {
    const artifact = buildSearchArtifact();
    artifact.schema = 'df.marketplace.search-index/v2';
    const result = readSearchIndex(JSON.stringify(artifact));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(SEARCH_INDEX_SCHEMA);
  });

  it('docs/postings 关键结构缺失或类型不符 → ok:false', () => {
    const noDocs = { ...buildSearchArtifact(), docs: 'nope' };
    const noPostings = { ...buildSearchArtifact(), postings: [] };
    for (const artifact of [noDocs, noPostings]) {
      const result = readSearchIndex(JSON.stringify(artifact));
      expect(result.ok).toBe(false);
    }
  });

  it('单条 doc 形状坏 → 整份判不可用（与 daemon 原口径一致）', () => {
    const artifact = buildSearchArtifact();
    const docs = artifact.docs as unknown[];
    docs[1] = { id: '', length: 1, quality: 0.5 };
    const result = readSearchIndex(JSON.stringify(artifact));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('docs[1]');
  });

  it('单条 posting 坏 → 只丢该条（宽容，与 daemon 原口径一致）', () => {
    const artifact = buildSearchArtifact();
    const postings = artifact.postings as Record<string, unknown>;
    postings.broken = [
      ['not-a-number', 1],
      [0, 'nope'],
    ];
    postings.mixed = [
      [0, 2],
      [1, 3],
      ['bad', 4],
    ];
    const result = readSearchIndex(JSON.stringify(artifact));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.postings.broken).toBeUndefined();
    expect(result.value.postings.mixed).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('可选数值字段缺失 → 用安全回退（docCount=docs.length / termTableVersion=0 等）', () => {
    const artifact = buildSearchArtifact();
    delete artifact.docCount;
    delete artifact.avgDocLength;
    delete artifact.termTableVersion;
    delete artifact.fieldWeights;
    artifact.algorithm = { name: 'legacy' };
    const result = readSearchIndex(JSON.stringify(artifact));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const docs = artifact.docs as unknown[];
    expect(result.value.docCount).toBe(docs.length);
    expect(result.value.avgDocLength).toBe(0);
    expect(result.value.termTableVersion).toBe(0);
    expect(result.value.fieldWeights).toEqual({});
    expect(result.value.algorithm).toEqual({ name: 'bm25', k1: 1.2, b: 0.75 });
  });
});

describe('readAdsArtifacts（ADS 产物集读入）', () => {
  it('合法产物集 → ok:true；市场索引严格校验通过、检索索引回读可用', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.index.schema).toBe('df.marketplace.index/v1');
      expect(result.index.counts.total).toBe(16);
      expect(result.searchIndex?.schema).toBe(SEARCH_INDEX_SCHEMA);
      expect(result.searchIndex?.docCount).toBe(16);
    });
  });

  it('市场索引文件缺失 → ok:false，reason 点名文件名', async () => {
    await withTempDir(async (dir) => {
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain(ADS_INDEX_FILENAME);
    });
  });

  it('市场索引不是合法 JSON → ok:false', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, ADS_INDEX_FILENAME), '{ 不是 JSON', 'utf8');
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('JSON');
    });
  });

  it('市场索引未通过 schema 校验 → ok:false 且带问题路径（生产侧严格档）', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      const broken = {
        ...artifacts.index,
        counts: { ...artifacts.index.counts, total: 99 },
      };
      await writeFile(join(dir, ADS_INDEX_FILENAME), JSON.stringify(broken), 'utf8');
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('counts');
    });
  });

  it('检索索引缺失 → ok:true 且 searchIndex=null（可选产物）', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      await rm(join(dir, ADS_SEARCH_INDEX_FILENAME));
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.searchIndex).toBeNull();
    });
  });

  it('检索索引存在但损坏 → ok:false（不把坏产物当空）', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      await writeFile(join(dir, ADS_SEARCH_INDEX_FILENAME), '{ 不是 JSON', 'utf8');
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('检索索引');
    });
  });

  it('检索索引 schema 不匹配 → ok:false', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      const search = JSON.parse(
        readFileSync(join(dir, ADS_SEARCH_INDEX_FILENAME), 'utf8'),
      ) as Record<string, unknown>;
      await writeFile(
        join(dir, ADS_SEARCH_INDEX_FILENAME),
        JSON.stringify({ ...search, schema: 'df.marketplace.search-index/v2' }),
        'utf8',
      );
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
    });
  });

  // 以下四块为票 A · A4（D-19 #2）：产物读入面的 realpath 限定 + 单文件大小上限。
  /** 逃逸目标（产物目录之外的临时区；与 dir 平级另建，测试内自行回收）。 */
  async function withOutsideZone<T>(
    body: (dir: string, outside: string) => Promise<T>,
  ): Promise<T> {
    return withTempDir(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), 'df-ads-escape-'));
      try {
        return await body(dir, outside);
      } finally {
        await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    });
  }

  it('市场索引是软链且指向产物目录之外 → ok:false（读入面不读穿逃逸路径）', async () => {
    await withOutsideZone(async (dir, outside) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      // 逃逸目标放的是**同一份合法索引**：证明拒的是「位置逃逸」不是内容损坏
      await writeFile(join(outside, 'leak-index.json'), JSON.stringify(artifacts.index), 'utf8');
      await rm(join(dir, ADS_INDEX_FILENAME));
      await symlink(join(outside, 'leak-index.json'), join(dir, ADS_INDEX_FILENAME));
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('产物目录之外');
    });
  });

  it('检索索引软链逃逸到产物目录之外 → ok:false（存在但不安全 ≠ 缺失，不静默当空）', async () => {
    await withOutsideZone(async (dir, outside) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      // 逃逸目标放同一份合法检索索引：红形态下读穿会得 ok:true（漏洞），修复后按位置逃逸拒
      await writeFile(
        join(outside, 'leak-search.json'),
        JSON.stringify(artifacts.searchIndex),
        'utf8',
      );
      await rm(join(dir, ADS_SEARCH_INDEX_FILENAME));
      await symlink(join(outside, 'leak-search.json'), join(dir, ADS_SEARCH_INDEX_FILENAME));
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('产物目录之外');
    });
  });

  it('市场索引超单文件大小上限（16MB）→ ok:false 且 reason 点名上限（先于 JSON 解析判）', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, ADS_INDEX_FILENAME), 'x'.repeat(16 * 1024 * 1024 + 1), 'utf8');
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('大小上限');
    });
  });

  it('产物目录内的软链（指向 dir 内文件）仍可用：约束是「不逃逸 dir」不是「禁软链」', async () => {
    await withTempDir(async (dir) => {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      await writeAdsArtifacts(dir, artifacts);
      // dir 内副本 + dir 内软链：realpath 解析后仍在 dir 内 → 放行
      await copyFile(join(dir, ADS_INDEX_FILENAME), join(dir, 'index-copy.json'));
      await rm(join(dir, ADS_INDEX_FILENAME));
      await symlink(join(dir, 'index-copy.json'), join(dir, ADS_INDEX_FILENAME));
      const result = await readAdsArtifacts(dir);
      expect(result.ok).toBe(true);
    });
  });
});

describe('搜索资产便捷面（ingest 侧保留面）', () => {
  it('标签筛选为「任一命中（OR）」——多 tag 不要求全部命中', async () => {
    const { searchAssets } = await import('./search.ts');
    const assets = buildAdsArtifacts(readFixture(), OPTIONS).index.assets;
    const response = searchAssets(assets, '', {
      // pdf 资产：tags ['pdf','导出','文档','交付']；单 tag 都不成立则空
      filters: { tags: ['不存在的标签', 'pdf'], loadableOnly: true },
    });
    expect(response.hits.length).toBeGreaterThan(0);
    expect(response.hits.some((hit) => hit.asset.facets.tags.includes('pdf'))).toBe(true);
  });

  it('同一个 tag 大小写不敏感（与 daemon 分面语义同族）', async () => {
    const { searchAssets } = await import('./search.ts');
    const assets = buildAdsArtifacts(readFixture(), OPTIONS).index.assets;
    const response = searchAssets(assets, '', { filters: { tags: ['PDF'] } });
    expect(response.hits.some((hit) => hit.asset.facets.tags.includes('pdf'))).toBe(true);
  });

  it('构造器仍可构建倒排产物（构建面未受读入面影响）', () => {
    const assets = buildAdsArtifacts(readFixture(), OPTIONS).index.assets.slice(0, 1);
    const index = buildSearchIndex(assets, { generatedAt: 'x' });
    expect(index.schema).toBe(SEARCH_INDEX_SCHEMA);
  });
});
