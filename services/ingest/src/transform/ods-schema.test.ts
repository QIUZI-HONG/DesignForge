/**
 * ODS schema 校验测试（规格 §4.1/§4.4 + MK-01 一仓一记录口径）。
 *
 * 断言外部行为：合法记录零问题；逐条破坏必填/格式/枚举后必须报出对应的稳定规则码。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computeSnapshotDigest,
  validateFilesSnapshot,
  validateOdsRepoRecord,
  validateRawEvent,
  validateSnapshotDigest,
} from './ods/schema.ts';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'ods-source',
  'ods',
);
const SHA256_HEX = /^sha256:[0-9a-f]{64}$/;

function readJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

function fixtureRecords(): unknown[] {
  return readJsonl(join(FIXTURE_ROOT, 'raw_snapshots', 'date=2026-10-15', '20261015-120000.jsonl'));
}

function fixtureEvents(): unknown[] {
  return readJsonl(join(FIXTURE_ROOT, 'raw_events', 'date=2026-10-15', '20261015-120000.jsonl'));
}

/** 深拷贝一份夹具记录，供逐条破坏使用。 */
function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('validateOdsRepoRecord（一仓一记录）', () => {
  it('夹具中的每条记录均无问题', () => {
    const records = fixtureRecords();
    expect(records.length).toBe(2);
    for (const record of records) {
      expect(validateOdsRepoRecord(record)).toEqual([]);
    }
  });

  it('缺 fetchedAt 报 fetchedAt-present', () => {
    const record = clone(fixtureRecords()[0]);
    record.fetchedAt = undefined;
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('fetchedAt-present');
  });

  it('digest 形态非法报 digest-format', () => {
    const record = clone(fixtureRecords()[0]);
    record.digest = 'sha256:XYZ';
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('digest-format');
  });

  it('ref 非 40 位 hex 报 ref-format', () => {
    const record = clone(fixtureRecords()[0]);
    record.ref = 'a1b2c3';
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('ref-format');
  });

  it('license.gate 非三档枚举报 license-gate', () => {
    const record = clone(fixtureRecords()[0]);
    (record.license as Record<string, unknown>).gate = 'maybe';
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('license-gate');
  });

  it('资产 id 形态非法报 asset-id-format（稳定标识 gh:<owner>/<repo>#<path>）', () => {
    const record = clone(fixtureRecords()[0]);
    const assets = record.assets as Record<string, unknown>[];
    (assets[0] as Record<string, unknown>).id = 'acme/design-kit';
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('asset-id-format');
  });

  it('资产缺 checks 报 asset-checks（内容校验结论必须留痕）', () => {
    const record = clone(fixtureRecords()[0]);
    const assets = record.assets as Record<string, unknown>[];
    (assets[0] as Record<string, unknown>).checks = [];
    expect(validateOdsRepoRecord(record).map((issue) => issue.rule)).toContain('asset-checks');
  });

  it('非对象输入直接报 record-object', () => {
    expect(validateOdsRepoRecord(null).map((issue) => issue.rule)).toEqual(['record-object']);
  });
});

describe('validateRawEvent（每次 API 往返一行）', () => {
  it('夹具中的每个事件均无问题', () => {
    const events = fixtureEvents();
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const event of events) {
      expect(validateRawEvent(event)).toEqual([]);
    }
  });

  it('非 GET 报 method-get-only（gh api -f 坑，规格 §3.6）', () => {
    const event = clone(fixtureEvents()[0]);
    (event.request as Record<string, unknown>).method = 'POST';
    expect(validateRawEvent(event).map((issue) => issue.rule)).toContain('method-get-only');
  });

  it('缺 countedAgainstBudget 报 response-counted', () => {
    const event = clone(fixtureEvents()[0]);
    delete (event.response as Record<string, unknown>).countedAgainstBudget;
    expect(validateRawEvent(event).map((issue) => issue.rule)).toContain('response-counted');
  });
});

describe('validateFilesSnapshot（规格 §4.1 raw_snapshots 形态）', () => {
  const snapshot = () => ({
    schema: 'df.market.ods.files/v1',
    runId: '20261015-120000',
    fetchedAt: '2026-10-15T12:00:03.000Z',
    repoId: 1001,
    fullName: 'acme/design-kit',
    ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    etag: 'W/"etag-repo-a"',
    apiQuotaLeft: 4987,
    isListRepo: false,
    tree: {
      sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      truncated: false,
      entryCount: 4,
      listingDigest: `sha256:${'a'.repeat(64)}`,
    },
    files: [
      {
        path: 'skills/palette/SKILL.md',
        gitSha: 'c0ffee1234567890abcdef1234567890abcdef12',
        size: 307,
        sha256: `sha256:${'b'.repeat(64)}`,
        blobRef: `sha256:${'b'.repeat(64)}`,
        mediaType: 'text',
      },
    ],
    record: fixtureRecords()[0],
    snapshotDigest: `sha256:${'c'.repeat(64)}`,
  });

  it('合法快照无问题', () => {
    expect(validateFilesSnapshot(snapshot())).toEqual([]);
  });

  it('schema 不精确匹配报 schema', () => {
    const bad = { ...snapshot(), schema: 'df.market.ods.files/v2' };
    expect(validateFilesSnapshot(bad).map((issue) => issue.rule)).toContain('schema');
  });

  it('文件条目缺 gitSha 报 file-git-sha', () => {
    const bad = snapshot();
    (bad.files[0] as Record<string, unknown>).gitSha = '';
    expect(validateFilesSnapshot(bad).map((issue) => issue.rule)).toContain('file-git-sha');
  });

  it('blobRef 形态非法报 file-blob-ref（必须形如 sha256:<64hex>）', () => {
    const bad = snapshot();
    (bad.files[0] as Record<string, unknown>).blobRef = 'blob-1';
    expect(validateFilesSnapshot(bad).map((issue) => issue.rule)).toContain('file-blob-ref');
  });

  it('内嵌一仓一记录不合法时上报 record.* 规则（不允许只校验文件清单）', () => {
    const bad = snapshot();
    (bad.record as Record<string, unknown>).ref = 'nope';
    const rules = validateFilesSnapshot(bad).map((issue) => issue.rule);
    expect(rules.some((rule) => rule.startsWith('record.'))).toBe(true);
  });
});

describe('validateSnapshotDigest（快照自身哈希：去指针后可复核）', () => {
  const base = () => ({
    schema: 'df.market.ods.files/v1',
    runId: '20261015-120000',
    repoId: 1001,
    fullName: 'acme/design-kit',
    ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    files: [{ path: 'LICENSE', gitSha: 'f'.repeat(40), size: 115 }],
    record: fixtureRecords()[0],
  });

  it('补上 computeSnapshotDigest 的结果后通过', () => {
    const snapshot = { ...base(), snapshotDigest: computeSnapshotDigest(base()) };
    expect(validateSnapshotDigest(snapshot)).toEqual([]);
    expect(snapshot.snapshotDigest).toMatch(SHA256_HEX);
  });

  it('字段被篡改后重算不一致 → snapshot-digest-mismatch', () => {
    const original = { ...base(), snapshotDigest: computeSnapshotDigest(base()) };
    const tampered = clone(original);
    (tampered.files as Record<string, unknown>[])[0] = {
      path: 'LICENSE',
      gitSha: 'f'.repeat(40),
      size: 999,
    };
    expect(validateSnapshotDigest(tampered).map((issue) => issue.rule)).toContain(
      'snapshot-digest-mismatch',
    );
  });

  it('缺 snapshotDigest 报 snapshot-digest-present', () => {
    expect(validateSnapshotDigest(base()).map((issue) => issue.rule)).toContain(
      'snapshot-digest-present',
    );
  });
});
