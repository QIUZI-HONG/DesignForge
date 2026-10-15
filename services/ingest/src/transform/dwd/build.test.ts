/**
 * DWD 构建测试（规格 §4.4 四表字段 / §4.3 幂等与确定性 / §1.6 digest）。
 *
 * 断言外部行为：四表行内容与溯源字段、digest 口径、引用完整性、两次构建字节一致、
 * Parquet 往返后类型不漂移。期望值独立构造（字面量哈希流），不调被测实现重算。
 */

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializeOds } from '../ods/materialize.ts';
import { buildDwd } from './build.ts';
import { readDwd } from './store.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'ods-source');
const SKILL_SHA256 = 'sha256:084d0f096a25d9b47f48b32fb2ed74e63e87c9ca135736852c83a7c42fa59aac';
const LICENSE_SHA256 = 'sha256:6c0d128115c0cdd08f139b4e7883c10f7f961a8785b8415c28b1e8535badbe4e';

let workDir = '';
let odsRoot = '';
let dwdRoot = '';

const sha = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mk02-dwd-'));
  const source = join(workDir, 'source');
  await cp(FIXTURE, source, { recursive: true });
  odsRoot = join(workDir, 'data', 'ods');
  dwdRoot = join(workDir, 'data', 'dwd');
  await materializeOds({ source, out: odsRoot });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('buildDwd（f(ODS) → DWD 四表）', () => {
  it('repo 表：一行一仓，字段与守门档齐备（含清单仓）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    expect(tables.repo.map((row) => row.repo_id)).toEqual([1001, 1002]);
    const acme = tables.repo[0];
    expect(acme).toMatchObject({
      repo_id: 1001,
      full_name: 'acme/design-kit',
      owner: 'acme',
      stars: 42,
      forks: 3,
      archived: false,
      fork: false,
      is_list_repo: false,
      license_spdx: 'MIT',
      license_gate: 'loadable',
      ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      asset_count: 1,
    });
    const list = tables.repo[1];
    expect(list).toMatchObject({ repo_id: 1002, is_list_repo: true, license_gate: 'view-only' });
    expect(list?.asset_count).toBe(0);
  });

  it('asset 表：资产主表带溯源（ref/path/digest/license_gate/cluster）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    expect(tables.asset).toHaveLength(1);
    const asset = tables.asset[0];
    expect(asset).toMatchObject({
      asset_id: 'gh:acme/design-kit#skills/palette',
      repo_id: 1001,
      repo_full_name: 'acme/design-kit',
      kind: 'skill',
      name: 'palette-kit',
      root: 'skills/palette',
      ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      version: '1.2.0',
      compliance: 'ok',
      license_gate: 'loadable',
      digest_status: 'ok',
      file_count: 1,
      known_sha256_count: 1,
      cluster_size: 1,
      cluster_reason: 'singleton',
      review_queue: false,
      is_list_repo: false,
    });
    // digest = 规格 §1.6 清单流（单文件，独立构造）
    expect(asset?.digest).toBe(sha(`SKILL.md\0${SKILL_SHA256}\0${307}\n`));
    expect(asset?.digest_coverage).toBe(1);
    expect(asset?.tree_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('asset 表：双语字段与长文按解析结果落盘（缺一言不臆造）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    const asset = tables.asset[0];
    expect(asset?.display_name_zh_cn).toBe('palette-kit');
    expect(asset?.display_name_en).toBe('palette-kit');
    expect(asset?.summary_zh_cn).toBe(
      'Curate an accessible color palette for a product surface. Use this when the user asks for color systems, contrast checks, or theme tokens.',
    );
    expect(asset?.summary_en).toBe(asset?.summary_zh_cn);
    expect(asset?.summary_lang).toBe('en');
    expect(asset?.parse_report).toMatchObject({
      frontmatter: { hasBlock: true, ok: true },
      required: { name: true, description: true },
    });
  });

  it('asset_file 表：文件级 sha256 与 git sha 双轨留痕（未采集正文不冒充）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    expect(tables.asset_file).toHaveLength(1);
    const file = tables.asset_file[0];
    expect(file).toMatchObject({
      asset_id: 'gh:acme/design-kit#skills/palette',
      repo_id: 1001,
      path: 'SKILL.md',
      repo_path: 'skills/palette/SKILL.md',
      git_sha: 'c0ffee1234567890abcdef1234567890abcdef12',
      sha256: SKILL_SHA256,
      blob_ref: SKILL_SHA256,
      size: 307,
      media_type: 'text',
      is_descriptive_text: true,
      parsed: true,
    });
  });

  it('license 表：repo 与 asset 两级，含判定档与证据哈希', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    const repoRows = tables.license.filter((row) => row.scope === 'repo');
    const assetRows = tables.license.filter((row) => row.scope === 'asset');
    expect(repoRows.map((row) => row.repo_id)).toEqual([1001, 1002]);
    expect(repoRows[0]).toMatchObject({
      spdx: 'MIT',
      tier: 'permissive',
      gate: 'loadable',
      evidence_path: 'LICENSE',
      evidence_sha256: LICENSE_SHA256,
      evidence_blob_ref: LICENSE_SHA256,
      brand_derived: false,
    });
    expect(repoRows[1]).toMatchObject({ spdx: null, tier: 'none', gate: 'view-only' });
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]).toMatchObject({
      asset_id: 'gh:acme/design-kit#skills/palette',
      gate: 'loadable',
      scope: 'asset',
    });
  });

  it('引用完整性：asset_file/license 的 asset_id 都能在 asset 表命中（孤儿率 0）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    const ids = new Set(tables.asset.map((row) => row.asset_id));
    for (const row of tables.asset_file) expect(ids.has(row.asset_id)).toBe(true);
    const assetLicenses = tables.license.filter((row) => row.scope === 'asset');
    for (const row of assetLicenses) expect(ids.has(String(row.asset_id))).toBe(true);
    const repoIds = new Set(tables.repo.map((row) => row.repo_id));
    for (const row of tables.asset) expect(repoIds.has(row.repo_id)).toBe(true);
  });

  it('确定性：同 ODS 两次构建 → 四表产物字节一致（规格 §4.3.2）', async () => {
    const first = await buildDwd({ odsRoot, out: join(workDir, 'a') });
    const second = await buildDwd({ odsRoot, out: join(workDir, 'b') });
    for (const name of ['repo', 'asset', 'asset_file', 'license'] as const) {
      const a = await readFile(join(workDir, 'a', `${name}.parquet`));
      const b = await readFile(join(workDir, 'b', `${name}.parquet`));
      expect(a.equals(b)).toBe(true);
    }
    const strip = (artifact: { name: string; sha256: string; length: number; rows: number }) => ({
      name: artifact.name,
      sha256: artifact.sha256,
      length: artifact.length,
      rows: artifact.rows,
    });
    expect(first.manifest.tables.map(strip)).toEqual(second.manifest.tables.map(strip));
    expect(first.manifest.asOf).toBe(second.manifest.asOf);
  });

  it('Parquet 往返：readDwd 还原 JSON 列与数字类型（供 MK-03/MK-04 消费）', async () => {
    const { tables } = await buildDwd({ odsRoot, out: dwdRoot });
    const roundTrip = await readDwd(dwdRoot);
    expect(roundTrip.repo).toEqual(tables.repo);
    expect(roundTrip.asset).toEqual(tables.asset);
    expect(roundTrip.asset_file).toEqual(tables.asset_file);
    expect(roundTrip.license).toEqual(tables.license);
    expect(roundTrip.repo[0]?.topics).toEqual(['design-tokens', 'figma-plugin']);
  });

  it('DWD 清单：记录产物哈希与行数（D6 看板与重建比对的依据）', async () => {
    const { manifest } = await buildDwd({ odsRoot, out: dwdRoot });
    expect(manifest.schema).toBe('df.market.dwd.manifest/v1');
    expect(manifest.tables.map((table) => table.name)).toEqual([
      'repo',
      'asset',
      'asset_file',
      'license',
    ]);
    const assetTable = manifest.tables.find((table) => table.name === 'asset');
    expect(assetTable?.rows).toBe(1);
    expect(assetTable?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
