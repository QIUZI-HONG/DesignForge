/**
 * 市场两册（装载记录 / 回流计数）的持久化契约钉子（票 D 收编前先钉现状）。
 *
 * 补 load-store.test / feedback.test 未及的边缘语义，收编 lib `createLocalStore`
 * 前后必须全绿（断言零变化）：
 * - 读路径归一：必需键之外的残缺字段补默认、未知键剥离（过滤靠形状谓词，变换留在册本体）；
 * - 写路径上抛：写入失败（配额满）按现状把异常暴露给调用栈，不静默吞。
 */
import { describe, expect, it } from 'vitest';

import { makeMemoryStorage } from './__fixtures__/market';
import { bumpFeedback, FEEDBACK_KEY, readFeedback } from './feedback';
import { LOADED_RECORDS_KEY, readLoadRecords, writeLoadRecord } from './load-store';
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

/** 写入必败的存储替身（getItem 正常、setItem 抛——模拟配额满）。 */
function quotaFullStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  };
}

describe('load-store · 读路径归一（票 D 收编契约）', () => {
  it('残缺记录补默认（只给必需键 → 其余字段齐全、无 loadedAt）', () => {
    const storage = makeMemoryStorage({
      [LOADED_RECORDS_KEY]: JSON.stringify([{ assetId: 'a', digest: 'd' }]),
    });
    expect(readLoadRecords(storage)).toEqual([
      {
        assetId: 'a',
        name: '',
        kind: '',
        digest: 'd',
        ref: '',
        targetPath: null,
        capabilities: [],
        approvedAt: '',
        caller: 'user',
      },
    ]);
  });

  it('必需键之外的未知键剥离（读回形状即 LoadRecord）', () => {
    const storage = makeMemoryStorage({
      [LOADED_RECORDS_KEY]: JSON.stringify([{ assetId: 'a', digest: 'd', bogus: 1 }]),
    });
    const [first] = readLoadRecords(storage);
    expect(first).not.toHaveProperty('bogus');
  });

  it('空串存储值当空册', () => {
    expect(readLoadRecords(makeMemoryStorage({ [LOADED_RECORDS_KEY]: '' }))).toEqual([]);
  });
});

describe('load-store · 写路径上抛（票 D 收编契约）', () => {
  it('写入失败（配额满）异常上抛，不静默吞', () => {
    expect(() => writeLoadRecord(quotaFullStorage(), makeRecord())).toThrow('quota');
  });
});

describe('feedback · 读路径归一与写路径上抛（票 D 收编契约）', () => {
  it('必需键之外的未知键剥离', () => {
    const storage = makeMemoryStorage({
      [FEEDBACK_KEY]: JSON.stringify([{ assetId: 'a', runs: 2, bogus: 'x' }]),
    });
    expect(readFeedback(storage)).toEqual([{ assetId: 'a', runs: 2, adoptions: 0, lastAt: '' }]);
  });

  it('空串存储值当空表', () => {
    expect(readFeedback(makeMemoryStorage({ [FEEDBACK_KEY]: '' }))).toEqual([]);
  });

  it('写入失败（配额满）异常上抛，不静默吞', () => {
    expect(() => bumpFeedback(quotaFullStorage(), 'a', 'runs', '2026-10-15T10:00:00Z')).toThrow(
      'quota',
    );
  });
});
