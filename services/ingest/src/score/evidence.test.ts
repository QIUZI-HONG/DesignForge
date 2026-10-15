/**
 * 证据 JSON 单测（MK-03；口径承《市场首实现》§6.2 / 《前端验收标准 v1》§4 同族）。
 *
 * 退出码语义是这层的命门：blocked → 2、任一断言失败 → 1、全过 → 0，禁止假绿。
 */

import { describe, expect, it } from 'vitest';
import type { EvidenceStep } from './evidence.ts';
import { buildEvidence, exitCodeOf } from './evidence.ts';

/** 造一个 step。 */
function step(id: string, verdict: EvidenceStep['verdict'] = 'pass'): EvidenceStep {
  return {
    id,
    name: id,
    verdict,
    assertions: [{ name: 'a', expected: '1', actual: '1', ok: true }],
    artifacts: [],
    metrics: {},
  };
}

describe('exitCodeOf（规格 §6.1 退出码语义）', () => {
  it('全过 → 0；有 fail → 1；有 blocked → 2（blocked 优先）', () => {
    expect(exitCodeOf([step('a'), step('b')])).toBe(0);
    expect(exitCodeOf([step('a'), step('b', 'fail')])).toBe(1);
    expect(exitCodeOf([step('a', 'fail'), step('b', 'blocked')])).toBe(2);
  });

  it('空 steps → 0（无判据则无失败；调用方负责别在无数据时走到这里）', () => {
    expect(exitCodeOf([])).toBe(0);
  });
});

describe('buildEvidence', () => {
  it('verdict 由断言推导：一条不过即 fail', () => {
    const draft = step('x');
    draft.assertions = [
      { name: 'a', expected: '1', actual: '1', ok: true },
      { name: 'b', expected: '2', actual: '3', ok: false },
    ];
    const evidence = buildEvidence({
      runId: 'r1',
      asOf: '2026-10-15T00:00:00Z',
      offline: true,
      collector: { name: 'df-market-score', version: '0.1.0' },
      steps: [draft],
    });
    expect(evidence.schema).toBe('df.market.evidence/v1');
    expect(evidence.steps[0]?.verdict).toBe('fail');
    expect(evidence.exitCode).toBe(1);
  });

  it('blocked 原样保留（即便断言全过）→ exitCode 2', () => {
    const evidence = buildEvidence({
      runId: 'r2',
      asOf: '2026-10-15T00:00:00Z',
      offline: true,
      collector: { name: 'df-market-score', version: '0.1.0' },
      steps: [step('a'), step('blocked-step', 'blocked')],
    });
    expect(evidence.steps[1]?.verdict).toBe('blocked');
    expect(evidence.exitCode).toBe(2);
  });

  it('直接可序列化（JSON round-trip 稳定）', () => {
    const evidence = buildEvidence({
      runId: 'r3',
      asOf: '2026-10-15T00:00:00Z',
      offline: false,
      collector: { name: 'df-market-score', version: '0.1.0' },
      steps: [step('a')],
    });
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});
