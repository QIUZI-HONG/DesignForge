/**
 * `df market deploy` 子命令单测（市场线总案 v2 · 票① §4.2 真采接线）。
 *
 * 纪律（implementation-workflow.md「CI 环境差异」）：
 * - 一律临时数据根（mkdtemp）+ 显式 `--data-root` 目标根，**绝不读写真实数据根 ~/.dforge**；
 * - 离线证明：全局 fetch 换成抛错计数桩（先例 verify-market/cli-replay.test.ts），
 *   全链用例走冻结 replay 样本（services/ingest 冻结进仓，CI 可达）；
 * - 快用例的 ADS 源用 MK-04 冻结夹具（dws-assets.sample.json）直接构建，不跑全链。
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ads } from '@dforge/ingest';
import { afterEach, describe, expect, it } from 'vitest';

import { CliUsageError } from './args.ts';
import type { DeployChainOptions, DeployCommandOptions } from './deploy-cmd.ts';
import { resolveDeployRoot, runDeployCommand } from './deploy-cmd.ts';
import { MARKET_USAGE } from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPLAY_SAMPLE = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'services',
  'ingest',
  'src',
  'collect',
  '__fixtures__',
  'replay-sample',
);
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

/** 每用例独立临时根；清理用可重试删除（追加写在 close 后仍可能有在途写入）。 */
let workDir = '';
async function newRoots(): Promise<{ sourceRoot: string; deployRoot: string }> {
  workDir = await mkdtemp(join(tmpdir(), 'deploy-cmd-'));
  return { sourceRoot: join(workDir, 'data'), deployRoot: join(workDir, 'daemon-root') };
}
afterEach(async () => {
  if (workDir !== '') {
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    workDir = '';
  }
});

/** 零网络出口：包住用例体，任何 fetch 调用即失败并计数。 */
async function withNetworkCut<T>(body: () => Promise<T>): Promise<{ calls: number; value: T }> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('验证桩：deploy 测试不得触网');
  }) as typeof fetch;
  try {
    return { calls, value: await body() };
  } finally {
    globalThis.fetch = original;
  }
}

/** 用 MK-04 冻结夹具构建源 ADS 产物（不走全链；构建即自证 schema 可过）。 */
async function buildSourceAds(sourceRoot: string): Promise<ads.AdsArtifacts> {
  const sample = ads.readDwsSample(JSON.parse(await readFile(DWS_SAMPLE, 'utf8')));
  expect(sample.skipped).toBe(0);
  expect(sample.assets.length).toBeGreaterThan(0);
  const artifacts = ads.buildAdsArtifacts(sample.assets, {
    generatedAt: '2026-10-15T00:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: 'deploy-test',
      odsWatermark: '2026-10-15T00:00:00Z',
    },
  });
  expect(artifacts.validation.ok).toBe(true);
  await ads.writeAdsArtifacts(join(sourceRoot, 'ads'), artifacts);
  return artifacts;
}

function fromIndexOptions(sourceRoot: string, deployRoot: string): DeployCommandOptions {
  return {
    dataRoot: sourceRoot,
    deployRoot,
    fromIndex: true,
    chain: null,
    generatedAt: null,
    collectorName: 'df-market',
    runId: null,
  };
}

/** 全链模式选项（replay 离线样本； topics/seeds 留空走样本自带仓）。 */
function chainOptions(
  sourceRoot: string,
  deployRoot: string,
  replayDir: string | null,
): DeployCommandOptions {
  const chain: DeployChainOptions = {
    limit: null,
    seeds: [],
    topics: [],
    sorts: ['stars'],
    perTopic: 5,
    maxPagesPerQuery: 1,
    since: null,
    maxContent: 32,
    starsHistory: false,
    asOf: '2026-10-15T00:00:00Z',
    runId: 'chain-exp',
    replayDir,
  };
  return {
    dataRoot: sourceRoot,
    deployRoot,
    fromIndex: false,
    chain,
    generatedAt: '2026-10-15T00:00:00Z',
    collectorName: 'df-market',
    runId: 'deploy-chain',
  };
}

function marketDir(deployRoot: string): string {
  return join(deployRoot, 'market');
}

describe('resolveDeployRoot（纯函数：缺省口径不上盘验证）', () => {
  it('缺省（null）= ~/.dforge（daemon 数据根缺省口径）', () => {
    expect(resolveDeployRoot(null)).toBe(join(homedir(), '.dforge'));
  });
  it('显式 --data-root 原样返回（测试注入临时根的前提）', () => {
    expect(resolveDeployRoot('/opt/df-root')).toBe('/opt/df-root');
  });
});

describe('df market deploy · from-index 部署', () => {
  it('ADS 现有产物校验通过 → exit 0，两产物落到 <root>/market/，账本 deployCount=1', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    await buildSourceAds(sourceRoot);
    const { calls, value } = await withNetworkCut(async () =>
      runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {}),
    );
    expect(calls).toBe(0);
    expect(value.exitCode).toBe(0);
    expect(value.blockedReason).toBeNull();

    const indexText = await readFile(
      join(marketDir(deployRoot), 'df.marketplace.index.v1.json'),
      'utf8',
    );
    const searchText = await readFile(
      join(marketDir(deployRoot), 'market_search_index.v1.json'),
      'utf8',
    );
    const index = JSON.parse(indexText) as { schema: string; counts: { total: number } };
    expect(index.schema).toBe('df.marketplace.index/v1');
    expect(index.counts.total).toBeGreaterThan(0);
    const search = JSON.parse(searchText) as { schema: string };
    expect(search.schema).toBe('df.marketplace.search-index/v1');

    const ledger = JSON.parse(
      await readFile(join(marketDir(deployRoot), 'deploy-state.v1.json'), 'utf8'),
    ) as { schema: string; deployCount: number; changed: { index: boolean } };
    expect(ledger.schema).toBe('df.market.deploy-state/v1');
    expect(ledger.deployCount).toBe(1);
    expect(ledger.changed.index).toBe(true);
    expect(value.summary.indexChanged).toBe(true);
    expect(Number(value.summary.assets)).toBe(index.counts.total);
  }, 60_000);

  it('幂等：同源重复部署 → exit 0、产物字节不变、deployCount 递增、changed=false', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    await buildSourceAds(sourceRoot);
    const first = await runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {});
    expect(first.exitCode).toBe(0);
    const indexPath = join(marketDir(deployRoot), 'df.marketplace.index.v1.json');
    const bytesAfterFirst = await readFile(indexPath, 'utf8');

    const second = await runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {});
    expect(second.exitCode).toBe(0);
    expect(await readFile(indexPath, 'utf8')).toBe(bytesAfterFirst);
    expect(second.summary.indexChanged).toBe(false);
    expect(second.summary.searchIndexChanged).toBe(false);
    expect(Number(second.summary.deployCount)).toBe(2);
  }, 60_000);

  it('写前校验失败（损坏索引）→ exit 1，目标目录不落产物（不写坏数据根）', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    await buildSourceAds(sourceRoot);
    await writeFile(
      join(sourceRoot, 'ads', 'df.marketplace.index.v1.json'),
      `${JSON.stringify({ schema: 'df.marketplace.index/v1', assets: 'corrupted' })}\n`,
      'utf8',
    );
    const { calls, value } = await withNetworkCut(async () =>
      runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {}),
    );
    expect(calls).toBe(0);
    expect(value.exitCode).toBe(1);
    expect(value.blockedReason).toBeNull();
    await expect(
      stat(join(marketDir(deployRoot), 'df.marketplace.index.v1.json')),
    ).rejects.toThrow();
  }, 60_000);

  it('空索引（0 资产）→ exit 1 不部署（防清空真实数据根市场面）', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    const empty = ads.buildAdsArtifacts([], {
      generatedAt: '2026-10-15T00:00:00Z',
      collector: {
        name: 'df-market',
        version: '0.1.0',
        runId: 'empty',
        odsWatermark: '2026-10-15T00:00:00Z',
      },
    });
    expect(empty.validation.ok).toBe(true);
    await ads.writeAdsArtifacts(join(sourceRoot, 'ads'), empty);
    const value = await runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {});
    expect(value.exitCode).toBe(1);
    await expect(
      stat(join(marketDir(deployRoot), 'df.marketplace.index.v1.json')),
    ).rejects.toThrow();
  }, 60_000);

  it('缺 ADS 上游 → exit 2 阻塞并指明先跑 df market index', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    const value = await runDeployCommand(fromIndexOptions(sourceRoot, deployRoot), () => {});
    expect(value.exitCode).toBe(2);
    expect(value.blockedReason ?? '').toContain('df market index');
  }, 30_000);

  it('缺 DWD/DWS 上游（重建模式）→ exit 2 阻塞（上游命令的阻塞语义透传）', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    const value = await runDeployCommand(
      { ...fromIndexOptions(sourceRoot, deployRoot), fromIndex: false },
      () => {},
    );
    expect(value.exitCode).toBe(2);
    expect(value.blockedReason).not.toBeNull();
  }, 30_000);
});

describe('df market deploy · 全链模式（--collect）', () => {
  it('collect(replay 离线) → score → index → deploy：exit 0，索引落到 <root>/market/，全程零触网', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    const { calls, value } = await withNetworkCut(async () =>
      runDeployCommand(chainOptions(sourceRoot, deployRoot, REPLAY_SAMPLE), () => {}),
    );
    expect(calls).toBe(0);
    expect(value.exitCode).toBe(0);
    expect(value.blockedReason).toBeNull();
    const indexText = await readFile(
      join(marketDir(deployRoot), 'df.marketplace.index.v1.json'),
      'utf8',
    );
    const index = JSON.parse(indexText) as { counts: { total: number; loadable: number } };
    expect(index.counts.total).toBeGreaterThan(0);
    expect(index.counts.loadable).toBeGreaterThan(0);
    // 全链模式的部署账本与证据都要留痕
    const ledger = JSON.parse(
      await readFile(join(marketDir(deployRoot), 'deploy-state.v1.json'), 'utf8'),
    ) as { source: { chain: boolean } };
    expect(ledger.source.chain).toBe(true);
    expect(String(value.summary.evidence)).toContain('deploy-');
  }, 180_000);

  it('上游 collect 阻塞（replay 样本缺失）→ 整单阻塞 exit 2，目标根不落任何文件', async () => {
    const { sourceRoot, deployRoot } = await newRoots();
    const value = await runDeployCommand(
      chainOptions(sourceRoot, deployRoot, join(workDir, 'no-such-replay')),
      () => {},
    );
    expect(value.exitCode).toBe(2);
    expect(value.blockedReason ?? '').toContain('离线样本不可读');
    await expect(readdir(marketDir(deployRoot))).rejects.toThrow();
  }, 60_000);
});

describe('df market deploy · CLI 分发', () => {
  it('--help 打印用法且含 deploy 段（exit 0）', async () => {
    const { runMarketCli } = await import('./index.ts');
    const lines: string[] = [];
    const outcome = await runMarketCli(['deploy', '--help'], (l) => lines.push(l));
    expect(outcome.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('df market deploy');
    expect(MARKET_USAGE).toContain('deploy');
  });

  it('未知选项 → CliUsageError（用法错误，由 dispatch 收口为 exit 2）', async () => {
    const { runMarketCli } = await import('./index.ts');
    await expect(runMarketCli(['deploy', '--bogus', 'x'], () => {})).rejects.toBeInstanceOf(
      CliUsageError,
    );
  });
});
