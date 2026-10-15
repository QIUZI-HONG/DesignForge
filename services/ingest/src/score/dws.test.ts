/**
 * DWS 产物层单测（MK-03）。
 *
 * 断言口径：规格 §4.4（DWS `asset_quality` 字段）/ §5.3（explain 齐备、扣分码在词表内）/
 * §1.2（ADS `quality` 直取形状）/ §4.2（落盘）。校验器必须能**抓住**坏记录（反例测试），
 * 否则 MK-04/FE-11 复用时会漏检。
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AS_OF } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';
import {
  adsQualityOf,
  dwsJsonl,
  expectedTotal,
  sha256Hex,
  validateDwsRecord,
  writeDwsJsonl,
} from './dws.ts';
import type { AssetQualityRecord } from './types.ts';

/** 固定样本批次的记录。 */
function records(): AssetQualityRecord[] {
  return scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records;
}

/** 深拷贝（反例测试用）。 */
function clone(record: AssetQualityRecord): AssetQualityRecord {
  return JSON.parse(JSON.stringify(record)) as AssetQualityRecord;
}

describe('validateDwsRecord：正例（样本批全过）', () => {
  it('6 条记录问题清单为空', () => {
    for (const record of records()) {
      expect(validateDwsRecord(record)).toEqual([]);
    }
  });

  it('冷启动record：dims.ecosystem = null（空心）不视为非法', () => {
    const cold = records().find((r) => r.flags.coldStart);
    expect(cold?.dims.ecosystem).toBeNull();
    expect(validateDwsRecord(cold)).toEqual([]);
  });
});

describe('validateDwsRecord：反例（坏记录必须被抓住）', () => {
  const base = (): AssetQualityRecord => clone(records()[0] as AssetQualityRecord);

  it('schema 不符', () => {
    const bad = base() as unknown as Record<string, unknown>;
    bad['schema'] = 'df.marketplace.index/v1';
    expect(validateDwsRecord(bad).some((i) => i.includes('schema'))).toBe(true);
  });

  it('总分与维度分不符（自证失败）', () => {
    const bad = base();
    bad.score = 0.5;
    expect(validateDwsRecord(bad).some((i) => i.includes('总分与维度分不符'))).toBe(true);
  });

  it('维度分越界 / 精度超限', () => {
    const bad = base();
    bad.dims.spec = 1.5;
    expect(validateDwsRecord(bad).some((i) => i.includes('dims.spec'))).toBe(true);
  });

  it('explain 缺信号明细（规格 §5.3 硬要求）', () => {
    const bad = base();
    bad.explain.docs.signals = [];
    expect(validateDwsRecord(bad).some((i) => i.includes('explain.docs.signals'))).toBe(true);
  });

  it('扣分码不在词表', () => {
    const bad = base();
    bad.explain.spec.deductions.push({ code: 'S9', reason: '伪造码', delta: 0.1 });
    expect(validateDwsRecord(bad).some((i) => i.includes('不在词表'))).toBe(true);
  });

  it('扣分理由为空 / delta 非法', () => {
    const bad = base();
    bad.explain.docs.deductions.push({ code: 'D1', reason: '', delta: 2 });
    const issues = validateDwsRecord(bad);
    expect(issues.some((i) => i.includes('扣分理由为空'))).toBe(true);
    expect(issues.some((i) => i.includes('扣分 delta 非法'))).toBe(true);
  });
});

describe('expectedTotal：权重口径互证（规格 §5.1）', () => {
  it('全维可算 = 加权平均；冷启动重归一化后两位小数', () => {
    expect(expectedTotal({ spec: 1, maintenance: 1, docs: 0.5, security: 1, ecosystem: 1 })).toBe(
      0.9,
    ); // 1 − .20×.5
    // 生态置空：可用权重 .85；(.25+.20+.20×.5+.20)/.85 = .75/.85 = .88235… → 0.88
    expect(
      expectedTotal({ spec: 1, maintenance: 1, docs: 0.5, security: 1, ecosystem: null }),
    ).toBe(0.88);
  });
});

describe('dwsJsonl / writeDwsJsonl / adsQualityOf', () => {
  it('JSONL 一行一记录、无尾空行、可逐行回读', () => {
    const jsonl = dwsJsonl(records());
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(records().length);
    expect(lines.every((l) => l.startsWith('{') && l.endsWith('}'))).toBe(true);
  });

  it('落盘产物：sha256 与内容互证（证据 JSON 口径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dws-mk03-'));
    const out = join(dir, 'dws', 'asset_quality.jsonl');
    const artifact = writeDwsJsonl(out, records());
    const payload = readFileSync(out, 'utf8');
    expect(artifact.sha256).toBe(sha256Hex(payload));
    expect(artifact.length).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(payload.endsWith('\n')).toBe(true);
  });

  it('ADS quality 投影：五维 + explain + 置信 + 冷启动标记（规格 §1.2）', () => {
    const record = records()[0] as AssetQualityRecord;
    const quality = adsQualityOf(record);
    expect(Object.keys(quality)).toEqual(['score', 'confidence', 'coldStart', 'dims', 'explain']);
    expect(quality.dims).toEqual(record.dims);
    expect(quality.explain.spec).toEqual(record.explain.spec);
  });
});
