/**
 * 回流计数测试（接缝：`@/features/market/feedback`；D5 采纳/试跑本地计数）。
 */

import { describe, expect, it } from 'vitest';

import { makeMemoryStorage } from './__fixtures__/market';
import { bumpFeedback, FEEDBACK_KEY, feedbackOf, readFeedback } from './feedback';

describe('feedback · 本地计数（§8.3 遥测默认仅本地）', () => {
  it('空存储 → 空表；无记录资产给零值（界面显示 0，不隐藏）', () => {
    const storage = makeMemoryStorage();
    expect(readFeedback(storage)).toEqual([]);
    expect(feedbackOf([], 'gh:a/b#x')).toEqual({
      assetId: 'gh:a/b#x',
      runs: 0,
      adoptions: 0,
      lastAt: '',
    });
  });

  it('试跑与采纳分别累加（同资产覆盖为最新，其余保留）', () => {
    const storage = makeMemoryStorage();
    bumpFeedback(storage, 'a', 'runs', '2026-10-15T10:00:00Z');
    bumpFeedback(storage, 'b', 'adoptions', '2026-10-15T10:01:00Z');
    const entries = bumpFeedback(storage, 'a', 'runs', '2026-10-15T10:02:00Z');
    expect(entries.map((entry) => entry.assetId)).toEqual(['a', 'b']);
    expect(feedbackOf(entries, 'a')).toMatchObject({
      runs: 2,
      adoptions: 0,
      lastAt: '2026-10-15T10:02:00Z',
    });
    expect(feedbackOf(entries, 'b')).toMatchObject({ runs: 0, adoptions: 1 });
    expect(readFeedback(storage)).toHaveLength(2);
  });

  it('损坏数据当空表（本地计数不拖垮面板）', () => {
    expect(readFeedback(makeMemoryStorage({ [FEEDBACK_KEY]: '{' }))).toEqual([]);
    expect(readFeedback(makeMemoryStorage({ [FEEDBACK_KEY]: '[{"runs":2}]' }))).toEqual([]);
  });

  it('非法计数值归一为 0（不把负数/字符串带进界面）', () => {
    const storage = makeMemoryStorage({
      [FEEDBACK_KEY]: JSON.stringify([{ assetId: 'a', runs: -3, adoptions: 'x', lastAt: 5 }]),
    });
    expect(readFeedback(storage)[0]).toEqual({ assetId: 'a', runs: 0, adoptions: 0, lastAt: '' });
  });
});
