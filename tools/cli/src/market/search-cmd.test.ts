/**
 * `df market search` 读入面测试（arch-v1 · 票② · #3）。
 *
 * 断言的对外行为：
 * - 坏产物（JSON 不可解析 / schema 不符 / 检索索引结构不可用）→ exit 1 + 明确文案
 *   （CLI 可以硬失败，这是它的语义）；
 * - 缺产物 → exit 2 阻塞（不是断言失败），仍指向先跑 `df market index`；
 * - 合法产物 → exit 0，检索结果非空。
 *
 * 数据根一律临时目录（mkdtemp），不读写真实 `~/.dforge` / `data`。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ads } from '@dforge/ingest';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveDataPaths } from './paths.ts';
import { runSearchCommand } from './search-cmd.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DWS_SAMPLE = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'services',
  'ingest',
  'src',
  'index',
  '__fixtures__',
  'dws-assets.sample.json',
);

let workDir = '';
async function newDataRoot(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'search-cmd-'));
  const root = join(workDir, 'data');
  const sample = ads.readDwsSample(JSON.parse(await readFile(DWS_SAMPLE, 'utf8')));
  const artifacts = ads.buildAdsArtifacts(sample.assets, {
    generatedAt: '2026-10-15T00:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: 'search-cmd-test',
      odsWatermark: '2026-10-15T00:00:00Z',
    },
  });
  expect(artifacts.validation.ok).toBe(true);
  await ads.writeAdsArtifacts(join(root, 'ads'), artifacts);
  return root;
}

afterEach(async () => {
  if (workDir !== '') {
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    workDir = '';
  }
});

describe('df market search · 产物读入与退出码', () => {
  it('合法产物 → exit 0，检索非空', async () => {
    const dataRoot = await newDataRoot();
    const lines: string[] = [];
    const result = await runSearchCommand(
      { dataRoot, q: '幻灯片', limit: 5, querySet: false },
      (line) => lines.push(line),
    );
    expect(result.exitCode).toBe(0);
    expect(result.blockedReason).toBeNull();
    expect(Number(result.summary.total)).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('命中');
  });

  it('检索索引不是合法 JSON → exit 1（不抛异常）且文案点名检索索引', async () => {
    const dataRoot = await newDataRoot();
    const paths = resolveDataPaths(dataRoot);
    await writeFile(join(paths.ads, ads.ADS_SEARCH_INDEX_FILENAME), '{ 不是 JSON', 'utf8');
    const lines: string[] = [];
    const result = await runSearchCommand(
      { dataRoot, q: '幻灯片', limit: 5, querySet: false },
      (line) => lines.push(line),
    );
    expect(result.exitCode).toBe(1);
    expect(result.blockedReason).toBeNull();
    expect(lines.join('\n')).toContain('检索索引');
    expect(String(result.summary.error ?? '')).toContain('检索索引');
  });

  it('检索索引 schema 不符 → exit 1（坏产物不做零校验放行）', async () => {
    const dataRoot = await newDataRoot();
    const paths = resolveDataPaths(dataRoot);
    const searchPath = join(paths.ads, ads.ADS_SEARCH_INDEX_FILENAME);
    const search = JSON.parse(await readFile(searchPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      searchPath,
      JSON.stringify({ ...search, schema: 'df.marketplace.search-index/v2' }),
      'utf8',
    );
    const result = await runSearchCommand(
      { dataRoot, q: '幻灯片', limit: 5, querySet: false },
      () => {},
    );
    expect(result.exitCode).toBe(1);
    expect(String(result.summary.error ?? '')).toContain('schema');
  });

  it('市场索引不是合法 JSON → exit 1（文件在、内容坏 = 断言失败）', async () => {
    const dataRoot = await newDataRoot();
    const paths = resolveDataPaths(dataRoot);
    await writeFile(join(paths.ads, ads.ADS_INDEX_FILENAME), '{ 不是 JSON', 'utf8');
    const result = await runSearchCommand(
      { dataRoot, q: '幻灯片', limit: 5, querySet: false },
      () => {},
    );
    expect(result.exitCode).toBe(1);
    expect(String(result.summary.error ?? '')).toContain('市场索引');
  });

  it('产物缺失 → exit 2 阻塞，并指向 df market index', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'search-cmd-missing-'));
    const result = await runSearchCommand(
      { dataRoot: join(workDir, 'data'), q: 'x', limit: 5, querySet: false },
      () => {},
    );
    expect(result.exitCode).toBe(2);
    expect(result.blockedReason ?? '').toContain('df market index');
  });
});
