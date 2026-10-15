/**
 * @dforge/ingest · 五维评分（DWS，MK-03）公共 API。
 *
 * 分层（详见各模块头注释）：
 *   types/codes        → 输入输出契约、五维权重、信号码与扣分原因码词表（唯一真源）
 *   text/files/percentile/time → 可机械判定的信号启发式与时间/分位纯函数
 *   dwd                → DWD 输入归一化与校验（对接 MK-02 的接缝）
 *   dim-{spec,maintenance,docs,security,ecosystem} → 每维信号 → 分值 + 扣分明细
 *   aggregate/batch    → 五维合成总分（冷启动重归一化）与批处理（含生态分位语境）
 *   dws/evidence       → DWS 层校验/落盘、ADS `quality` 投影、证据 JSON（判据链口径）
 *   cli                → 独立 CLI（离线跑分 → DWS JSONL + 证据 JSON）
 *
 * 权威规格：《技能市场规格 v1》§5（评分口径）+ §1.2（ADS `quality`）+ §4.4（DWS 字段）。
 */

export { scoreAsset } from './aggregate.ts';
export { scoreBatch } from './batch.ts';
export type { ReasonCode, SignalCode } from './codes.ts';
export { REASON_TEXT, SIGNAL_TEXT, SPEC_VOCABULARY_CODES } from './codes.ts';
export { scoreDocs } from './dim-docs.ts';
export type { EcosystemContext } from './dim-ecosystem.ts';
export {
  buildEcosystemContext,
  COLD_START_DAYS,
  isColdStart,
  scoreEcosystem,
} from './dim-ecosystem.ts';
export { ARCHIVED_MAINTENANCE_CAP, scoreMaintenance } from './dim-maintenance.ts';
export { scoreSecurity } from './dim-security.ts';
export { scoreSpec } from './dim-spec.ts';
export { DwdShapeError, normalizeDwdAsset, validateDwdAsset } from './dwd.ts';
export type { AdsQuality } from './dws.ts';
export {
  adsQualityOf,
  DWS_COLLECTOR,
  dwsJsonl,
  sha256Hex,
  validateDwsRecord,
  writeDwsJsonl,
  writeJsonFile,
} from './dws.ts';
export type { Evidence, EvidenceAssertion, EvidenceStep } from './evidence.ts';
export { buildEvidence, exitCodeOf } from './evidence.ts';
export { batchPercentile, starsGrowthRate } from './percentile.ts';
export { DAY_MS, daysBetween, isWithinDays } from './time.ts';
export type {
  AssetKind,
  AssetQualityRecord,
  Compliance,
  Confidence,
  Deduction,
  DimensionResult,
  DimKey,
  DwdAsset,
  DwdFileEntry,
  LicenseGate,
  ScoreBatchOptions,
  ScoreBatchResult,
  SignalDetail,
  SignalValue,
} from './types.ts';
export {
  DEDUCTION_DUST,
  DIM_LABELS,
  DIM_WEIGHTS,
  DIMENSIONS,
  DWS_QUALITY_SCHEMA,
  ROUND_DIM_DIGITS,
  ROUND_TOTAL_DIGITS,
} from './types.ts';
export { clamp01, finalizeScore, normalizedWeight, roundTo, weightedMean } from './util.ts';
