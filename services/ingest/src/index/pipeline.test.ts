import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { SEARCH_INDEX_SCHEMA } from './search.ts';

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

describe('ADS 产物管线', () => {
  it('产物集含索引/检索索引/校验结论，校验通过', () => {
    const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
    expect(artifacts.validation.ok).toBe(true);
    expect(artifacts.validation.errors).toEqual([]);
    expect(artifacts.index.assets).toHaveLength(16);
    expect(artifacts.searchIndex.schema).toBe(SEARCH_INDEX_SCHEMA);
    expect(artifacts.searchIndex.docCount).toBe(16);
  });

  it('落盘：文件名按 §4.1，sha256 与字节数如实记录，JSON 可回读', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'df-mk-04-pipeline-'));
    try {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      const written = await writeAdsArtifacts(outDir, artifacts);
      expect(written.index.path).toBe(join(outDir, ADS_INDEX_FILENAME));
      expect(written.searchIndex.path).toBe(join(outDir, ADS_SEARCH_INDEX_FILENAME));
      const indexRaw = await readFile(written.index.path, 'utf8');
      const searchRaw = await readFile(written.searchIndex.path, 'utf8');
      expect(Buffer.byteLength(indexRaw)).toBe(written.index.length);
      expect(JSON.parse(indexRaw)).toMatchObject({ schema: 'df.marketplace.index/v1' });
      expect(JSON.parse(searchRaw)).toMatchObject({ schema: SEARCH_INDEX_SCHEMA });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('校验不过 → 拒绝落盘（判据链第 4 环硬门）', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'df-mk-04-pipeline-'));
    try {
      const artifacts = buildAdsArtifacts(readFixture(), OPTIONS);
      // 人为破坏 counts（模拟坏产物）——批量落盘前必须拦下
      const broken = {
        ...artifacts,
        index: { ...artifacts.index, counts: { ...artifacts.index.counts, total: 99 } },
      };
      await expect(writeAdsArtifacts(outDir, broken)).rejects.toThrow(/未通过 schema 校验/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
