/**
 * 批处理与确定性单测（MK-03）。
 *
 * 判据（issue #32）：「对固定样本的评分快照测试（**确定性，两次逐字节一致**）」。
 * 本文件三层守住：
 *   1. **语义层**：6 个固定样本的每维分与总分 = 手算表（来自规格 §5.1/§5.2/§5.4，不照抄实现）；
 *   2. **字节层**：同批次跑两次 → JSONL 逐字节一致；
 *   3. **冻结层**：整批 JSONL 的 sha256 冻结为字面量——算法一改就红，逼一次清醒的复核。
 * 另测「输入顺序无关」（分位语境只依赖取值集合，不依赖顺序）。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AS_OF } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';

/** 批次序列化为 JSONL（与 DWS 落盘同形：一行一记录、不留尾空行）。 */
function toJsonl(records: readonly unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n');
}

/** 手算期望表（见各样本推导注释；来源 = 规格条款，不是实现输出）。 */
const EXPECTED = [
  // 健康 skill：五维全满，仅生态热度受批内分位牵制（增速 .40 / fork .80 / 引用 1.00 → .69）
  {
    id: 'gh:anthropics/skills#skills/pdf-export',
    dims: { spec: 1, maintenance: 1, docs: 1, security: 1, ecosystem: 0.69 },
    score: 0.95, // .25+.20+.20+.20+.15×.69 = .9535 → 0.95
    confidence: 'high',
  },
  // plugin：清单齐但缺预览(D3)/changelog(D4) 与权限声明(X2)；生态 .49（增速 .60/fork .40/引用 .40）
  {
    id: 'gh:acme/design-plugins#plugins/brand-kit',
    dims: { spec: 1, maintenance: 1, docs: 0.75, security: 0.7, ecosystem: 0.49 },
    score: 0.81, // .25+.20+.15+.14+.15×.49 = .8135 → 0.81
    confidence: 'high',
  },
  // design-system：缺 CI(M4) 与 changelog(D4)，200 天未更新(M3)；生态 .78
  {
    id: 'gh:acme/tokens#design-systems/atelier',
    dims: { spec: 1, maintenance: 0.2667, docs: 0.9, security: 1, ecosystem: 0.78 },
    score: 0.8, // .25+.20×.2667+.18+.20+.117 = .80034 → 0.80
    confidence: 'high',
  },
  // template：超大仓截断 + 无 frontmatter（不合规样本）；生态 .57
  {
    id: 'gh:acme/deck-templates#templates/deck',
    dims: { spec: 0.5556, maintenance: 1, docs: 1, security: 1, ecosystem: 0.57 },
    score: 0.82, // .25×.5556+.20+.20+.20+.15×.57 = .8244 → 0.82
    confidence: 'low',
  },
  // 边界：无许可原文（NOASSERTION）→ docs 扣 D5(.09)、security 不受影响（L1 delta 0）
  {
    id: 'gh:acme/notes#skills/notes-bridge',
    dims: { spec: 1, maintenance: 1, docs: 0.91, security: 1, ecosystem: 0.63 },
    score: 0.93, // .25+.20+.20×.91+.20+.15×.63 = .9265 → 0.93
    confidence: 'high',
  },
  // 边界：新资产零采纳 → 生态热度置空（空心），总分按可用权重重归一化 = 1.00
  {
    id: 'gh:newbie/one-shot#skills/quick-start',
    dims: { spec: 1, maintenance: 1, docs: 1, security: 1, ecosystem: null },
    score: 1,
    confidence: 'high',
  },
] as const;

describe('scoreBatch：固定样本的手算表（规格 §5.1/§5.2/§5.4）', () => {
  it('6 个样本的每维分与总分逐个对上', () => {
    const { records } = scoreBatch(SAMPLE_DWD, { asOf: AS_OF });
    expect(records).toHaveLength(EXPECTED.length);
    for (const [index, expected] of EXPECTED.entries()) {
      const record = records[index];
      expect(record?.assetId).toBe(expected.id);
      expect(record?.dims).toEqual(expected.dims);
      expect(record?.score).toBe(expected.score);
      expect(record?.confidence).toBe(expected.confidence);
    }
  });

  it('批次摘要：冷启动 1、归档 0、不合规 1、全维可算 5', () => {
    const { summary } = scoreBatch(SAMPLE_DWD, { asOf: AS_OF });
    expect(summary).toEqual({
      total: 6,
      coldStart: 1,
      archived: 0,
      nonCompliant: 1,
      fullyScored: 5,
    });
  });

  it('每维扣分理由都带原因码且 delta ≥ 0（可解释输出齐备）', () => {
    const { records } = scoreBatch(SAMPLE_DWD, { asOf: AS_OF });
    for (const record of records) {
      for (const dim of Object.values(record.explain)) {
        for (const d of dim.deductions) {
          expect(d.code).toMatch(/^[SMDXEL][0-9]+$/);
          expect(d.reason.length).toBeGreaterThan(0);
          expect(d.delta).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('scoreBatch：确定性（两次逐字节一致）', () => {
  it('同输入同输出（JSONL 逐字节一致）', () => {
    const first = toJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records);
    const second = toJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records);
    expect(second).toBe(first);
  });

  it('输入顺序无关（按 id 对齐后逐字节一致）', () => {
    const forward = scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records;
    const reversed = scoreBatch([...SAMPLE_DWD].reverse(), { asOf: AS_OF }).records;
    const byId = (records: readonly { assetId: string }[]) =>
      [...records].sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
    expect(toJsonl(byId(reversed))).toBe(toJsonl(byId(forward)));
  });

  it('空批次：无记录、摘要全零（不抛错）', () => {
    const result = scoreBatch([], { asOf: AS_OF });
    expect(result.records).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      coldStart: 0,
      archived: 0,
      nonCompliant: 0,
      fullyScored: 0,
    });
  });

  it('冻结快照：整批 JSONL 的 sha256 与冻结值一致（改动必须显式复核）', () => {
    const jsonl = toJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records);
    const digest = createHash('sha256').update(jsonl, 'utf8').digest('hex');
    // 冻结值（2026-10-15 · MK-03 初版，已人工复核 6 条记录的每维分与理由）；变更五维算法/原因码/舍入时必须重新复核并更新。
    expect(digest).toBe('d18684acc34cb8ab0bde021667609171a8e5e8d23da689e8a02dbfa359dcf57b');
  });
});
