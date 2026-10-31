/**
 * 索引交接指引（票 #15 · 方案 2）——`df market index` 成功后打印的接线步骤。
 *
 * 落点死循环的根因是「CLI 缺省写 `<CWD>/data/ads/`，daemon 只探数据根」；指引必须让用户
 * 不读源码就能把两侧接上：绝对落点 + 三种方式（同根启动 / DF_MARKET_INDEX / 复制）。
 * 本测试锚定这三条**可执行**信息，而不是整段文案（文案可改，出口不可丢）。
 */
import { describe, expect, it } from 'vitest';

import { buildIndexHandoffLines } from './handoff.ts';

describe('buildIndexHandoffLines', () => {
  const dataRoot = '/repo/data';
  const indexPath = '/repo/data/ads/df.marketplace.index.v1.json';

  it('首行点名缺省产物的绝对落点（用户据此判断文件在哪）', () => {
    const lines = buildIndexHandoffLines({ dataRoot, indexPath });
    expect(lines[0]).toBe(`索引落点：${indexPath}`);
  });

  it('给出两种接线方式：DF_MARKET_INDEX / 复制到数据根', () => {
    const text = buildIndexHandoffLines({ dataRoot, indexPath }).join('\n');
    expect(text).toContain(`DF_MARKET_INDEX=${indexPath} pnpm --filter @dforge/daemon dev`);
    expect(text).toContain('mkdir -p ~/.dforge/market/ads');
  });

  it('复制源是 ADS 目录整体（索引与检索索引一起搬，避免检索降级）', () => {
    const text = buildIndexHandoffLines({ dataRoot, indexPath }).join('\n');
    expect(text).toContain(`cp ${dataRoot}/ads/*.json ~/.dforge/market/ads/`);
  });
});
