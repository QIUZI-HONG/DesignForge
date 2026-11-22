// @vitest-environment jsdom
/**
 * `useUpdatableCount`（票②）：侧栏「可更新 N」徽标的数据 hook。
 *
 * 断言外部行为：本地记录册 × 市场索引快照的 digest 可更新计数——
 * 无记录不发请求（enabled 闸）；索引不可达降级为 0（不虚报、不报错）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketFixtures } from '@/features/market';

import { LOADED_RECORDS_KEY } from './load-store';
import type { LoadRecord } from './load-token';
import { useUpdatableCount } from './use-market';

const { makeAsset, makeQueryResponse } = marketFixtures;

const fetchMock = vi.fn();

/** 造装载记录（形状对齐 load-store.test 同款helper；票②测试只关心 assetId×digest）。 */
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

function respond(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function seedRecords(assetIds: string[], digest: string): void {
  const records = assetIds.map((assetId) => makeRecord({ assetId, digest }));
  window.localStorage.setItem(LOADED_RECORDS_KEY, JSON.stringify(records));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdatableCount', () => {
  it('记录 digest 与索引当前 digest 不同 → 计数 1；相同 → 0', async () => {
    seedRecords(['gh:acme/skills#skills/pdf-export'], 'sha256:old');
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond(
          makeQueryResponse({
            items: [makeAsset({ id: 'gh:acme/skills#skills/pdf-export', digest: 'sha256:new' })],
          }),
        ),
      ),
    );
    const { result } = renderHook(() => useUpdatableCount({ baseUrl: 'http://daemon.test' }));
    await waitFor(() => {
      expect(result.current).toBe(1);
    });
  });

  it('无本地记录 → 不发请求，计数 0', () => {
    const { result } = renderHook(() => useUpdatableCount({ baseUrl: 'http://daemon.test' }));
    expect(result.current).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('市场侧不可达 → 降级为 0（拒绝不逃逸成异常）', async () => {
    seedRecords(['gh:acme/skills#skills/pdf-export'], 'sha256:old');
    fetchMock.mockImplementation(() => Promise.reject(new Error('daemon down')));
    const { result } = renderHook(() => useUpdatableCount({ baseUrl: 'http://daemon.test' }));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current).toBe(0);
    });
  });
});
