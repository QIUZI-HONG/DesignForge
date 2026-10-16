/**
 * 正例夹具（guard-vocab）：各层词表全部自 @dforge/contracts 真源派生——守卫修好后
 * 这类写法必须仍 exit 0（不得为了抓骗子把正例判红）。
 * 本文件不参与构建，仅被 `guard-vocab.mjs --layers=` 静态读取。
 */
import {
  MARKET_ASSET_KINDS,
  MARKET_QUALITY_WEIGHTS,
  type MarketAssetKind,
} from '@dforge/contracts';

/** 全量引用（非字面量）：真源直引。 */
export const ASSET_KINDS: readonly string[] = MARKET_ASSET_KINDS;

/** 本层子集派生：排序/过滤都行，只要根在真源。 */
export const KIND_PRIORITY: readonly MarketAssetKind[] = [...MARKET_ASSET_KINDS].sort();

/** 权重表派生：对象整体继承，不抄一份。 */
export const QUALITY_WEIGHTS = MARKET_QUALITY_WEIGHTS;

/** 类型别名派生：指向契约真源的类型（非字面量联合）。 */
export type AssetKind = MarketAssetKind;
