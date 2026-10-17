/**
 * e2e 市场索引夹具公共件（nav / market 场景共用）。
 *
 * 为什么单独放 `fixtures/`：runner 只自动发现 `scripts/e2e/scenarios/*.mjs`，本目录不会被
 * 当作场景执行；场景各自保留自己的索引构造（`marketIndexFixture()`），这里只收口
 * 「文件名 + 落盘」两件容易漂移的事。
 *
 * daemon 每次查询按请求现读索引，落盘即生效（无需重启夹具 daemon）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 市场索引文件名（daemon 候选路径 `<数据根>/market/df.marketplace.index.v1.json`）。 */
export const MARKET_INDEX_FILENAME = 'df.marketplace.index.v1.json';

/**
 * 播种市场索引夹具。
 *
 * @param {string} dataRoot 夹具 daemon 的临时数据根
 * @param {unknown} index 场景构造的索引对象（原样 JSON 序列化）
 */
export function seedMarketIndex(dataRoot, index) {
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  writeFileSync(
    join(marketDir, MARKET_INDEX_FILENAME),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}
