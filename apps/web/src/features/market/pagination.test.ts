import type { MarketAsset } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { appendMarketPage, hasMorePages } from './pagination';

/** 造一个最小资产（只关心 id 去重口径）。 */
function asset(id: string): MarketAsset {
  return { id } as MarketAsset;
}

describe('市场增量分页（DEF-R1）· 纯函数', () => {
  it('追加一页：保持顺序并去重（同 id 以先出现者为准）', () => {
    const merged = appendMarketPage([asset('a'), asset('b')], [asset('b'), asset('c')]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('增量为空：原样返回（不复制可变引用内容）', () => {
    const existing = [asset('a')];
    expect(appendMarketPage(existing, [])).toEqual(existing);
  });

  it('终点判定：total 为 0 不提供下一页；已载达到 total 即终点', () => {
    expect(hasMorePages(0, 0)).toBe(false);
    expect(hasMorePages(59, 344)).toBe(true);
    expect(hasMorePages(60, 60)).toBe(false);
    expect(hasMorePages(61, 60)).toBe(false);
  });
});
