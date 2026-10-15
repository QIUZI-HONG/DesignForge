/**
 * CLI 端到端离线测试（夹具链路：mk-01 形状 → ODS → DWD → DWS → ADS → 检索）。
 *
 * 用 `services/ingest` 的规范夹具（两仓：acme/design-kit + 清单仓）驱动四子命令，
 * 断言：各环退出码、产物落盘、schema 通过、检索可命中、证据 JSON 齐。
 * 全程离线（不触网、无时钟依赖——asOf 取夹具注入值）。
 */

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../index.ts';
import { runCollectCommand } from './collect-cmd.ts';
import { runIndexCommand } from './index-cmd.ts';
import { resolveDataPaths } from './paths.ts';
import { runScoreCommand } from './score-cmd.ts';
import { runSearchCommand } from './search-cmd.ts';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'services',
  'ingest',
  'src',
  'transform',
  '__fixtures__',
  'ods-source',
);

let workDir = '';
let dataRoot = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mk05-cli-'));
  dataRoot = join(workDir, 'data');
  await cp(FIXTURE, dataRoot, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('df market 四子命令离线链路（夹具）', () => {
  it('collect(ods→dwd) → score → index → search 全链绿，产物与证据齐', async () => {
    const logs: string[] = [];
    const log = (line: string) => logs.push(line);
    const paths = resolveDataPaths(dataRoot);

    // 1) ODS 规整（离线：夹具已含 MK-01 形状产物 + 录制样本）
    const ods = await runCollectCommand(
      {
        dataRoot,
        limit: null,
        seeds: [],
        topics: [],
        sorts: ['stars'],
        perTopic: 5,
        maxPagesPerQuery: 1,
        since: null,
        maxContent: 32,
        starsHistory: false,
        asOf: null,
        runId: null,
        replayDir: null,
        stage: 'ods',
      },
      log,
    );
    expect(ods.exitCode).toBe(0);

    // 2) DWD 构建
    const dwd = await runCollectCommand(
      {
        dataRoot,
        limit: null,
        seeds: [],
        topics: [],
        sorts: ['stars'],
        perTopic: 5,
        maxPagesPerQuery: 1,
        since: null,
        maxContent: 32,
        starsHistory: false,
        asOf: null,
        runId: null,
        replayDir: null,
        stage: 'dwd',
      },
      log,
    );
    expect(dwd.exitCode).toBe(0);

    // 3) 评分
    const scored = await runScoreCommand({ dataRoot, asOf: null, runId: null }, log);
    expect(scored.exitCode).toBe(0);
    expect(Number(scored.summary.records)).toBeGreaterThan(0);
    const qualityText = await readFile(paths.qualityFile, 'utf8');
    expect(qualityText.trim().split('\n').length).toBe(Number(scored.summary.records));

    // 4) 索引
    const indexed = await runIndexCommand(
      { dataRoot, generatedAt: null, collectorName: 'df-market', runId: null },
      log,
    );
    expect(indexed.exitCode).toBe(0);
    expect(Number(indexed.summary.assets)).toBeGreaterThan(0);
    const indexJson = JSON.parse(
      await readFile(`${paths.ads}/df.marketplace.index.v1.json`, 'utf8'),
    ) as { schema: string; counts: { total: number; loadable: number }; assets: unknown[] };
    expect(indexJson.schema).toBe('df.marketplace.index/v1');
    expect(indexJson.counts.total).toBe(indexJson.assets.length);

    // 5) 检索（单查询）
    const searched = await runSearchCommand(
      { dataRoot, q: 'palette', limit: 5, querySet: false },
      log,
    );
    expect(searched.exitCode).toBe(0);
    expect(Number(searched.summary.total)).toBeGreaterThan(0);

    // 证据 JSON 落盘（cli- 前缀 + score/index 批次各自一份）
    const odsEvidence = JSON.parse(
      await readFile(paths.evidenceFile('cli-20261015-120000-ods'), 'utf8'),
    ) as { schema: string; exitCode: number; steps: { id: string; verdict: string }[] };
    expect(odsEvidence.schema).toBe('df.market.evidence/v1');
    expect(odsEvidence.exitCode).toBe(0);
    expect(odsEvidence.steps.map((step) => step.id)).toEqual(['ods-normalize']);
    const dwdEvidence = JSON.parse(
      await readFile(paths.evidenceFile('cli-20261015-120000-dwd'), 'utf8'),
    ) as { exitCode: number; steps: { id: string; verdict: string }[] };
    expect(dwdEvidence.exitCode).toBe(0);
    expect(dwdEvidence.steps.map((step) => step.id)).toContain('dwd-build');
    expect(dwdEvidence.steps.map((step) => step.id)).toContain('gap-closure');
  });

  it('缺依赖产物 → 明确阻塞（exit 2，不以空产物冒充通过）', async () => {
    const emptyRoot = join(workDir, 'empty');
    const score = await runScoreCommand({ dataRoot: emptyRoot, asOf: null, runId: null }, () => {});
    expect(score.exitCode).toBe(2);
    expect(score.blockedReason).toContain('DWD');

    const index = await runIndexCommand(
      { dataRoot: emptyRoot, generatedAt: null, collectorName: 'df-market', runId: null },
      () => {},
    );
    expect(index.exitCode).toBe(2);

    const search = await runSearchCommand(
      { dataRoot: emptyRoot, q: 'x', limit: 5, querySet: false },
      () => {},
    );
    expect(search.exitCode).toBe(2);
    expect(search.blockedReason).toContain('ADS');
  });
});

describe('df CLI 入口（runCli）', () => {
  it('无参数 / --help → 用法 + exit 0；未知命令与未知选项 → exit 2', async () => {
    const lines: string[] = [];
    expect(
      await runCli(
        [],
        (line) => lines.push(line),
        () => {},
      ),
    ).toBe(0);
    expect(lines.join('\n')).toContain('df market collect');

    expect(
      await runCli(
        ['--help'],
        () => {},
        () => {},
      ),
    ).toBe(0);
    expect(
      await runCli(
        ['nope'],
        () => {},
        () => {},
      ),
    ).toBe(2);
    expect(
      await runCli(
        ['market', 'nope'],
        () => {},
        () => {},
      ),
    ).toBe(2);
    expect(
      await runCli(
        ['market', 'score', '--wat'],
        () => {},
        () => {},
      ),
    ).toBe(2);
  });

  it('末尾输出一行 JSON 摘要（门禁脚本可解析）', async () => {
    const lines: string[] = [];
    const code = await runCli(
      ['market', 'search', '--data', dataRoot, '--q', 'x'],
      (line) => lines.push(line),
      () => {},
    );
    expect(code).toBe(2); // 无 ADS 产物 → 阻塞
    const last = lines.at(-1) ?? '';
    expect(JSON.parse(last)).toMatchObject({ command: 'market search', exitCode: 2 });
  });
});
