/**
 * DWD 输入归一化与校验单测（MK-03 对接面）。
 *
 * 断言口径：MK-02 真实 DWD 产物按规格 §4.4 落地后，本模块负责「宽松读入（可选字段补 null）、
 * 严格必填（必填缺失即拒）」，并守住两条诚实性纪律：缺 `text` 抽取组要报错、
 * `compliance` 缺失不默认 `ok`。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';
import { DwdShapeError, normalizeDwdAsset, validateDwdAsset } from './dwd.ts';

/** 合法基础记录（可覆盖字段）。 */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset: {
      id: 'gh:acme/skills#skills/pdf',
      kind: 'skill',
      name: 'pdf',
      ref: 'a'.repeat(40),
      path: 'skills/pdf',
      compliance: 'ok',
      capabilitiesDeclared: true,
      capabilities: ['prompt:inject'],
    },
    repo: {
      repoId: 1,
      fullName: 'acme/skills',
      stars: 10,
      forks: 1,
      pushedAt: '2026-10-01T00:00:00Z',
      createdAt: '2025-01-01T00:00:00Z',
      archived: false,
      fork: false,
    },
    license: {
      spdx: 'MIT',
      gate: 'loadable',
      evidence: { path: 'LICENSE', sha256: 'e'.repeat(64) },
    },
    files: { truncated: false, entries: [{ path: 'SKILL.md', size: 10, sha256: 'f'.repeat(64) }] },
    text: { frontmatter: { name: 'pdf', description: 'Use when needed' } },
    ...overrides,
  };
}

describe('validateDwdAsset / normalizeDwdAsset', () => {
  it('四类样本夹具逐条通过校验（四类各 1 + 边界 2）', () => {
    for (const sample of SAMPLE_DWD) {
      expect(validateDwdAsset(sample)).toEqual([]);
      // 归一化幂等：夹具已是 DwdAsset 形状。
      expect(normalizeDwdAsset(sample)).toEqual(sample);
    }
  });

  it('缺必填 → 问题清单逐条列出字段路径', () => {
    const broken = raw({ repo: { stars: 1 } });
    const issues = validateDwdAsset(broken);
    expect(issues.some((i) => i.startsWith('repo.repoId'))).toBe(true);
    expect(issues.some((i) => i.startsWith('repo.pushedAt'))).toBe(true);
    expect(issues.some((i) => i.startsWith('repo.archived'))).toBe(true);
    expect(() => normalizeDwdAsset(broken)).toThrow(DwdShapeError);
  });

  it('缺 text 抽取组 → 明确报错（不允许五维静默塌陷）', () => {
    const { text: _text, ...rest } = raw();
    const issues = validateDwdAsset(rest);
    expect(issues.some((i) => i.includes('text 缺失'))).toBe(true);
  });

  it('可选字段缺失 → 补 null，不参与加权（不抛错）', () => {
    const normalized = normalizeDwdAsset(raw());
    expect(normalized.trend).toEqual({ stars90dAgo: null, referencedBy: null });
    expect(normalized.repo.commits90d).toBeNull();
    expect(normalized.repo.lastReleaseAt).toBeNull();
    expect(normalized.text.readme).toBeNull();
    expect(normalized.text.manifest).toBeNull();
    expect(normalized.files.truncated).toBe(false);
  });

  it('compliance 缺失 → 归为 deferred（不默认 ok 假装可信）', () => {
    const base = raw();
    (base['asset'] as Record<string, unknown>)['compliance'] = undefined;
    const normalized = normalizeDwdAsset(base);
    expect(normalized.asset.compliance).toBe('deferred');
    const { records } = scoreBatch([normalized], { asOf: AS_OF });
    expect(records[0]?.confidence).toBe('low');
  });

  it('归一化后可直接进评分器（端到端闭环）', () => {
    const normalized = normalizeDwdAsset(raw());
    const { records } = scoreBatch([normalized], { asOf: AS_OF });
    expect(records).toHaveLength(1);
    expect(records[0]?.schema).toBe('df.market.dws.asset_quality/v1');
  });
});
