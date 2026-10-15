import { readFileSync } from 'node:fs';

import type { MarketplaceIndex } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { buildMarketplaceIndex, composeInstallGate } from './build.ts';
import { type DwsAssetRecord, readDwsSample } from './dws.ts';
import { validateMarketplaceIndex } from './schema.ts';

/** 读取自造 DWS 夹具（MK-03 未落地前的输入样本，含质量分与原因码）。 */
function readFixture(): { assets: DwsAssetRecord[]; skipped: number; asOf: string | null } {
  const raw = readFileSync(
    new URL('./__fixtures__/dws-assets.sample.json', import.meta.url),
    'utf8',
  );
  return readDwsSample(JSON.parse(raw));
}

/** 固定的批次元数据（可注入以复现：同输入同输出，§4.3）。 */
const OPTIONS = {
  generatedAt: '2026-10-15T23:00:00Z',
  collector: {
    name: 'df-market',
    version: '0.1.0',
    runId: '20261015-2300',
    odsWatermark: '2026-10-15T22:40:00Z',
  },
};

function buildFromFixture(): MarketplaceIndex {
  const { assets, skipped } = readFixture();
  expect(skipped).toBe(0);
  return buildMarketplaceIndex(assets, OPTIONS);
}

function byId(index: MarketplaceIndex, id: string) {
  const asset = index.assets.find((item) => item.id === id);
  expect(asset, `资产 ${id} 应存在`).toBeDefined();
  return asset as MarketplaceIndex['assets'][number];
}

describe('buildMarketplaceIndex · 夹具产出', () => {
  it('夹具 18 行全部读出（无跳行）', () => {
    const { assets } = readFixture();
    expect(assets).toHaveLength(18);
  });

  it('blocked 资产不出现（brandDerived / yanked），其余 16 条入库', () => {
    const index = buildFromFixture();
    const ids = index.assets.map((asset) => asset.id);
    expect(ids).not.toContain('gh:brand-remake/vi-kit#');
    expect(ids).not.toContain('gh:nobody/df-export-kit#');
    expect(index.assets).toHaveLength(16);
  });

  it('产出的索引通过 schema 校验（严格模式，判据链第 4 环）', () => {
    const result = validateMarketplaceIndex(buildFromFixture());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('counts 自洽：total/byKind/loadable 与资产实际一致', () => {
    const index = buildFromFixture();
    const { counts, assets } = index;
    expect(counts.total).toBe(assets.length);
    expect(counts.byKind).toEqual({
      skill: 7,
      plugin: 2,
      'design-system': 3,
      template: 4,
    });
    expect(counts.loadable).toBe(
      assets.filter((asset) => asset.installGate.mode === 'loadable').length,
    );
  });

  it('确定性：同输入两次构建逐字节一致（§4.3 幂等）', () => {
    const a = JSON.stringify(buildFromFixture(), null, 2);
    const b = JSON.stringify(buildFromFixture(), null, 2);
    expect(a).toBe(b);
  });

  it('collector 与 generatedAt 取自批次元数据（可注入复现）', () => {
    const index = buildFromFixture();
    expect(index.schema).toBe('df.marketplace.index/v1');
    expect(index.generatedAt).toBe(OPTIONS.generatedAt);
    expect(index.collector).toEqual(OPTIONS.collector);
  });

  it('缺省字段补齐：embeddingRef=null、metrics 零值、yanked=null', () => {
    const index = buildFromFixture();
    for (const asset of index.assets) {
      expect(asset.embeddingRef).toBeNull();
      expect(asset.yanked).toBeNull();
      expect(asset.metrics).toEqual({ installs: 0, adoptions: 0, favorites: 0, lastUsedAt: null });
    }
  });

  it('双语回退：仅英文 displayName 的资产保留（zh-CN 缺席由消费方回退）', () => {
    const index = buildFromFixture();
    const a11y = byId(index, 'gh:veniceai/skills#skills/a11y-check');
    expect(a11y.displayName['zh-CN']).toBeUndefined();
    expect(a11y.displayName.en).toBe('A11y Check');
    expect(a11y.summary['zh-CN']).toContain('无障碍');
  });

  it('质量分与原因码原样透传（DWS → 卡片）', () => {
    const index = buildFromFixture();
    const charts = byId(index, 'gh:acme-labs/df-plugin-charts#');
    expect(charts.quality.score).toBe(0.69);
    expect(charts.quality.explain?.security).toMatchObject({
      deductions: [{ code: 'X1', reason: '含 postinstall 安装脚本', delta: -0.4 }],
    });
    expect(charts.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(charts.source.ref).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('composeInstallGate · 门禁合成（§7.2）', () => {
  const base = (): DwsAssetRecord => {
    const { assets } = readFixture();
    const record = assets.find((item) => item.id === 'gh:anthropics/skills#skills/pdf');
    if (record === undefined) throw new Error('夹具缺 pdf 记录');
    return structuredClone(record);
  };

  it('宽松许可 + 未归档 → loadable', () => {
    expect(composeInstallGate(base())).toEqual({
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    });
  });

  it('NOASSERTION / 归档 → view-only（并入原因）', () => {
    const record = structuredClone(base());
    record.source.license.gate = 'view-only';
    record.source.license.spdx = 'NOASSERTION';
    record.source.archived = true;
    record.reasons = ['NOASSERTION（≠无许可），需人工复核'];
    const gate = composeInstallGate(record);
    expect(gate.mode).toBe('view-only');
    expect(gate.licenseGate).toBe('view-only');
    expect(gate.reasons.join('；')).toContain('NOASSERTION');
    expect(gate.reasons.join('；')).toContain('归档');
  });

  it('品牌复刻 → blocked（不进索引）', () => {
    const record = structuredClone(base());
    record.source.brandDerived = true;
    expect(composeInstallGate(record).mode).toBe('blocked');
  });

  it('subprocess / bash 能力 → ackRequired 列出（D4 确认门输入，§7.1）', () => {
    const record = structuredClone(base());
    record.capabilities = ['prompt:inject', 'bash', 'network'];
    const gate = composeInstallGate(record);
    expect(gate.ackRequired).toEqual(['bash']);
  });

  it('未声明 capabilities → 缺省 ["prompt:inject"]（§1.2）', () => {
    const record = structuredClone(base());
    delete record.capabilities;
    expect(buildMarketplaceIndex([record], OPTIONS).assets[0]?.capabilities).toEqual([
      'prompt:inject',
    ]);
  });
});

describe('buildMarketplaceIndex · 边界', () => {
  it('空输入 → 空索引（assets=[]、counts 全 0）且通过校验', () => {
    const index = buildMarketplaceIndex([], OPTIONS);
    expect(index.assets).toEqual([]);
    expect(index.counts).toEqual({
      total: 0,
      byKind: { skill: 0, plugin: 0, 'design-system': 0, template: 0 },
      loadable: 0,
    });
    expect(validateMarketplaceIndex(index).ok).toBe(true);
  });

  it('单条输入 → total=1 且资产按 id 升序稳定排列', () => {
    const { assets } = readFixture();
    const onlyPdf = assets.filter((record) => record.id === 'gh:anthropics/skills#skills/pdf');
    const index = buildMarketplaceIndex(onlyPdf, OPTIONS);
    expect(index.counts.total).toBe(1);
    expect(index.assets[0]?.id).toBe('gh:anthropics/skills#skills/pdf');
  });

  it('输出资产按 id 字典序（确定性排序，跨平台一致）', () => {
    const index = buildFromFixture();
    const ids = index.assets.map((asset) => asset.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('坏行读取计 skipped（不拖垮整批）', () => {
    const { assets } = readFixture();
    const sample = { asOf: '2026-10-15T22:40:00Z', assets: [...assets, { id: 'gh:broken' }] };
    const read = readDwsSample(sample);
    expect(read.skipped).toBe(1);
    expect(read.assets).toHaveLength(18);
  });
});
