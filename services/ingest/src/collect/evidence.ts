/**
 * 证据 JSON 组装（《市场首实现》§6.2 `df.market.evidence/v1`）。
 *
 * 口径：每个 step 对应判据链一环；`verdict=blocked` → `exitCode=2`；
 * 任一断言不成立 → 该步 fail → `exitCode=1`；全过 → `0`（禁止假绿）。
 */

import type { Evidence, EvidenceStep, ExitCode } from './types.ts';

export const COLLECTOR_NAME = 'df-market-collect';
export const COLLECTOR_VERSION = '0.1.0';

export interface EvidenceInput {
  runId: string;
  asOf: string;
  offline: boolean;
  steps: EvidenceStep[];
}

/** 汇总 exitCode：blocked > fail > pass（规格 §6.1 退出码语义）。 */
export function exitCodeOf(steps: EvidenceStep[]): ExitCode {
  if (steps.some((s) => s.verdict === 'blocked')) return 2;
  if (steps.some((s) => s.verdict === 'fail')) return 1;
  return 0;
}

/** 组装证据 JSON（step 的 verdict 由断言结果推导：非 blocked 的 step 全过才 pass）。 */
export function buildEvidence(input: EvidenceInput): Evidence {
  const steps: EvidenceStep[] = input.steps.map((step) => {
    if (step.verdict === 'blocked') return step;
    const ok = step.assertions.every((a) => a.ok);
    return { ...step, verdict: ok ? 'pass' : 'fail' };
  });
  return {
    schema: 'df.market.evidence/v1',
    runId: input.runId,
    asOf: input.asOf,
    offline: input.offline,
    collector: { name: COLLECTOR_NAME, version: COLLECTOR_VERSION },
    steps,
    exitCode: exitCodeOf(steps),
  };
}
