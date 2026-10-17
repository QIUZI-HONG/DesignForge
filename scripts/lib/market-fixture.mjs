/**
 * 市场索引审计夹具（#107 · 审计 10a；从审计 04 的一次性脚本抽出）。
 *
 * 单条 view-only 资产的合法索引，仅用于让 `/market` 页面渲染出卡片，
 * 供 axe / 焦点检查有真实目标；**不代表真实采集数据**。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 市场索引文件名（daemon 候选路径 `<数据根>/market/df.marketplace.index.v1.json`）。 */
export const MARKET_INDEX_FILENAME = 'df.marketplace.index.v1.json';

/**
 * 把任意市场索引写到数据根（e2e 大索引与审计单条夹具共用落盘口径）。
 *
 * 抽出的原因：`market-pagination` 场景与审计夹具此前各写一份 `seedMarketIndex`，
 * 目录、文件名、JSON 缩进任一处漂移都会让「daemon 读不到索引」在两处分别现形。
 *
 * @param {string} dataRoot 数据根
 * @param {unknown} index 合法市场索引（`df.marketplace.index/v1`）
 */
export function writeMarketIndex(dataRoot, index) {
  const marketDir = join(dataRoot, 'market');
  mkdirSync(marketDir, { recursive: true });
  writeFileSync(
    join(marketDir, MARKET_INDEX_FILENAME),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}

/** 在数据根下写 `market/df.marketplace.index.v1.json`（单条 view-only 审计夹具）。 */
export function seedMarketIndex(dataRoot) {
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
  writeMarketIndex(dataRoot, fixture);
}
