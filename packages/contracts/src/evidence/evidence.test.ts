import { describe, expect, it } from 'vitest';

import { createFunctionalEvidence, isEvidenceJson } from './index.ts';

describe('evidence · 验收证据 JSON（标准 §4 字段）', () => {
  it('功能证据骨架字段完备且可通过校验', () => {
    const evidence = createFunctionalEvidence({
      page: 'verify-daemon',
      exitCode: 0,
      steps: [{ id: 'documents.list', ok: true, detail: '200 ok' }],
      meta: { runsOn: 'node24' },
    });
    expect(isEvidenceJson(evidence)).toBe(true);
    expect(evidence.diff).toEqual({ bbox: null, diffPixels: 0, ratio: 0 });
    expect(evidence.artifacts).toEqual({ ref: null, actual: null, diff: null });
    expect(evidence.humanReview.verdict).toBeNull();
    expect(evidence.level).toBe('A');
  });

  it('退出码三态（0/1/2）合法，其他拒绝', () => {
    const blocked = createFunctionalEvidence({ page: 'verify-daemon', exitCode: 2, steps: [] });
    expect(isEvidenceJson(blocked)).toBe(true);
    expect(isEvidenceJson({ ...blocked, exitCode: 3 })).toBe(false);
  });

  it('缺 humanReview / artifacts / diff 即不合法', () => {
    const evidence = createFunctionalEvidence({ page: 'x', exitCode: 1, steps: [] });
    const { humanReview: _dropped, ...withoutReview } = evidence;
    expect(isEvidenceJson(withoutReview)).toBe(false);
  });
});
