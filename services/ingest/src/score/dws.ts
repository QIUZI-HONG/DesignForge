/**
 * DWS 层产物：校验 / 序列化 / 落盘 / ADS 投影（MK-03 → MK-04 的对接面）。
 *
 * - `validateDwsRecord`：DWS 记录形状与**内部一致性**校验（总分与维度分互证——不信自述）；
 * - `dwsJsonl` / `writeDwsJsonl`：DWS 层落盘（JSONL；规格 §4.2 的 Parquet 编码由 MK-02 的
 *   层落盘承担，本票产出**记录形状 + JSONL**，纯增量、可被 MK-02/MK-04 直接消费）；
 * - `adsQualityOf`：把 DWS 记录投影成规格 §1.2 的 ADS `quality` 对象（MK-04 直嵌卡片）。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { REASON_TEXT } from './codes.ts';
import {
  type AssetQualityRecord,
  DIM_WEIGHTS,
  DIMENSIONS,
  type DimKey,
  DWS_QUALITY_SCHEMA,
  ROUND_TOTAL_DIGITS,
} from './types.ts';
import { roundTo } from './util.ts';

/** 本票的采集器标识（进证据 JSON）。 */
export const DWS_COLLECTOR = { name: 'df-market-score', version: '0.1.0' } as const;

/** sha256 十六进制（证据 JSON 的 artifacts 口径）。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 由维度分重算总分（与 `aggregate.ts` 同口径：可用权重归一化 + 两位小数）。
 * 校验器用它做「产物自证」——记录里的总分必须与维度分对得上。
 */
export function expectedTotal(dims: Record<DimKey, number | null>): number | null {
  let weighted = 0;
  let available = 0;
  for (const key of DIMENSIONS) {
    const value = dims[key];
    if (typeof value === 'number') {
      weighted += DIM_WEIGHTS[key] * value;
      available += DIM_WEIGHTS[key];
    }
  }
  return available > 0 ? roundTo(weighted / available, ROUND_TOTAL_DIGITS) : null;
}

/** 分数是否在 [0,1] 且不超过 `digits` 位小数。 */
function isUnitScore(value: unknown, digits: number): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < 0 || value > 1) return false;
  return Math.abs(value - roundTo(value, digits)) < 1e-9;
}

/** 校验 DWS 记录；返回问题清单（空数组 = 通过）。 */
export function validateDwsRecord(raw: unknown): string[] {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['记录不是对象'];
  const rec = raw as Record<string, unknown>;

  if (rec.schema !== DWS_QUALITY_SCHEMA) issues.push(`schema ≠ ${DWS_QUALITY_SCHEMA}`);
  if (typeof rec.assetId !== 'string' || rec.assetId === '') issues.push('assetId 为空');
  if (typeof rec.asOf !== 'string' || rec.asOf === '') issues.push('asOf 为空');
  if (rec.score !== null && !isUnitScore(rec.score, ROUND_TOTAL_DIGITS))
    issues.push('score 非法（null 或 [0,1] 两位小数）');
  if (!['high', 'low'].includes(rec.confidence as string)) issues.push('confidence ∉ {high, low}');

  const flags = rec.flags as Record<string, unknown> | undefined;
  for (const key of ['archived', 'coldStart', 'nonCompliant', 'filesTruncated']) {
    if (typeof flags?.[key] !== 'boolean') issues.push(`flags.${key} 非布尔`);
  }

  const dims = rec.dims as Record<string, unknown> | undefined;
  if (typeof dims !== 'object' || dims === null) {
    issues.push('dims 缺失');
  } else {
    for (const key of DIMENSIONS) {
      const value = dims[key];
      if (value !== null && !isUnitScore(value, 4))
        issues.push(`dims.${key} 非法（null 或 [0,1]）`);
    }
    const expected = expectedTotal(dims as Record<DimKey, number | null>);
    if (expected !== rec.score) {
      issues.push(`总分与维度分不符（记录 ${String(rec.score)} / 重算 ${String(expected)}）`);
    }
  }

  const explain = rec.explain as Record<string, unknown> | undefined;
  if (typeof explain !== 'object' || explain === null) {
    issues.push('explain 缺失');
  } else {
    for (const key of DIMENSIONS) {
      const dim = explain[key] as { signals?: unknown; deductions?: unknown } | undefined;
      if (typeof dim !== 'object' || dim === null) {
        issues.push(`explain.${key} 缺失`);
        continue;
      }
      if (!Array.isArray(dim.signals) || dim.signals.length === 0)
        issues.push(`explain.${key}.signals 为空（规格 §5.3 每维须有信号明细）`);
      if (!Array.isArray(dim.deductions)) {
        issues.push(`explain.${key}.deductions 非数组`);
        continue;
      }
      for (const d of dim.deductions as Record<string, unknown>[]) {
        if (!Object.hasOwn(REASON_TEXT, d.code as string))
          issues.push(`explain.${key} 扣分码不在词表：${String(d.code)}`);
        if (typeof d.reason !== 'string' || d.reason === '')
          issues.push(`explain.${key} 扣分理由为空（码 ${String(d.code)}）`);
        if (typeof d.delta !== 'number' || d.delta < 0 || d.delta > 1)
          issues.push(`explain.${key} 扣分 delta 非法（码 ${String(d.code)}）`);
      }
    }
  }

  return issues;
}

/** DWS 记录序列化为 JSONL（一行一记录，无尾空行 → 字节稳定）。 */
export function dwsJsonl(records: readonly AssetQualityRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n');
}

/** 落盘 DWS JSONL；返回 artifacts 三元组（证据 JSON 口径）。 */
export function writeDwsJsonl(
  outPath: string,
  records: readonly AssetQualityRecord[],
): { path: string; sha256: string; length: number } {
  const payload = `${dwsJsonl(records)}\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, payload, 'utf8');
  return { path: outPath, sha256: sha256Hex(payload), length: Buffer.byteLength(payload, 'utf8') };
}

/** 落盘任意 JSON（证据 JSON 等；缩进 2 便于人工复核）；返回 artifacts 三元组。 */
export function writeJsonFile(
  outPath: string,
  value: unknown,
): { path: string; sha256: string; length: number } {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, payload, 'utf8');
  return { path: outPath, sha256: sha256Hex(payload), length: Buffer.byteLength(payload, 'utf8') };
}

/** ADS `quality` 对象（规格 §1.2 + §5.3；MK-04 直接嵌入卡片）。 */
export interface AdsQuality {
  score: number | null;
  confidence: 'high' | 'low';
  coldStart: boolean;
  /** 雷达数据点：null = 空心（无信号，区别于 0 分，规格 §5.3）。 */
  dims: Record<DimKey, number | null>;
  explain: AssetQualityRecord['explain'];
}

/** 由 DWS 记录投影出 ADS `quality` 字段。 */
export function adsQualityOf(record: AssetQualityRecord): AdsQuality {
  return {
    score: record.score,
    confidence: record.confidence,
    coldStart: record.flags.coldStart,
    dims: record.dims,
    explain: record.explain,
  };
}
