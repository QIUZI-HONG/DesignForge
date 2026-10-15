/**
 * @dforge/ingest · 采集器（MK-01）公共 API。
 *
 * 分层（详见各模块头注释）：
 *   candidates → 候选发现（topic 只作候选）
 *   probe      → 结构探针（Trees 单次调用）
 *   validate   → 内容校验（防纯文件名误报）
 *   identify   → 四类认定（探针 + 校验两级）
 *   license    → 三档守门（NOASSERTION ≠ 无许可）
 *   ratelimit/http/client → 请求纪律（ETag/串行/退避/分页/GET-only）
 *   ods/evidence/run/cli  → ODS 落盘、证据 JSON、编排与独立 CLI
 */

export {
  buildSearchUrl,
  buildTopicQuery,
  DEFAULT_TOPICS,
  discoverCandidates,
  isListRepo,
  parseSearchResponse,
} from './candidates.ts';
export { defaultOutDir, main, parseArgs, runIdOf } from './cli.ts';
export {
  createGitHubClient,
  createRecordingFetch,
  createReplayFetch,
  decodeContentsText,
  parseRecordedResponses,
  parseRepoMeta,
  parseTree,
  ReplayMissError,
  resolveGitHubToken,
  UpstreamError,
} from './client.ts';
export { buildEvidence, exitCodeOf } from './evidence.ts';
export { requestText, sha256Hex } from './http.ts';
export { digestForRoot, findLicensePath, identifyAssets, slugify } from './identify.ts';
export { assessLicense, detectBrandDerived, PERMISSIVE_SPDX } from './license.ts';
export { validateOdsRepoRecord, validateRawEvent, writeOds } from './ods.ts';
export { baseName, parentDir, probeTree } from './probe.ts';
export {
  BudgetLedger,
  ConsecutiveRateLimitAbort,
  parseLinkNext,
  RateLimitWatch,
  RequestGovernor,
  retryDelayMs,
  SerialQueue,
  systemClock,
  TokenBucket,
} from './ratelimit.ts';
export type { CollectOptions, CollectResult } from './run.ts';
export { runCollect, selectContentPaths } from './run.ts';
export * from './types.ts';
export {
  inspectTokensCss,
  inspectTokensJson,
  isI18nPath,
  isPureLinkList,
  parseFrontmatter,
  validateDesignSystemManifest,
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillDoc,
  validateTemplateManifest,
} from './validate.ts';
