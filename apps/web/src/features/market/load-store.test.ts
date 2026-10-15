/**
 * 本地装载记录册测试（接缝：`@/features/market/load-store`）。
 *
 * 断言：坏数据不当崩（当空册）、同资产覆盖（只留最近一次）、更新判定按 digest。
 * 存储用内存实现——不依赖浏览器，也不掩盖「读不到就是空册」的语义。
 */

import { describe, expect, it } from 'vitest';

import { makeMemoryStorage } from './__fixtures__/market';
import {
  findLoadRecord,
  isUpdateAvailable,
  LOADED_RECORDS_KEY,
  loadedAssetIds,
  readLoadRecords,
  removeLoadRecord,
  writeLoadRecord,
} from './load-store';
import type { LoadRecord } from './load-token';

function makeRecord(overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    assetId: 'gh:acme/skills#skills/pdf-export',
    name: 'pdf-export',
    kind: 'skill',
    digest: 'sha256:aaa',
    ref: 'a1b2c3d',
    targetPath: '.dfg/market/skill/pdf-export/',
    capabilities: [],
    approvedAt: '2026-10-15T22:50:00Z',
    caller: 'user',
    ...overrides,
  };
}

describe('load-store · 读', () => {
  it('空存储 → 空册', () => {
    expect(readLoadRecords(makeMemoryStorage())).toEqual([]);
  });

  it('损坏 JSON / 非数组 / 缺关键字段 → 当空册（本地记录不拖垮页面）', () => {
    expect(readLoadRecords(makeMemoryStorage({ [LOADED_RECORDS_KEY]: '{' }))).toEqual([]);
    expect(readLoadRecords(makeMemoryStorage({ [LOADED_RECORDS_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readLoadRecords(makeMemoryStorage({ [LOADED_RECORDS_KEY]: '[{"name":"x"}]' }))).toEqual(
      [],
    );
  });

  it('合法记录原样读回（含能力授权清单）', () => {
    const storage = makeMemoryStorage({ [LOADED_RECORDS_KEY]: JSON.stringify([makeRecord()]) });
    const records = readLoadRecords(storage);
    expect(records).toHaveLength(1);
    expect(records[0]?.assetId).toBe('gh:acme/skills#skills/pdf-export');
  });
});

describe('load-store · 写', () => {
  it('写入后可读回，且新记录在前', () => {
    const storage = makeMemoryStorage();
    writeLoadRecord(storage, makeRecord({ assetId: 'a' }));
    const records = writeLoadRecord(storage, makeRecord({ assetId: 'b' }));
    expect(records.map((record) => record.assetId)).toEqual(['b', 'a']);
    expect(readLoadRecords(storage).map((record) => record.assetId)).toEqual(['b', 'a']);
  });

  it('同 assetId 覆盖（只留最近一次装载；避免重复徽标）', () => {
    const storage = makeMemoryStorage();
    writeLoadRecord(storage, makeRecord({ digest: 'sha256:old' }));
    const records = writeLoadRecord(storage, makeRecord({ digest: 'sha256:new' }));
    expect(records).toHaveLength(1);
    expect(records[0]?.digest).toBe('sha256:new');
  });

  it('已装载 id 集合与查找', () => {
    const records = [makeRecord({ assetId: 'a' }), makeRecord({ assetId: 'b' })];
    expect(loadedAssetIds(records)).toEqual(['a', 'b']);
    expect(findLoadRecord(records, 'b')?.assetId).toBe('b');
    expect(findLoadRecord(records, 'zzz')).toBeNull();
  });
});

describe('load-store · 更新判定（§7.4 digest 双条件之内容哈希）', () => {
  it('digest 不同 → 可更新；相同 → 不可更新；无记录 → 不可更新', () => {
    expect(isUpdateAvailable(makeRecord({ digest: 'sha256:old' }), { digest: 'sha256:new' })).toBe(
      true,
    );
    expect(
      isUpdateAvailable(makeRecord({ digest: 'sha256:same' }), { digest: 'sha256:same' }),
    ).toBe(false);
    expect(isUpdateAvailable(null, { digest: 'sha256:new' })).toBe(false);
  });
});

describe('load-store · 卸载', () => {
  it('删除指定资产记录，其余保留', () => {
    const storage = makeMemoryStorage();
    writeLoadRecord(storage, makeRecord({ assetId: 'a' }));
    writeLoadRecord(storage, makeRecord({ assetId: 'b' }));
    const next = removeLoadRecord(storage, 'a');
    expect(next.map((record) => record.assetId)).toEqual(['b']);
    expect(readLoadRecords(storage).map((record) => record.assetId)).toEqual(['b']);
  });

  it('删除不存在的 id 不改变册子', () => {
    const storage = makeMemoryStorage();
    writeLoadRecord(storage, makeRecord({ assetId: 'a' }));
    expect(removeLoadRecord(storage, 'zzz').map((record) => record.assetId)).toEqual(['a']);
  });
});
