import { describe, expect, it } from 'vitest';

import { validateMarketplaceIndex } from './schema.ts';

/** 一个严格合法的索引样本（规格 §1 逐字段）。 */
function validIndex(): Record<string, unknown> {
  return {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-15T12:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: '20261015-2201',
      odsWatermark: '2026-10-15T22:00:00Z',
    },
    counts: {
      total: 1,
      byKind: { skill: 1, plugin: 0, 'design-system': 0, template: 0 },
      loadable: 1,
    },
    assets: [
      {
        id: 'gh:anthropics/skills#skills/pdf',
        kind: 'skill',
        name: 'pdf',
        displayName: { 'zh-CN': 'PDF 处理', en: 'PDF' },
        summary: { 'zh-CN': '处理 PDF 文件的技能', en: 'Work with PDF files' },
        source: {
          repo: 'anthropics/skills',
          repoId: 123456789,
          path: 'skills/pdf',
          ref: 'a'.repeat(40),
          fetchedAt: '2026-10-15T22:05:11Z',
          license: {
            spdx: 'MIT',
            gate: 'loadable',
            evidence: { path: 'LICENSE', sha256: `sha256:${'b'.repeat(64)}` },
          },
          stars: 1234,
          pushedAt: '2026-10-01T09:00:00Z',
          archived: false,
          homepage: null,
          upstream: null,
          brandDerived: false,
        },
        capabilities: ['prompt:inject'],
        facets: { category: '其他', lane: 'create', mode: 'utility', tags: ['pdf'], scenes: [] },
        quality: {
          // 权重口径（规格 §5.1）：.25/.20/.20/.20/.15 → 0.225+0.16+0.16+0.2+0.105 = 0.85
          score: 0.85,
          dims: { spec: 0.9, maintenance: 0.8, docs: 0.8, security: 1, ecosystem: 0.7 },
        },
        installGate: {
          mode: 'loadable',
          licenseGate: 'loadable',
          security: 'pass',
          reasons: [],
          ackRequired: [],
        },
        digest: `sha256:${'c'.repeat(64)}`,
        embeddingRef: null,
        yanked: null,
      },
    ],
  };
}

/** 取深拷贝并施加一条变更（正反例共用同一样本，改动点单点突出）。 */
function mutate(change: (index: Record<string, unknown>) => void): Record<string, unknown> {
  const index = structuredClone(validIndex());
  change(index);
  return index;
}

/** 便捷取 assets[0]（测试内断言用）。 */
function asset0(index: Record<string, unknown>): Record<string, unknown> {
  return (index.assets as Record<string, unknown>[])[0] as Record<string, unknown>;
}

describe('validateMarketplaceIndex · 正例', () => {
  it('逐字段合法的索引通过校验', () => {
    const result = validateMarketplaceIndex(validIndex());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('可选字段缺省（description/version/metrics）仍通过', () => {
    const index = mutate((draft) => {
      const asset = asset0(draft);
      expect(asset).not.toHaveProperty('version');
      expect(asset).not.toHaveProperty('metrics');
    });
    expect(validateMarketplaceIndex(index).ok).toBe(true);
  });

  it('未知顶层字段被忽略（前向兼容 §1.5）', () => {
    const index = mutate((draft) => {
      draft.futureField = { anything: true };
    });
    expect(validateMarketplaceIndex(index).ok).toBe(true);
  });
});

describe('validateMarketplaceIndex · 反例（结构）', () => {
  it('schema 标识不匹配 → schema-mismatch', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        draft.schema = 'df.marketplace.index/v2';
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain('schema-mismatch');
  });

  it('缺 counts → missing-field 且 path 指向字段', () => {
    const result = validateMarketplaceIndex(mutate((draft) => void delete draft.counts));
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'missing-field', path: 'counts' }),
    ]);
  });

  it('缺 yanked（必填可空）→ missing-field', () => {
    const result = validateMarketplaceIndex(mutate((draft) => void delete asset0(draft).yanked));
    expect(result.errors.map((issue) => issue.code)).toContain('missing-field');
    expect(result.errors.some((issue) => issue.path === 'assets[0].yanked')).toBe(true);
  });

  it('summary 非对象 → invalid-type', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).summary = '纯字符串';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-type');
  });

  it('embeddingRef 非 null（首版恒 null）→ invalid-value', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).embeddingRef = 'vec:123';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-value');
  });

  it('id 与 source.repo/path 不一致 → id-source-mismatch', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).id = 'gh:other/repo#skills/pdf';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('id-source-mismatch');
  });

  it('两条资产同 id → duplicate-id', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (draft.assets as unknown[]).push(structuredClone(asset0(draft)));
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('duplicate-id');
  });
});

describe('validateMarketplaceIndex · 反例（枚举/格式/范围）', () => {
  it('未知 kind → 严格模式 invalid-enum', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).kind = 'widget';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-enum');
  });

  it('未知 category 在宽松模式降为 warning（§1.5：未知枚举归 other，不得报错退出）', () => {
    const index = mutate((draft) => {
      (asset0(draft).facets as Record<string, unknown>).category = '未来品类';
    });
    expect(validateMarketplaceIndex(index).errors.map((issue) => issue.code)).toContain(
      'invalid-enum',
    );
    const lenient = validateMarketplaceIndex(index, { mode: 'forward-compatible' });
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.map((issue) => issue.code)).toContain('invalid-enum');
  });

  it('未知 lane → invalid-enum', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (asset0(draft).facets as Record<string, unknown>).lane = 'publish';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-enum');
  });

  it('digest 非 sha256:hex → invalid-format', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).digest = 'sha1:abc';
      }),
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'invalid-format', path: 'assets[0].digest' }),
    ]);
  });

  it('source.ref 非 40 位 hex → invalid-format', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (asset0(draft).source as Record<string, unknown>).ref = 'a1b2c3';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-format');
  });

  it('generatedAt 非 ISO8601 → invalid-format', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        draft.generatedAt = '2026/10/15';
      }),
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'invalid-format', path: 'generatedAt' }),
    ]);
  });

  it('维度分越界（>1）→ invalid-range', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        const quality = asset0(draft).quality as Record<string, unknown>;
        const dims = quality.dims as Record<string, unknown>;
        dims.spec = 1.5;
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('invalid-range');
  });
});

describe('validateMarketplaceIndex · 反例（自洽性）', () => {
  it('counts.total 与 assets 长度不符 → counts-mismatch', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (draft.counts as Record<string, unknown>).total = 2;
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('counts-mismatch');
  });

  it('byKind 分项数与资产实际不符 → counts-mismatch', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        const counts = draft.counts as Record<string, unknown>;
        const byKind = counts.byKind as Record<string, unknown>;
        byKind.skill = 0;
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('counts-mismatch');
  });

  it('counts.loadable 与 installGate.mode 实际不符 → counts-mismatch', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (draft.counts as Record<string, unknown>).loadable = 0;
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('counts-mismatch');
  });

  it('出现 installGate.mode=blocked 的资产 → blocked-present（§1.1 不得出现）', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        const gate = asset0(draft).installGate as Record<string, unknown>;
        gate.mode = 'blocked';
        gate.licenseGate = 'blocked';
      }),
    );
    expect(result.errors.map((issue) => issue.code)).toContain('blocked-present');
  });
});

describe('validateMarketplaceIndex · warning（不拦截，但如实记录）', () => {
  it('quality.score 与加权分不符 → score-mismatch（warning）', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        (asset0(draft).quality as Record<string, unknown>).score = 0.3;
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain('score-mismatch');
  });

  it('tags 超过 10 个 → tags-overflow（warning）', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        const facets = asset0(draft).facets as Record<string, unknown>;
        facets.tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain('tags-overflow');
  });

  it('能力词表外的 capability → unknown-capability（warning）', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).capabilities = ['prompt:inject', 'fs:nuke'];
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain('unknown-capability');
  });

  it('中英双语皆空的 displayName → empty-localized（warning）', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        asset0(draft).displayName = {};
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain('empty-localized');
  });
});

describe('validateMarketplaceIndex · 边界', () => {
  it('空索引（assets 为空数组、counts 全 0）合法', () => {
    const result = validateMarketplaceIndex(
      mutate((draft) => {
        draft.assets = [];
        draft.counts = {
          total: 0,
          byKind: { skill: 0, plugin: 0, 'design-system': 0, template: 0 },
          loadable: 0,
        };
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('非对象输入 → schema-mismatch（不抛异常）', () => {
    for (const value of [null, 42, 'df.marketplace.index/v1', []]) {
      const result = validateMarketplaceIndex(value);
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.code)).toContain('schema-mismatch');
    }
  });
});
