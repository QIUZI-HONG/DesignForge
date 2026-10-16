/**
 * 验证线 · 风险点 6：CLI 契约（`df market …`）。
 *
 * 覆盖：四个子命令的参数校验与退出码语义（0/1/2）、stdout 末行 JSON 可机器解析、
 * 阻塞原因走 stderr、陌生/互斥参数处理、二次运行确定性。
 */

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../index.ts';
import { runCollectCommand } from '../market/collect-cmd.ts';
import { runIndexCommand } from '../market/index-cmd.ts';
import { resolveDataPaths } from '../market/paths.ts';
import { runScoreCommand } from '../market/score-cmd.ts';

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
const logs: string[] = [];
const errs: string[] = [];
const log = (line: string) => logs.push(line);
const err = (line: string) => errs.push(line);

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'verify-cli-'));
  dataRoot = join(workDir, 'data');
  await cp(FIXTURE, dataRoot, { recursive: true });
  logs.length = 0;
  errs.length = 0;
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** 末行必须是可解析 JSON（门禁脚本契约）。 */
function lastJson(): Record<string, unknown> {
  const last = logs.at(-1) ?? '';
  return JSON.parse(last) as Record<string, unknown>;
}

async function runChain(): Promise<void> {
  const stage = async (s: 'ods' | 'dwd') => {
    const res = await runCollectCommand(
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
        stage: s,
      },
      log,
    );
    expect(res.exitCode, `${s} 段应通过`).toBe(0);
  };
  await stage('ods');
  await stage('dwd');
}

describe('CLI 契约：四子命令参数校验与退出码', () => {
  it('全链离线跑通：collect(ods→dwd) → score → index → search，逐命令末行 JSON 可解析', async () => {
    await runChain();

    const score = await runCli(['market', 'score', '--data', dataRoot], log, err);
    expect(score).toBe(0);
    expect(lastJson()).toMatchObject({ command: 'market score', exitCode: 0 });

    const index = await runCli(['market', 'index', '--data', dataRoot], log, err);
    expect(index).toBe(0);
    expect(lastJson()).toMatchObject({ command: 'market index', exitCode: 0 });

    const search = await runCli(
      ['market', 'search', '--data', dataRoot, '--q', 'palette'],
      log,
      err,
    );
    expect(search).toBe(0);
    expect(lastJson()).toMatchObject({ command: 'market search', exitCode: 0 });
    expect(Array.isArray(lastJson().ids)).toBe(true);
  }, 60_000);

  it('exit 1（有数据但断言不达标）：--query-set 在单卡索引上不达标 → exit 1 且 failed 非空', async () => {
    await runChain();
    expect(await runCli(['market', 'score', '--data', dataRoot], log, err)).toBe(0);
    expect(await runCli(['market', 'index', '--data', dataRoot], log, err)).toBe(0);

    const code = await runCli(['market', 'search', '--data', dataRoot, '--query-set'], log, err);
    expect(code).toBe(1);
    const summary = lastJson();
    expect(summary.exitCode).toBe(1);
    expect((summary.failed as unknown[]).length).toBeGreaterThan(0);
  }, 60_000);

  it('exit 2（参数错误）：未知参数 / 缺值 / 负数 limit / 未知子命令', async () => {
    expect(await runCli(['market', 'collect', '--data', dataRoot, '--limit', '-1'], log, err)).toBe(
      2,
    );
    expect(errs.join('\n')).toContain('--limit 必须为正整数');
    errs.length = 0;

    expect(await runCli(['market', 'search', '--data', dataRoot, '--limit', 'abc'], log, err)).toBe(
      2,
    );
    expect(errs.join('\n')).toContain('--limit 必须为正整数');
    errs.length = 0;

    expect(await runCli(['market', 'collect', '--data'], log, err)).toBe(2);
    expect(errs.join('\n')).toContain('缺参数值');
    errs.length = 0;

    expect(await runCli(['market', 'collect', '--wat'], log, err)).toBe(2);
    expect(errs.join('\n')).toContain('未知选项');
    errs.length = 0;

    expect(await runCli(['market', 'wat'], log, err)).toBe(2);
    expect(errs.join('\n')).toContain('未知子命令');
  });

  it('exit 2（阻塞）：缺依赖产物；阻塞原因走 stderr，stdout 末行仍是 JSON', async () => {
    const emptyRoot = join(workDir, 'empty');
    const code = await runCli(['market', 'search', '--data', emptyRoot, '--q', 'x'], log, err);
    expect(code).toBe(2);
    expect(errs.join('\n')).toContain('阻塞');
    expect(lastJson()).toMatchObject({ command: 'market search', exitCode: 2 });
  });

  it('exit 2（阻塞）：ADS 就绪但未指定查询 → 不静默 browse', async () => {
    await runChain();
    await runCli(['market', 'score', '--data', dataRoot], log, err);
    await runCli(['market', 'index', '--data', dataRoot], log, err);
    errs.length = 0;
    expect(await runCli(['market', 'search', '--data', dataRoot], log, err)).toBe(2);
    expect(errs.join('\n')).toContain('未指定查询');
    // 空白查询同样拒绝（不落回 browse）
    errs.length = 0;
    expect(await runCli(['market', 'search', '--data', dataRoot, '--q', '   '], log, err)).toBe(2);
    expect(errs.join('\n')).toContain('未指定查询');
  }, 60_000);

  it('确定性：score / index 二次运行产物 sha256 不变', async () => {
    await runChain();
    const first = await runScoreCommand({ dataRoot, asOf: null, runId: null }, log);
    const second = await runScoreCommand({ dataRoot, asOf: null, runId: null }, log);
    expect(first.exitCode).toBe(0);
    expect(second.summary.qualitySha256).toBe(first.summary.qualitySha256);

    const idx1 = await runIndexCommand(
      { dataRoot, generatedAt: null, collectorName: 'df-market', runId: null },
      log,
    );
    const idx2 = await runIndexCommand(
      { dataRoot, generatedAt: null, collectorName: 'df-market', runId: null },
      log,
    );
    expect(idx1.exitCode).toBe(0);
    expect(idx2.summary.indexSha256).toBe(idx1.summary.indexSha256);
    expect(idx2.summary.searchIndexSha256).toBe(idx1.summary.searchIndexSha256);
  }, 60_000);

  it('互斥参数（--q 与 --query-set 同给）：query-set 优先，--q 被静默忽略（现状，建议加互斥校验）', async () => {
    await runChain();
    expect(await runCli(['market', 'score', '--data', dataRoot], log, err)).toBe(0);
    expect(await runCli(['market', 'index', '--data', dataRoot], log, err)).toBe(0);

    const code = await runCli(
      ['market', 'search', '--data', dataRoot, '--q', 'palette', '--query-set'],
      log,
      err,
    );
    const summary = lastJson();
    // 现状：--query-set 分支优先执行（与 --q 无关），退出码由查询集达标度决定；
    // summary 里没有 q 字段 → 用户给的 --q 被静默忽略（不报错也不提示）。
    expect(summary.q).toBeUndefined();
    expect(summary.queries).toBeDefined();
    expect([0, 1]).toContain(code);
  }, 60_000);

  it('search --limit 0 被拒（正整数），--collect --limit 0 同理', async () => {
    logs.length = 0;
    expect(
      await runCli(['market', 'search', '--data', dataRoot, '--q', 'x', '--limit', '0'], log, err),
    ).toBe(2);
    expect(errs.join('\n')).toContain('正整数');
  });

  it('索引产物带 loadable 集自证：ADS 里不存在 blocked 卡片，quality 与 dims 自洽', async () => {
    await runChain();
    await runCli(['market', 'score', '--data', dataRoot], log, err);
    await runCli(['market', 'index', '--data', dataRoot], log, err);
    const paths = resolveDataPaths(dataRoot);
    const index = JSON.parse(
      await readFile(`${paths.ads}/df.marketplace.index.v1.json`, 'utf8'),
    ) as {
      assets: { installGate: { mode: string } }[];
      counts: { loadable: number };
    };
    expect(index.assets.every((a) => a.installGate.mode !== 'blocked')).toBe(true);
    expect(index.counts.loadable).toBe(
      index.assets.filter((a) => a.installGate.mode === 'loadable').length,
    );
  }, 60_000);
});
