/**
 * 证据 JSON（`df.market.evidence/v1`，判据链口径承《市场首实现》§6.2）。
 *
 * 与 MK-01 `collect/evidence.ts` 同族实现（两票并行落地，形状逐字一致）；
 * 收尾合并后可与采集侧统一为一份公共实现——在此之前各自独立，避免跨目录耦合。
 * 退出码语义（§6.1）：blocked → 2；任一断言失败 → 1；全过 → 0。禁止假绿。
 */

/** 一条断言。 */
export interface EvidenceAssertion {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/** 判据链一步。 */
export interface EvidenceStep {
  id: string;
  name: string;
  verdict: 'pass' | 'fail' | 'blocked';
  assertions: EvidenceAssertion[];
  artifacts: { path: string; sha256: string; length: number }[];
  metrics: Record<string, number | string | null>;
}

/** 证据 JSON。 */
export interface Evidence {
  schema: 'df.market.evidence/v1';
  runId: string;
  asOf: string;
  offline: boolean;
  collector: { name: string; version: string };
  steps: EvidenceStep[];
  exitCode: 0 | 1 | 2;
}

/** 汇总退出码：blocked > fail > pass。 */
export function exitCodeOf(steps: readonly EvidenceStep[]): 0 | 1 | 2 {
  if (steps.some((s) => s.verdict === 'blocked')) return 2;
  if (steps.some((s) => s.verdict === 'fail')) return 1;
  return 0;
}

export interface EvidenceInput {
  runId: string;
  asOf: string;
  offline: boolean;
  collector: { name: string; version: string };
  steps: readonly EvidenceStep[];
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
    collector: input.collector,
    steps,
    exitCode: exitCodeOf(steps),
  };
}
