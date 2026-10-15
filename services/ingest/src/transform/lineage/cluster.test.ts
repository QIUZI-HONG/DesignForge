/**
 * 同源聚合与近重复测试（规格 §2.6）。
 *
 * 断言外部行为：簇归属、依据（reason）、人工队列与确定性；正文按 5KB 分档走不同算法路径。
 */

import { describe, expect, it } from 'vitest';

import {
  assignClusters,
  type ClusterAssetInput,
  clusterIdOf,
  hammingDistance,
  jaccard,
  minhashSignature,
  signatureSimilarity,
  simhash64,
} from './cluster.ts';

/** 构造一份可读且长度受控的正文（用于近重复分档）。 */
function bodyOf(paragraphs: number, marker: string): string {
  const lines: string[] = [];
  for (let index = 0; index < paragraphs; index += 1) {
    lines.push(`步骤 ${index}：${marker} 说明文本，包含足够的字符以形成 shingle 特征。`);
  }
  return lines.join('\n');
}

function asset(overrides: Partial<ClusterAssetInput> & { assetId: string }): ClusterAssetInput {
  return {
    kind: 'skill',
    root: '',
    filePaths: [],
    bodyText: null,
    upstream: null,
    ...overrides,
  };
}

describe('相似度原语', () => {
  it('jaccard：交集/并集，空集对空集为 1', () => {
    expect(jaccard(['a', 'b', 'c'], ['a', 'b'])).toBeCloseTo(2 / 3, 10);
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
  });

  it('simhash64：相同文本距离 0；无关文本距离显著更大', () => {
    const textA = bodyOf(40, '甲');
    const textASame = bodyOf(40, '甲');
    const textB = bodyOf(40, '乙')
      .replace(/步骤/g, 'chapter')
      .replace(/说明文本/g, 'explanation');
    expect(hammingDistance(simhash64(textA), simhash64(textASame))).toBe(0);
    expect(hammingDistance(simhash64(textA), simhash64(textB))).toBeGreaterThan(16);
  });

  it('minhash 签名：同一文本相似度 1；签名维度固定', () => {
    const signature = minhashSignature(bodyOf(200, '甲'));
    expect(signature.length).toBe(128);
    expect(signatureSimilarity(signature, minhashSignature(bodyOf(200, '甲')))).toBe(1);
  });

  it('clusterIdOf：与成员顺序无关，多成员与单成员不同', () => {
    expect(clusterIdOf(['a', 'b'])).toBe(clusterIdOf(['b', 'a']));
    expect(clusterIdOf(['a', 'b'])).not.toBe(clusterIdOf(['a']));
    expect(clusterIdOf(['a', 'b'])).toMatch(/^cl-[0-9a-f]{16}$/);
  });
});

describe('assignClusters（规格 §2.6）', () => {
  it('精确重复（含 BOM 与许可头差异）→ 同簇且 reason=exact-dup', () => {
    const shared = bodyOf(20, '同源');
    const result = assignClusters([
      asset({ assetId: 'gh:o/r#a', bodyText: `\uFEFF${shared}` }),
      asset({ assetId: 'gh:o/r#b', bodyText: `<!-- SPDX-License-Identifier: MIT -->\n${shared}` }),
    ]);
    const a = result.assignments.get('gh:o/r#a');
    const b = result.assignments.get('gh:o/r#b');
    expect(a?.clusterId).toBe(b?.clusterId);
    expect(a?.clusterSize).toBe(2);
    expect(a?.reason).toBe('exact-dup');
    expect(result.pairReports.some((pair) => pair.reason === 'exact-dup')).toBe(true);
  });

  it('upstream 相同 → 必进同簇（规格 §2.6.3）', () => {
    const result = assignClusters([
      asset({
        assetId: 'gh:o/fork-a#',
        upstream: 'zarazhangrui/beautiful-html-templates',
        kind: 'template',
      }),
      asset({
        assetId: 'gh:o/fork-b#',
        upstream: 'Zarazhangrui/Beautiful-HTML-Templates',
        kind: 'template',
      }),
    ]);
    expect(result.assignments.get('gh:o/fork-a#')?.clusterId).toBe(
      result.assignments.get('gh:o/fork-b#')?.clusterId,
    );
    expect(result.assignments.get('gh:o/fork-a#')?.reason).toBe('upstream');
  });

  it('目录指纹 ≥0.9 → 自动合并 fingerprint；<0.7 → 各自单例', () => {
    const files = Array.from({ length: 10 }, (_, index) => `f${index}.md`);
    const merged = assignClusters([
      asset({ assetId: 'gh:o/r#k1', kind: 'template', filePaths: files }),
      asset({ assetId: 'gh:o/r#k2', kind: 'template', filePaths: [...files, 'extra.md'] }),
      asset({ assetId: 'gh:o/r#k3', kind: 'template', filePaths: ['other/x.md'] }),
    ]);
    const k1 = merged.assignments.get('gh:o/r#k1');
    const k2 = merged.assignments.get('gh:o/r#k2');
    const k3 = merged.assignments.get('gh:o/r#k3');
    expect(k1?.clusterId).toBe(k2?.clusterId);
    expect(k1?.clusterSize).toBe(2);
    expect(k1?.reason).toBe('fingerprint');
    expect(k3?.clusterSize).toBe(1);
    expect(k3?.reason).toBe('singleton');
    expect(k3?.reviewQueue).toBe(false);
  });

  it('目录指纹 0.7–0.9 → 进人工队列（不自动合并）', () => {
    const base = Array.from({ length: 10 }, (_, index) => `f${index}.md`);
    const other = [...base.slice(0, 8), 'x1.md']; // 8/11 ≈ 0.73
    const unrelated = ['y1.md', 'y2.md', 'y3.md'];
    const result = assignClusters([
      asset({ assetId: 'gh:o/r#p1', kind: 'design-system', filePaths: base }),
      asset({ assetId: 'gh:o/r#p2', kind: 'design-system', filePaths: other }),
      asset({ assetId: 'gh:o/r#p3', kind: 'design-system', filePaths: unrelated }),
    ]);
    const p1 = result.assignments.get('gh:o/r#p1');
    const p2 = result.assignments.get('gh:o/r#p2');
    expect(p2?.reviewQueue).toBe(true);
    expect(p2?.reviewWith).toContain('gh:o/r#p1');
    expect(p1?.reviewWith).toContain('gh:o/r#p2');
    expect(p2?.clusterSize).toBe(1);
    expect(result.pairReports.some((pair) => pair.reason === 'manual-review')).toBe(true);
  });

  it('≤5KB 正文走 SimHash：近似副本同簇，无关正文不同簇', () => {
    const base = bodyOf(40, '甲');
    const near = `${bodyOf(40, '甲')}\n补充一行。`;
    const far = Array.from(
      { length: 60 },
      () => 'zebra quartz violet xylophone glyph nimbus obelisk',
    ).join('\n');
    const result = assignClusters([
      asset({ assetId: 'gh:o/r#s1', bodyText: base }),
      asset({ assetId: 'gh:o/r#s2', bodyText: near }),
      asset({ assetId: 'gh:o/r#s3', bodyText: far }),
    ]);
    expect(result.assignments.get('gh:o/r#s1')?.clusterId).toBe(
      result.assignments.get('gh:o/r#s2')?.clusterId,
    );
    expect(result.assignments.get('gh:o/r#s3')?.clusterId).not.toBe(
      result.assignments.get('gh:o/r#s1')?.clusterId,
    );
    expect(result.assignments.get('gh:o/r#s1')?.reason).toBe('near-dup');
  });

  it('>5KB 正文走 MinHash+LSH：99% 相同正文同簇', () => {
    const base = bodyOf(300, '甲乙丙丁戊'); // >5KB
    const near = `${bodyOf(300, '甲乙丙丁戊')}\n仅追加一行尾注。`;
    expect(Buffer.byteLength(base, 'utf8')).toBeGreaterThan(5 * 1024);
    const result = assignClusters([
      asset({ assetId: 'gh:o/r#m1', bodyText: base }),
      asset({ assetId: 'gh:o/r#m2', bodyText: near }),
    ]);
    expect(result.assignments.get('gh:o/r#m1')?.clusterId).toBe(
      result.assignments.get('gh:o/r#m2')?.clusterId,
    );
    expect(result.assignments.get('gh:o/r#m1')?.reason).toBe('near-dup');
    const report = result.pairReports.find((pair) => pair.reason === 'near-dup');
    expect(report?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('确定性：打乱输入顺序 → 分配结果完全一致', () => {
    const inputs = [
      asset({ assetId: 'gh:o/r#z1', bodyText: bodyOf(30, '甲') }),
      asset({ assetId: 'gh:o/r#z2', bodyText: bodyOf(30, '甲') }),
      asset({ assetId: 'gh:o/r#z3', kind: 'template', filePaths: ['a.md', 'b.md'] }),
      asset({ assetId: 'gh:o/r#z4', kind: 'template', filePaths: ['a.md', 'b.md', 'c.md'] }),
    ];
    const forward = assignClusters(inputs);
    const backward = assignClusters([...inputs].reverse());
    for (const id of ['gh:o/r#z1', 'gh:o/r#z2', 'gh:o/r#z3', 'gh:o/r#z4']) {
      expect(backward.assignments.get(id)?.clusterId).toBe(forward.assignments.get(id)?.clusterId);
      expect(backward.assignments.get(id)?.reason).toBe(forward.assignments.get(id)?.reason);
    }
  });
});
