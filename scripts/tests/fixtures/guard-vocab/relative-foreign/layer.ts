/**
 * 负例夹具（guard-vocab「同包相对导入」）：类型根来自同包的**非真源**文件 `./other.ts`，
 * 不是契约真源导出——必须仍判违规（exit 1），防「相对路径一律放行」的漏洞。
 */
import type { LocalKind } from './other.ts';

export type AssetKind = LocalKind;
