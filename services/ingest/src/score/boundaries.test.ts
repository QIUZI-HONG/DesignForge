/**
 * 边界用例（MK-03 · 规格 §5.4 逐条 + brief 清单）。
 *
 * 覆盖：无 license / NOASSERTION / 新资产（无星标无提交历史）/ 单文件资产 /
 * 超大仓（Trees 截断口径）/ 归档仓 / 零采纳老仓 / 合规样本（无 frontmatter）。
 * 断言落在**记录级语义**（dim 分、flags、L1 不扣分、总分重归一化），不是实现细节。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF, daysAgo, file, makeDwd } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';
import type { AssetQualityRecord, DwdAsset } from './types.ts';

/** 单资产批（n=1 分位）。 */
function scoreOne(input: DwdAsset): AssetQualityRecord {
  const record = scoreBatch([input], { asOf: AS_OF }).records[0];
  if (record === undefined) throw new Error('未产出记录');
  return record;
}

/** 无 LICENSE 文件、其余健康的文件清单。 */
const FILES_WITHOUT_LICENSE = [
  file('SKILL.md'),
  file('references/api.md'),
  file('preview/hero.png'),
  file('.github/workflows/ci.yml'),
];

describe('边界 · 无 license / NOASSERTION（规格 §5.4：不从安全性扣分）', () => {
  it('无 license（gate=blocked）：security 满分，仅 L1 说明（delta 0）', () => {
    const record = scoreOne(
      makeDwd({
        license: { spdx: null, gate: 'blocked', evidence: { path: null, sha256: null } },
        files: { truncated: false, entries: FILES_WITHOUT_LICENSE },
      }),
    );
    expect(record.dims.security).toBe(1);
    expect(record.explain.security.deductions).toEqual([
      { code: 'L1', reason: '许可档非可装载（不扣分，走守门，§7.2）', delta: 0 },
    ]);
    // 文档维照扣 D5（许可说明不清），总分应为 0.98：.25+.20+.20×.91+.20+.15
    expect(record.score).toBe(0.98);
    expect(record.explain.docs.deductions.some((d) => d.code === 'D5')).toBe(true);
  });

  it('NOASSERTION（样本 notes-bridge）：security 满分、docs 扣 D5、confidence 不降', () => {
    const record = scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records.find((r) =>
      r.assetId.endsWith('notes-bridge'),
    );
    expect(record?.dims.security).toBe(1);
    expect(record?.explain.security.deductions[0]?.code).toBe('L1');
    expect(record?.confidence).toBe('high');
  });
});

describe('边界 · 新资产与零采纳（规格 §5.4：spec + maintenance 托底）', () => {
  it('新资产（12 天、零星）→ 生态热度空心、总分按可用权重归一化', () => {
    const record = scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records.find((r) => r.flags.coldStart);
    expect(record).toBeDefined();
    expect(record?.dims.ecosystem).toBeNull();
    expect(record?.score).toBe(1); // 其余四维全满 → 不因零采纳挨 0 分
    expect(record?.flags.nonCompliant).toBe(false);
  });

  it('零采纳老仓（800 天、无星无 fork 无引用）→ 同样走冷启动托底', () => {
    const record = scoreOne(
      makeDwd({
        repo: { createdAt: daysAgo(800), stars: 0, forks: 0 },
        trend: { stars90dAgo: null, referencedBy: 0 },
      }),
    );
    expect(record.flags.coldStart).toBe(true);
    expect(record.dims.ecosystem).toBeNull();
    expect(record.score).toBe(1);
  });
});

describe('边界 · 单文件资产（资产根只有一个 SKILL.md）', () => {
  it('文档维塌到 0.06、maintenance 缺 CI、总分 0.71（手算）', () => {
    const record = scoreOne(
      makeDwd({
        files: { truncated: false, entries: [file('SKILL.md')] },
        text: { readme: null, changelog: null },
        license: { spdx: null, gate: 'blocked', evidence: { path: null, sha256: null } },
      }),
    );
    expect(record.dims.spec).toBe(0.875); // 缺 references/ 或 examples/（.10/.80）
    expect(record.dims.maintenance).toBe(0.65); // 缺 CI
    expect(record.dims.docs).toBe(0.06); // D1+D2+D3+D4+D5 全中（.30+.30+.15+.10+.09）
    expect(record.dims.security).toBe(1); // 许可不进安全维
    expect(record.score).toBe(0.71); // .25×.875+.20×.65+.20×.06+.20×1+.15×1 = .71075
    expect(record.flags.filesTruncated).toBe(false);
  });
});

describe('边界 · 超大仓（Trees 截断口径）', () => {
  it('文件级「不存在」不可证明 → 相关信号置 null 且不扣分；文本信号照判', () => {
    const record = scoreOne(makeDwd({ files: { truncated: true, entries: [file('SKILL.md')] } }));
    expect(record.flags.filesTruncated).toBe(true);
    const nullSignals: [string, string][] = [
      ['spec', 'spec.aux-dirs'],
      ['maintenance', 'maintenance.ci'],
      ['docs', 'docs.preview'],
      ['security', 'security.install-scripts'],
    ];
    for (const [dim, code] of nullSignals) {
      const signal = record.explain[dim as keyof typeof record.explain].signals.find(
        (s) => s.code === code,
      );
      expect(signal?.score, `${code} 应为 null`).toBeNull();
    }
    // 文本抽取（README/正文/清单）是实际读取结果，按真值处理（口径线见 dim-docs 头注释）。
    expect(record.score).toBe(1);
  });
});

describe('边界 · 归档仓与合规样本（规格 §5.4）', () => {
  it('归档仓：maintenance 封顶 0.30 + M7，flags.archived=true', () => {
    const record = scoreOne(makeDwd({ repo: { archived: true } }));
    expect(record.dims.maintenance).toBe(0.3);
    expect(record.flags.archived).toBe(true);
    expect(record.explain.maintenance.deductions[0]?.code).toBe('M7');
    expect(record.score).toBe(0.86); // .25+.20×.3+.20+.20+.15
  });

  it('合规样本（无 frontmatter 的模板）：spec 走低、confidence=low', () => {
    const record = scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records.find(
      (r) => r.flags.nonCompliant,
    );
    expect(record?.confidence).toBe('low');
    expect(record?.dims.spec).toBeLessThan(0.6);
  });
});
