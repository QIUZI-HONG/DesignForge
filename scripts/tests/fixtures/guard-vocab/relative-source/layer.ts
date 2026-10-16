/**
 * 正例夹具（guard-vocab「同包相对导入」）：真源就在同目录（`--source` 指向本目录的
 * `vocab.ts`），层文件用**相对路径**引真源派生——这是契约包内市场模块的既有写法
 * （`packages/contracts/src/market/index.ts` → `./vocab.ts`），不得判 foreign。
 * 覆盖两类登记名：值名（ASSET_KINDS）与类型名（AssetKind / InstallGateMode）。
 */

import type { MarketAssetKind } from './vocab.ts';
import { type LicenseGate, MARKET_ASSET_KINDS, MARKET_LICENSE_GATES } from './vocab.ts';

export const ASSET_KINDS: readonly string[] = MARKET_ASSET_KINDS;

export type AssetKind = MarketAssetKind;

/** 装载门模式登记名：真源 `MARKET_LICENSE_GATES` 的派生别名（同包相对导入应放行）。 */
export type InstallGateMode = LicenseGate;

export const GATES: readonly string[] = MARKET_LICENSE_GATES;
