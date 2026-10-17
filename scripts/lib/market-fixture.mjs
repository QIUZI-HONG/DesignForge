/**
 * 市场索引审计夹具（#107 · 审计 10a；从审计 04 的一次性脚本抽出）。
 *
 * 单条 view-only 资产的合法索引，仅用于让 `/market` 页面渲染出卡片，
 * 供 axe / 焦点检查有真实目标；**不代表真实采集数据**。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 在数据根下写 `market/df.marketplace.index.v1.json`。 */
export function seedMarketIndex(dataRoot) {
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  const fixture = {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-16T00:00:00.000Z',
    collector: { name: 'audit-04-fixture', version: '0.0.0', runId: 'aud-04', odsWatermark: '' },
    counts: {
      total: 1,
      byKind: { skill: 1, plugin: 0, 'design-system': 0, template: 0 },
      loadable: 0,
    },
    assets: [
      {
        id: 'gh:audit-fixture/skills#skills/slide-deck',
        kind: 'skill',
        name: 'slide-deck',
        displayName: { 'zh-CN': '幻灯片演示技能', en: 'Slide deck skill' },
        summary: { 'zh-CN': '审计用市场夹具（不代表真实采集数据）', en: 'Audit fixture' },
        description: '审计 04 夹具：仅用于市场页 axe 与焦点检查。',
        source: {
          repo: 'audit-fixture/skills',
          repoId: 1,
          path: 'skills/slide-deck',
          ref: 'abcdef1234567890',
          fetchedAt: '2026-10-16T00:00:00.000Z',
          license: { spdx: 'MIT', gate: 'view-only', evidence: { path: 'LICENSE', sha256: '' } },
          stars: 1,
          pushedAt: '2026-10-16T00:00:00.000Z',
          archived: false,
        },
        capabilities: [],
        facets: { category: '其他', lane: 'create', mode: null, tags: [], scenes: [] },
        quality: { score: 70, dims: {} },
        installGate: {
          mode: 'view-only',
          licenseGate: 'view-only',
          security: 'pass',
          reasons: [],
          ackRequired: [],
        },
        digest: 'audit-04-fixture',
      },
    ],
  };
  writeFileSync(
    join(marketDir, 'df.marketplace.index.v1.json'),
    `${JSON.stringify(fixture, null, 2)}\n`,
    'utf8',
  );
}
