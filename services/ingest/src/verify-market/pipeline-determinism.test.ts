/**
 * 验证线 · 风险点 1：管线确定性与可复跑（对抗视角）。
 *
 * 覆盖：
 *  - 同输入两次 collect → ODS 记录/快照逐字节一致（raw_events 含墙钟耗时不参与）；
 *  - `--replay` 完全不触网（全局 fetch 被换成抛错桩，桩零调用）；
 *  - 重放样本缺 URL → 明确阻塞 exit 2（禁止静默伪造）；
 *  - ODS 规整 + DWD 构建两遍逐字节一致；删 dwd 从 ODS 重建 consistent=true；
 *  - DWS 评分两遍逐字节一致、与输入顺序无关；ADS 产物两遍一致。
 */

import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { resolveGitHubToken } from '../collect/client.ts';
import type { CollectOptions } from '../collect/run.ts';
import { runCollect } from '../collect/run.ts';
import type { DwsAssetRecord } from '../index/dws.ts';
import { buildAdsArtifacts } from '../index/pipeline.ts';
import { dwsJsonl, scoreBatch } from '../score/index.ts';
import type { DwdAsset } from '../score/types.ts';
import { buildDwd } from '../transform/dwd/build.ts';
import { readDwd } from '../transform/dwd/store.ts';
import { materializeOds } from '../transform/ods/materialize.ts';
import { rebuildDwd } from '../transform/rebuild.ts';
import {
  AS_OF_MS,
  cleanupTempDirs,
  oneRepoScript,
  RUN_ID,
  scriptedFetch,
  tempDir,
} from './helpers.ts';

afterAll(cleanupTempDirs);

const COLLECT_BASE: Omit<CollectOptions, 'outDir'> = {
  runId: RUN_ID,
  asOfMs: AS_OF_MS,
  seeds: ['acme/skills', 'acme/templates'],
  topics: [],
  sorts: ['stars'],
  perTopic: 5,
  maxPagesPerQuery: 1,
  limit: null,
  since: null,
  maxContentPerRepo: 8,
  replayDir: null,
  token: { token: 'verify-token', source: 'env' },
  maxAttempts: 1,
};

/** 收集目录树相对路径（文件）。 */
function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = base === '' ? name : `${base}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

function readAll(dir: string): Map<string, Buffer> {
  return new Map(walk(dir).map((rel) => [rel, readFileSync(join(dir, rel))]));
}

describe('确定性：collect 真网剧本两遍', () => {
  it('ODS 记录与快照逐字节一致（同输入同输出）', async () => {
    const outA = tempDir('verify-det-a');
    const outB = tempDir('verify-det-b');
    const a = await runCollect({
      ...COLLECT_BASE,
      seeds: ['acme/skills'],
      outDir: outA,
      fetchImpl: scriptedFetch(oneRepoScript()).fetchImpl,
    });
    const b = await runCollect({
      ...COLLECT_BASE,
      seeds: ['acme/skills'],
      outDir: outB,
      fetchImpl: scriptedFetch(oneRepoScript()).fetchImpl,
    });
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(a.records).toHaveLength(1);

    // 一仓一记录：逐字段（含 assets/digest/requestUrls/license）一致
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));

    // ODS 快照文件逐字节一致；raw_events 含墙钟（startedAtMs 等）不参与数据面比对
    const relSnapshot = `ods/raw_snapshots/date=2026-10-15/${RUN_ID}.jsonl`;
    expect(readFileSync(join(outA, relSnapshot))).toEqual(readFileSync(join(outB, relSnapshot)));

    // 证据断言全过 + 事件数一致
    expect(a.evidence.exitCode).toBe(0);
    expect(b.evidence.exitCode).toBe(0);
    expect(a.evidence.steps.map((s) => s.metrics.events)).toEqual(
      b.evidence.steps.map((s) => s.metrics.events),
    );
  }, 30_000);

  it('无凭据、无网络时不得伪造成交（库层阻塞语义）', async () => {
    const out = tempDir('verify-det-c');
    const res = await runCollect({
      ...COLLECT_BASE,
      outDir: out,
      token: { token: 'unused', source: 'env' },
      fetchImpl: async () => {
        throw new Error('网络被验证方禁用（不触网）');
      },
    });
    expect(res.exitCode).toBe(2);
    expect(res.records).toEqual([]);
    expect(res.blockedReason).toContain('网络不可用');
  });
  it('复现性边界：证据 JSON 的断言/指标一致；raw_events 摘要因墙钟不可复现（数据面摘要一致）', async () => {
    const a = await runCollect({
      ...COLLECT_BASE,
      seeds: ['acme/skills'],
      outDir: tempDir('verify-det-ev-a'),
      fetchImpl: scriptedFetch(oneRepoScript()).fetchImpl,
    });
    const b = await runCollect({
      ...COLLECT_BASE,
      seeds: ['acme/skills'],
      outDir: tempDir('verify-det-ev-b'),
      fetchImpl: scriptedFetch(oneRepoScript()).fetchImpl,
    });

    // 断言与指标（判据链判据）一致
    const assertionsOf = (x: typeof a) =>
      x.evidence.steps.map((s) => ({
        id: s.id,
        verdict: s.verdict,
        assertions: s.assertions,
        metrics: s.metrics,
      }));
    expect(JSON.stringify(assertionsOf(a))).toBe(JSON.stringify(assertionsOf(b)));

    // 产物摘要：raw_snapshots（数据面）一致；raw_events（含墙钟耗时）天然不同
    const shaOfSnapshots = (x: typeof a) =>
      x.artifacts.filter((p) => p.path.includes('raw_snapshots')).map((p) => p.sha256);
    const shaOfEvents = (x: typeof a) =>
      x.artifacts.filter((p) => p.path.includes('raw_events')).map((p) => p.sha256);
    expect(shaOfSnapshots(a)).toEqual(shaOfSnapshots(b));
    expect(new Set(shaOfEvents(a)).size).toBe(1);
    expect(new Set(shaOfEvents(b)).size).toBe(1);
    // 【已知边界】事件文件含墙钟（startedAtMs/endedAtMs/durationMs）→ 摘要跨运行不同
    expect(shaOfEvents(a)[0]).not.toBe(shaOfEvents(b)[0]);
  }, 30_000);
});

describe('可复跑：--replay 不触网', () => {
  const fixture = join(import.meta.dirname, '..', 'collect', '__fixtures__', 'replay-sample');

  it('重放全程零网络出口：全局 fetch 换成抛错桩后仍 exit 0 且桩零调用', async () => {
    const out = tempDir('verify-replay-net');
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('验证桩：重放不得触网');
    }) as typeof fetch;
    try {
      const res = await runCollect({
        ...COLLECT_BASE,
        outDir: out,
        seeds: [],
        topics: [],
        replayDir: fixture,
        token: null,
      });
      expect(res.exitCode).toBe(0);
      expect(res.blockedReason).toBeNull();
      expect(res.evidence.offline).toBe(true);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('重放复跑两遍：记录摘要逐字节一致（含 etag/digest）', async () => {
    const runOnce = async () => {
      const res = await runCollect({
        ...COLLECT_BASE,
        outDir: tempDir('verify-replay-det'),
        seeds: [],
        replayDir: fixture,
        token: null,
      });
      expect(res.exitCode).toBe(0);
      return res;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
    expect(a.artifacts.map((x) => x.sha256)).toEqual(b.artifacts.map((x) => x.sha256));
  });

  it('样本缺 URL → ReplayMissError 明确阻塞 exit 2（不静默补空）', async () => {
    // 沙箱：样本原样拷贝，manifest 换成「样本外仓」——请求必然落空（重放以 manifest 参数为准）
    const sandbox = tempDir('verify-replay-sandbox');
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8')) as {
      asOfMs: number;
      params: Record<string, unknown>;
    };
    copyFileSync(join(fixture, 'responses.jsonl'), join(sandbox, 'responses.jsonl'));
    writeFileSync(
      join(sandbox, 'manifest.json'),
      JSON.stringify({
        schema: 'df.market.replay/v1',
        runId: 'verify-miss-0001',
        asOfMs: manifest.asOfMs,
        params: { ...manifest.params, seeds: ['not/in-sample'] },
      }),
      'utf8',
    );
    const res = await runCollect({
      ...COLLECT_BASE,
      outDir: tempDir('verify-replay-miss'),
      seeds: [],
      replayDir: sandbox,
      token: null,
    });
    expect(res.exitCode).toBe(2);
    expect(res.records).toEqual([]);
    expect(res.blockedReason).toContain('离线样本缺失');
  });
});

describe('四层重建确定性（transform）', () => {
  const fixture = join(import.meta.dirname, '..', 'transform', '__fixtures__', 'ods-source');

  it('ODS 规整 + DWD 构建两遍 → 产物逐字节一致；删 dwd 重建 consistent', async () => {
    const dataA = tempDir('verify-data-a');
    const dataB = tempDir('verify-data-b');
    const odsA = join(dataA, 'ods');
    const odsB = join(dataB, 'ods');
    const ma = await materializeOds({ source: fixture, out: odsA });
    const mb = await materializeOds({ source: fixture, out: odsB });
    expect(ma.issues.filter((i) => i.rule !== 'snapshot-enriched')).toEqual([]);
    expect(mb.issues.filter((i) => i.rule !== 'snapshot-enriched')).toEqual([]);

    const filesA = readAll(odsA);
    const filesB = readAll(odsB);
    expect([...filesA.keys()]).toEqual([...filesB.keys()]);
    for (const [rel, bytes] of filesA) expect(bytes).toEqual(filesB.get(rel));

    const built = await buildDwd({ odsRoot: odsA, out: join(dataA, 'dwd') });
    const builtAgain = await buildDwd({ odsRoot: odsA, out: join(dataB, 'dwd') });
    expect(built.issues).toEqual([]);
    expect(builtAgain.issues).toEqual([]);
    for (const name of ['repo', 'asset', 'asset_file', 'license']) {
      expect(readFileSync(join(dataA, 'dwd', `${name}.parquet`))).toEqual(
        readFileSync(join(dataB, 'dwd', `${name}.parquet`)),
      );
    }
    expect(built.artifacts.map((a) => a.sha256)).toEqual(builtAgain.artifacts.map((a) => a.sha256));
    const tables = await readDwd(join(dataA, 'dwd'));
    expect(tables.repo.length).toBeGreaterThan(0);

    // 删 dwd 从 ODS 重建：四表字节哈希一致（重建前 = 已存在，重建后 = 重跑）
    const rebuilt = await rebuildDwd({ dataRoot: dataA });
    expect(rebuilt.differences).toEqual([]);
    expect(rebuilt.consistent).toBe(true);
  });
});

describe('评分与索引确定性', () => {
  function asset(id: string, stars: number, qualityOver: Partial<DwdAsset['repo']> = {}): DwdAsset {
    return {
      asset: {
        id,
        kind: 'skill',
        name: id.split('#')[1] ?? id,
        ref: 'a'.repeat(40),
        path: '',
        compliance: 'ok',
        capabilitiesDeclared: false,
        capabilities: [],
      },
      repo: {
        repoId: 1,
        fullName: 'acme/x',
        stars,
        forks: 3,
        pushedAt: '2026-10-01T00:00:00Z',
        createdAt: '2020-01-01T00:00:00Z',
        archived: false,
        fork: false,
        upstream: null,
        commits90d: 5,
        lastReleaseAt: null,
        ...qualityOver,
      },
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'a'.repeat(64) },
      },
      files: {
        truncated: false,
        entries: [{ path: 'SKILL.md', size: 100, sha256: 'b'.repeat(64) }],
      },
      text: {
        frontmatter: { name: 'x', description: 'y' },
        body: '正文',
        readme: 'README',
        manifest: null,
        packageJson: null,
        mcpJson: null,
        changelog: null,
      },
      trend: { stars90dAgo: 10, referencedBy: 1 },
    };
  }

  const asOf = '2026-10-15T00:00:00Z';
  const batch = [asset('gh:acme/x#1', 100), asset('gh:acme/x#2', 500), asset('gh:acme/x#3', 20)];

  it('DWS 两遍逐字节一致；输入顺序反转不影响逐条分值（分位无关序）', () => {
    const first = dwsJsonl(scoreBatch(batch, { asOf }).records);
    const second = dwsJsonl(scoreBatch(batch, { asOf }).records);
    expect(first).toBe(second);

    const reversed = scoreBatch([...batch].reverse(), { asOf });
    const byId = new Map(reversed.records.map((r) => [r.assetId, r]));
    for (const record of scoreBatch(batch, { asOf }).records) {
      const mirror = byId.get(record.assetId);
      expect(mirror?.score).toBe(record.score);
      expect(mirror?.dims).toEqual(record.dims);
    }
  });

  it('ADS 产物两遍一致（index + 检索索引 JSON 逐字节）', () => {
    const record = (id: string, gate: 'loadable' | 'view-only'): DwsAssetRecord => ({
      id,
      kind: 'skill',
      name: id.split('#')[1] ?? 'x',
      displayName: { 'zh-CN': '名称', en: 'name' },
      summary: { 'zh-CN': '简介', en: 'summary' },
      source: {
        repo: 'acme/x',
        repoId: 1,
        path: id.split('#')[1] ?? '',
        ref: 'a'.repeat(40),
        fetchedAt: asOf,
        license: { spdx: 'MIT', gate, evidence: { path: 'LICENSE', sha256: 'a'.repeat(64) } },
        stars: 10,
        pushedAt: asOf,
        archived: false,
        homepage: null,
        upstream: null,
        brandDerived: false,
      },
      facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
      quality: {
        score: 0.5,
        dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
      },
      security: 'pass',
      reasons: [],
      digest: `sha256:${'a'.repeat(64)}`,
    });
    const build = () =>
      buildAdsArtifacts([record('gh:acme/x#1', 'loadable'), record('gh:acme/x#2', 'view-only')], {
        generatedAt: asOf,
        collector: {
          name: 'df-market',
          version: '0.1.0',
          runId: 'index-verify',
          odsWatermark: asOf,
        },
      });
    const a = build();
    const b = build();
    expect(JSON.stringify(a.index)).toBe(JSON.stringify(b.index));
    expect(JSON.stringify(a.searchIndex)).toBe(JSON.stringify(b.searchIndex));
    expect(a.validation.ok).toBe(true);
  });
});

describe('凭据解析（不落盘、不打印）', () => {
  it('环境变量优先；gh 失败 → null（不得匿名轮换）', () => {
    expect(
      resolveGitHubToken({ GH_TOKEN: 'env-token' }, () => ({ status: 1, stdout: '' })),
    ).toEqual({
      token: 'env-token',
      source: 'env',
    });
    expect(resolveGitHubToken({}, () => ({ status: 1, stdout: '' }))).toBeNull();
    expect(
      resolveGitHubToken({ GITHUB_TOKEN: '  ' }, () => ({ status: 1, stdout: '' })),
    ).toBeNull();
  });
});
