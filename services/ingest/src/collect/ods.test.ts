/**
 * ODS 落盘测试（规格 §4.1/§4.3：只追加、行级可审计、幂等可复现）。
 *
 * 断言：一仓一记录（按 repo id 稳定排序）、raw_events 逐次往返一行、
 * 产物带 sha256+length、同输入两次写入完全一致（确定性）、schema 校验器可用。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateOdsRepoRecord, validateRawEvent, writeOds } from './ods.ts';
import type { OdsRepoRecord, RawEvent } from './types.ts';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mk01-ods-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repoRecord(repoId: number, name: string): OdsRepoRecord {
  return {
    schema: 'df.market.ods.repo/v1',
    runId: '20261015-0001',
    fetchedAt: '2026-10-15T22:00:00.000Z',
    repo: {
      id: repoId,
      fullName: `owner/${name}`,
      owner: 'owner',
      name,
      defaultBranch: 'main',
      stars: 10,
      forks: 1,
      pushedAt: '2026-10-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      stars90dAgo: 5,
      starsHistory: { method: 'direct-page', pagesFetched: 1, reason: null },
      archived: false,
      fork: false,
      sizeKb: 100,
      homepage: null,
      description: null,
      topics: [],
    },
    ref: 'a'.repeat(40),
    etag: 'W/"e1"',
    digest: `sha256:${'1'.repeat(64)}`,
    tree: { sha: 'tree-1', truncated: false, entryCount: 2, etag: 'W/"t1"' },
    license: {
      spdx: null,
      tier: 'none',
      gate: 'view-only',
      reasons: ['测试'],
      evidence: { path: null, sha256: null },
      brandDerived: false,
      archived: false,
    },
    assets: [],
    rejected: [],
    isListRepo: false,
    requestUrls: ['https://api.github.com/repos/owner/x'],
  };
}

const EVENT: RawEvent = {
  ts: '2026-10-15T22:00:00.000Z',
  runId: '20261015-0001',
  request: {
    method: 'GET',
    url: 'https://api.github.com/repos/owner/x',
    kind: 'core',
    attempt: 1,
    conditional: false,
  },
  response: {
    status: 200,
    etag: 'W/"e1"',
    linkNext: null,
    bodyDigest: `sha256:${'2'.repeat(64)}`,
    countedAgainstBudget: true,
    quota: { limit: 5000, remaining: 4999, resetAtMs: 1_800_000_000_000 },
  },
  startedAtMs: 1_700_000_000_000,
  endedAtMs: 1_700_000_000_200,
  durationMs: 200,
};

describe('writeOds 落盘', () => {
  it('写出 raw_snapshots 一仓一记录 + raw_events 逐次往返；按 repo id 稳定排序', async () => {
    const out = tempDir();
    const artifacts = await writeOds(out, {
      runId: '20261015-0001',
      date: '2026-10-15',
      records: [repoRecord(200, 'b'), repoRecord(100, 'a')],
      events: [EVENT, EVENT],
    });

    expect(artifacts.artifacts).toHaveLength(2);
    const snapshotPath = join(out, 'ods/raw_snapshots/date=2026-10-15/20261015-0001.jsonl');
    const eventsPath = join(out, 'ods/raw_events/date=2026-10-15/20261015-0001.jsonl');

    const snapshotLines = readFileSync(snapshotPath, 'utf8').trim().split('\n');
    expect(snapshotLines).toHaveLength(2);
    expect(JSON.parse(snapshotLines[0] ?? '{}').repo.id).toBe(100); // 稳定排序
    expect(JSON.parse(snapshotLines[1] ?? '{}').repo.id).toBe(200);

    const eventLines = readFileSync(eventsPath, 'utf8').trim().split('\n');
    expect(eventLines).toHaveLength(2);
    expect(JSON.parse(eventLines[0] ?? '{}').request.method).toBe('GET');

    for (const artifact of artifacts.artifacts) {
      expect(artifact.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(artifact.length).toBeGreaterThan(0);
    }
  });

  it('同输入两次写入 → 产物摘要一致（确定性，规格 §4.3 纯函数重建基础）', async () => {
    const a = await writeOds(tempDir(), {
      runId: 'r1',
      date: '2026-10-15',
      records: [repoRecord(1, 'a')],
      events: [EVENT],
    });
    const b = await writeOds(tempDir(), {
      runId: 'r1',
      date: '2026-10-15',
      records: [repoRecord(1, 'a')],
      events: [EVENT],
    });
    expect(a.artifacts.map((x) => x.sha256)).toEqual(b.artifacts.map((x) => x.sha256));
  });

  it('每行以 LF 结尾（行级可审计、可 diff）', async () => {
    const out = tempDir();
    await writeOds(out, {
      runId: 'r1',
      date: '2026-10-15',
      records: [repoRecord(1, 'a')],
      events: [],
    });
    const raw = readFileSync(join(out, 'ods/raw_snapshots/date=2026-10-15/r1.jsonl'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.includes('\r')).toBe(false);
  });
});

describe('validateOdsRepoRecord / validateRawEvent（schema 校验器，verify 脚本复用）', () => {
  it('合法记录 → 零问题', () => {
    expect(validateOdsRepoRecord(repoRecord(1, 'a'))).toEqual([]);
    expect(validateRawEvent(EVENT)).toEqual([]);
  });

  it('缺 createdAt / stars90dAgo 非法 → 逐条报出（对接面回归守门，MK-05 阶段 A）', () => {
    const base = repoRecord(1, 'a');
    const bad = {
      ...base,
      repo: { ...base.repo, createdAt: undefined, stars90dAgo: -1 },
    } as unknown;
    const rules = validateOdsRepoRecord(bad).map((i) => i.rule);
    expect(rules).toContain('repo-created-at');
    expect(rules).toContain('repo-stars-90d');
    // 空串 = 上游未给（合法缺省）；null = 未取到水位（合法缺省）
    const tolerated = {
      ...base,
      repo: { ...base.repo, createdAt: '', stars90dAgo: null },
    } as unknown;
    expect(validateOdsRepoRecord(tolerated)).toEqual([]);
  });

  it('缺 fetchedAt/etag/digest、digest 形态错、id 形态错 → 逐条报出', () => {    const bad = { ...repoRecord(1, 'a'), fetchedAt: undefined, digest: 'deadbeef' } as unknown;
    const issues = validateOdsRepoRecord(bad);
    expect(issues.map((i) => i.rule)).toContain('fetchedAt-present');
    expect(issues.map((i) => i.rule)).toContain('digest-format');

    const badAsset = {
      ...repoRecord(1, 'a'),
      assets: [
        {
          id: 'not-gh-id',
          kind: 'skill',
          root: 'x',
          name: 'x',
          version: null,
          declaredLicense: null,
          compliance: 'ok',
          probe: [],
          checks: [],
          treeDigest: `sha256:${'1'.repeat(64)}`,
          capabilities: [],
        },
      ],
    };
    expect(validateOdsRepoRecord(badAsset).map((i) => i.rule)).toContain('asset-id-format');
  });

  it('raw_event：method 必须 GET、状态码为数字、quota 可为 null', () => {
    expect(
      validateRawEvent({ ...EVENT, request: { ...EVENT.request, method: 'POST' } }).map(
        (i) => i.rule,
      ),
    ).toContain('method-get-only');
    expect(validateRawEvent({ ...EVENT, response: { ...EVENT.response, quota: null } })).toEqual(
      [],
    );
    expect(validateRawEvent({ nope: true }).length).toBeGreaterThan(0);
  });
});
