/**
 * ADS 产物读入面（arch-v1 · 票② · #3）——判别式返回，坏产物不抛异常。
 *
 * 背景：同一份 ADS 产物此前有三个读者、三种严格度——daemon 深解析（宽容）、CLI deploy
 * 浅查（严格 schema）、CLI search `JSON.parse as`（零校验）。
 *
 * 收敛**实况**（D-19 #4 注释如实：不是全部「收成一处」）：
 * - **检索索引已收敛**：daemon `market/search-index.ts` 与 CLI search 都经
 *   `readSearchIndex`（同一实现、同一宽容口径——坏 posting 项按条丢弃、坏 doc 判整份）；
 * - **市场索引仍是三读者**（收敛是后续批次）：daemon `market/service.ts` 自读 +
 *   `parseMarketplaceIndex`（宽容）、CLI deploy 经 `readAdsArtifacts`（本模块，生产侧
 *   严格校验）、CLI search 自拼 readFile + `parseMarketplaceIndex`（宽容）——
 *   两档严格度并存，三读者收敛立案在 Phase 2。
 *
 * 本模块现有两个入口：
 * - `readSearchIndex(text)`：检索索引（`market_search_index.v1.json`）文本 → `SearchIndex`；
 * - `readAdsArtifacts(dir)`：目录里的两张产物 → `{index, searchIndex}`；市场索引走**生产侧
 *   严格校验**（与 CLI deploy 写前门同口径），检索索引缺失按可选产物返回 null。
 *
 * 失败语义交给调用方：daemon 映射「空态 + warning（search-index-invalid）」，CLI 自行决定
 * exit 1（坏产物）或 exit 2（缺产物）——读入面不替调用方决定退出码。
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { MarketplaceIndex } from '@dforge/contracts';
import { parseMarketplaceIndex } from '@dforge/contracts';

import { ADS_INDEX_FILENAME, ADS_SEARCH_INDEX_FILENAME } from './pipeline.ts';
import { formatIndexIssues, parseSearchIndexArtifact, validateMarketplaceIndex } from './schema.ts';
import type { SearchIndex } from './search.ts';

/** 产物单文件大小上限（D-19 #2 · 票 A · A4：16MB——市场索引与检索索引同档）。 */
const MAX_ARTIFACT_FILE_BYTES = 16 * 1024 * 1024;

/** 检索索引读入结果（判别式；`reason` 可进 CLI 文案与 daemon warning）。 */
export type ReadSearchIndexResult =
  | { ok: true; value: SearchIndex }
  | { ok: false; reason: string };

/** ADS 产物集读入结果（检索索引缺失 → `searchIndex: null`，不是失败）。 */
export type ReadAdsArtifactsResult =
  | { ok: true; index: MarketplaceIndex; searchIndex: SearchIndex | null }
  | { ok: false; reason: string };

/** 产物目录内单文件读入结果（`missing` = 产物不存在——检索索引按可选产物处理）。 */
type ArtifactFileRead =
  | { ok: true; text: string }
  | { ok: false; reason: string; missing: boolean };

/** node fs 错误是否为 ENOENT（产物/目录不存在——与「存在但不安全」区分开）。 */
function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** `candidate`（realpath 后）是否落在 `root`（realpath 后）之内。 */
function isWithinRealDir(root: string, candidate: string): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return candidate.startsWith(prefix);
}

/**
 * 产物目录内的单文件安全读取（D-19 #2 · 票 A · A4）：
 *
 * 1. **realpath 双侧解析**：产物文件解析出的真实路径必须落在产物目录（同样 realpath
 *    解析后）之内——防目录内软链把读入面引到 `dir` 之外（逃逸即拒，不静默读穿）。
 *    约束口径是「产物内部路径不得解析到产物目录之外」，**不限制**调用方显式给定的
 *    `dir` 本身的位置（`dir` 可以是任何合法目录，含软链路径——两侧同解析即可对齐）。
 * 2. **单文件大小上限 16MB**：超限 `ok:false`（先于读入/解析判，防超大产物拖垮读入方）。
 *
 * 失败形态：ENOENT = 产物缺失（`missing:true`，检索索引按可选产物回 null）；
 * 逃逸/超限/其余读取失败 = 产物不可用（`missing:false`，不把坏产物静默当空）。
 * `reason` 只含文件名常量与短语，不含绝对路径（与既有 reason 口径一致）。
 */
async function readArtifactWithin(dir: string, filename: string): Promise<ArtifactFileRead> {
  const fail = (reason: string, missing: boolean): ArtifactFileRead => ({
    ok: false,
    reason,
    missing,
  });
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch (error) {
    if (isEnoent(error)) return fail(`产物目录缺失或不可读（${filename}）`, true);
    return fail(`产物目录不可解析（${filename}）`, false);
  }
  let realFile: string;
  try {
    realFile = await realpath(join(dir, filename));
  } catch (error) {
    if (isEnoent(error)) return fail(`产物缺失或不可读（${filename}）`, true);
    return fail(`产物路径不可解析（${filename}）`, false);
  }
  if (!isWithinRealDir(realDir, realFile)) {
    return fail(`产物路径不安全：${filename} 解析到产物目录之外（软链逃逸）`, false);
  }
  let fileSize: number;
  try {
    fileSize = (await stat(realFile)).size;
  } catch (error) {
    if (isEnoent(error)) return fail(`产物缺失或不可读（${filename}）`, true);
    return fail(`产物缺失或不可读（${filename}）`, false);
  }
  if (fileSize > MAX_ARTIFACT_FILE_BYTES) {
    return fail(`产物文件超过大小上限：${filename}（上限 16MB）`, false);
  }
  try {
    return { ok: true, text: await readFile(realFile, 'utf8') };
  } catch {
    return fail(`产物缺失或不可读（${filename}）`, false);
  }
}

/** 读检索索引文本：JSON 解析失败或关键结构不可用 → `ok:false`（不抛异常）。 */
export function readSearchIndex(text: string): ReadSearchIndexResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: '检索索引不是合法 JSON' };
  }
  const result = parseSearchIndexArtifact(parsed);
  return result.ok ? { ok: true, value: result.index } : result;
}

/**
 * 读 ADS 产物集（`<dir>/df.marketplace.index.v1.json` + `<dir>/market_search_index.v1.json`）。
 *
 * - 市场索引缺失/不可读/路径逃逸/超限/非 JSON/schema 不过 → `ok:false`（写入方按断言失败处理）；
 * - 检索索引缺失 → `ok:true` + `searchIndex:null`（可选产物；调用方自行决定是否必需）；
 * - 检索索引存在但损坏（含软链逃逸/超限）→ `ok:false`（不把坏产物静默当空）。
 * 两张产物都经 `readArtifactWithin` 安全读取（realpath 限定在产物目录内 + 16MB 上限，
 * D-19 #2 · 票 A · A4）。
 */
export async function readAdsArtifacts(dir: string): Promise<ReadAdsArtifactsResult> {
  const indexRead = await readArtifactWithin(dir, ADS_INDEX_FILENAME);
  if (!indexRead.ok) {
    return { ok: false, reason: indexRead.reason };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(indexRead.text) as unknown;
  } catch {
    return { ok: false, reason: `市场索引不是合法 JSON（${ADS_INDEX_FILENAME}）` };
  }

  const validation = validateMarketplaceIndex(parsed);
  if (!validation.ok) {
    const detail = formatIndexIssues(validation.errors.slice(0, 3)).join('；');
    return { ok: false, reason: `市场索引未通过 schema 校验：${detail}` };
  }
  const parsedIndex = parseMarketplaceIndex(parsed);
  if (!parsedIndex.ok) {
    return { ok: false, reason: `市场索引不可用：${parsedIndex.reason}` };
  }

  const searchRead = await readArtifactWithin(dir, ADS_SEARCH_INDEX_FILENAME);
  if (!searchRead.ok) {
    // 缺失 = 可选产物（null）；逃逸/超限/不可读 = 产物不可用（不静默当空）
    if (searchRead.missing) {
      return { ok: true, index: parsedIndex.index, searchIndex: null };
    }
    return { ok: false, reason: `检索索引不可用：${searchRead.reason}` };
  }
  const searchResult = readSearchIndex(searchRead.text);
  if (!searchResult.ok) {
    return { ok: false, reason: `检索索引不可用：${searchResult.reason}` };
  }
  return { ok: true, index: parsedIndex.index, searchIndex: searchResult.value };
}
