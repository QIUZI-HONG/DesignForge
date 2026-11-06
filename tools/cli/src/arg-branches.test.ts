/**
 * 命令族 / 子命令分发与参数解析分支补测（audit-d08 · 缺陷 D-11：cli 关键分支 ≥90%）。
 *
 * 目标集口径（「命令参数面」）：`src/index.ts`（命令族分发）、`src/market/index.ts`
 * （子命令分发与选项装配）、`src/market/args.ts`（共享参数解析，args.test.ts 已有）。
 *
 * 口径：只补**分发与参数分支**——help 各形态、选项缺省回退、topics/sorts/stage 校验、
 * 布尔开关与取值选项两态、未知命令报错；命令执行体（collect/score/index/search-cmd）
 * 一律 `vi.mock` 拦在缝上并捕获**装配出的 options 对象**（分发层的产物就是它），
 * 与既有成功路径用例（pipeline.test.ts 夹具链路）互补，不刷命令内部实现。
 * 全程不触网、不落盘、不起子进程。
 */

import { collect } from '@dforge/ingest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_USAGE } from './config/index.ts';
import { CLI_USAGE, runCli } from './index.ts';
import { CliUsageError } from './market/args.ts';
import { runCollectCommand } from './market/collect-cmd.ts';
import { MARKET_USAGE, runMarketCli } from './market/index.ts';
import { runIndexCommand } from './market/index-cmd.ts';
import { runScoreCommand } from './market/score-cmd.ts';
import { runSearchCommand } from './market/search-cmd.ts';

// 四个命令执行体拦在缝上：分发层只负责把 argv 装配成 options，断言就在装配产物上。
// mock 工厂只须提供 market/index.ts 引用的具名导出（runXCommand）。
vi.mock('./market/collect-cmd.ts', () => ({ runCollectCommand: vi.fn() }));
vi.mock('./market/score-cmd.ts', () => ({ runScoreCommand: vi.fn() }));
vi.mock('./market/index-cmd.ts', () => ({ runIndexCommand: vi.fn() }));
vi.mock('./market/search-cmd.ts', () => ({ runSearchCommand: vi.fn() }));

/** 统一的成功出口形状（分发层会 `...result` 摊平进 CliOutcome）。 */
function okOutcome() {
  return { exitCode: 0 as const, summary: {}, blockedReason: null };
}

/** 采集 options 的 mock 出口（等值比较时忽略 log 函数位）。 */
function collectCalls(): unknown[] {
  return vi.mocked(runCollectCommand).mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runCollectCommand).mockResolvedValue(okOutcome());
  vi.mocked(runScoreCommand).mockResolvedValue(okOutcome());
  vi.mocked(runIndexCommand).mockResolvedValue(okOutcome());
  vi.mocked(runSearchCommand).mockResolvedValue(okOutcome());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('df 顶层命令族分发（runCli）', () => {
  it('-h 与 help 同 --help：usage + exit 0（逐形态覆盖 || 链）', async () => {
    for (const argv of [['-h'], ['help'], ['--help']]) {
      const lines: string[] = [];
      const code = await runCli(
        argv,
        (line) => lines.push(line),
        () => {},
      );
      expect(code).toBe(0);
      expect(lines[0]).toBe(CLI_USAGE);
    }
  });

  it('config 族分发：空 argv → config help（exit 0，末行 JSON 可解析）', async () => {
    const logs: string[] = [];
    const code = await runCli(
      ['config'],
      (line) => logs.push(line),
      () => {},
    );
    expect(code).toBe(0);
    expect(logs[0]).toContain('set-key --stdin');
    const summary = JSON.parse(logs.at(-1) ?? '') as Record<string, unknown>;
    expect(summary).toMatchObject({ command: 'config help', exitCode: 0 });
  });

  it('config 族未知子命令 → 分发层收口 exit 2（参数错误 + usage 走 stderr）', async () => {
    const errs: string[] = [];
    const code = await runCli(
      ['config', 'wat'],
      () => {},
      (line) => errs.push(line),
    );
    expect(code).toBe(2);
    expect(errs[0]).toContain('参数错误');
    expect(errs.join('\n')).toContain('未知子命令：config wat');
    // 收口层贴的是 config 族自己的 usage（不是顶层 CLI_USAGE）
    expect(errs.at(-1)).toBe(CONFIG_USAGE);
  });

  it('命令体抛非 Error 值 → 收口层 String(error) 兜底（exit 2，不崩栈）', async () => {
    vi.mocked(runScoreCommand).mockRejectedValue('boom-not-an-error');
    const errs: string[] = [];
    const code = await runCli(
      ['market', 'score'],
      () => {},
      (line) => errs.push(line),
    );
    expect(code).toBe(2);
    expect(errs[0]).toBe('参数错误：boom-not-an-error');
    expect(errs.at(-1)).toBe(MARKET_USAGE);
  });
});

describe('df market 子命令分发与参数分支（runMarketCli；执行体已 mock）', () => {
  const log = () => {};

  it('help 各形态：空 argv / help / --help / -h → usage + exit 0，不触执行体', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const logs: string[] = [];
      const outcome = await runMarketCli(argv, (line) => logs.push(line));
      expect(outcome).toMatchObject({ command: 'market help', exitCode: 0, blockedReason: null });
      expect(logs[0]).toBe(MARKET_USAGE);
    }
    expect(collectCalls()).toHaveLength(0);
  });

  it('collect --help：子命令级 usage（command 记为 market collect），不触执行体', async () => {
    const logs: string[] = [];
    const outcome = await runMarketCli(['collect', '--help'], (line) => logs.push(line));
    expect(outcome).toMatchObject({ command: 'market collect', exitCode: 0 });
    expect(logs[0]).toBe(MARKET_USAGE);
    expect(collectCalls()).toHaveLength(0);
  });

  it('collect 全参数：逐项装配进 options（缺省项不臆造）', async () => {
    await runMarketCli(
      [
        'collect',
        '--data',
        'data-x',
        '--limit',
        '40',
        '--seeds',
        'a/b,c/d',
        '--topics',
        't1,t2',
        '--sorts',
        'updated,stars',
        '--per-topic',
        '5',
        '--max-pages',
        '3',
        '--since',
        '2026-01-01T00:00:00Z',
        '--max-content',
        '16',
        '--stars-history',
        '--as-of',
        '2026-06-01T00:00:00Z',
        '--run-id',
        'r1',
        '--replay',
        '/replay/r1',
        '--stage',
        'ods',
      ],
      log,
    );
    expect(collectCalls()).toEqual([
      {
        dataRoot: 'data-x',
        limit: 40,
        seeds: ['a/b', 'c/d'],
        topics: ['t1', 't2'],
        sorts: ['updated', 'stars'],
        perTopic: 5,
        maxPagesPerQuery: 3,
        since: '2026-01-01T00:00:00Z',
        maxContent: 16,
        starsHistory: true,
        asOf: '2026-06-01T00:00:00Z',
        runId: 'r1',
        replayDir: '/replay/r1',
        stage: 'ods',
      },
    ]);
  });

  it('collect 零选项：全部缺省回退（topics=默认查询集、stage=all、data=data）', async () => {
    await runMarketCli(['collect'], log);
    expect(collectCalls()).toEqual([
      {
        dataRoot: 'data',
        limit: null,
        seeds: [],
        topics: [...collect.DEFAULT_TOPICS],
        sorts: ['stars', 'updated'],
        perTopic: 20,
        maxPagesPerQuery: 1,
        since: null,
        maxContent: 32,
        starsHistory: false,
        asOf: null,
        runId: null,
        replayDir: null,
        stage: 'all',
      },
    ]);
  });

  it('collect --topics 两态关闭语义：none 与空串都 → 空查询集（关搜索发现）', async () => {
    await runMarketCli(['collect', '--topics', 'none'], log);
    await runMarketCli(['collect', '--topics', ''], log);
    const topics = collectCalls().map((options) => (options as { topics: string[] }).topics);
    expect(topics).toEqual([[], []]);
  });

  it('collect --stage 非法值 → 用法错误（exit 2 语义的 CliUsageError），不触执行体', async () => {
    await expect(runMarketCli(['collect', '--stage', 'bogus'], log)).rejects.toThrow(
      new CliUsageError('--stage 仅支持 raw|ods|dwd|all（实际：bogus）'),
    );
    expect(collectCalls()).toHaveLength(0);
  });

  it('collect --sorts 非法值 → 用法错误；合法子集照单装配', async () => {
    await expect(runMarketCli(['collect', '--sorts', 'stars,bogus'], log)).rejects.toThrow(
      /--sorts 仅支持/,
    );
    await runMarketCli(['collect', '--sorts', 'updated'], log);
    expect(collectCalls().at(-1)).toMatchObject({ sorts: ['updated'] });
  });

  it('score 分发：data 缺省回退 data；as-of / run-id 透传', async () => {
    await runMarketCli(['score', '--data', 'd1', '--as-of', 'X', '--run-id', 'r'], log);
    expect(vi.mocked(runScoreCommand).mock.calls[0]?.[0]).toEqual({
      dataRoot: 'd1',
      asOf: 'X',
      runId: 'r',
    });
    await runMarketCli(['score'], log);
    expect(vi.mocked(runScoreCommand).mock.calls[1]?.[0]).toEqual({
      dataRoot: 'data',
      asOf: null,
      runId: null,
    });
  });

  it('score --help：子命令级 usage，不触执行体', async () => {
    const outcome = await runMarketCli(['score', '--help'], log);
    expect(outcome).toMatchObject({ command: 'market score', exitCode: 0 });
    expect(vi.mocked(runScoreCommand).mock.calls).toHaveLength(0);
  });

  it('index 分发：collector-name 缺省 df-market；generated-at / run-id 两态', async () => {
    await runMarketCli(['index'], log);
    expect(vi.mocked(runIndexCommand).mock.calls[0]?.[0]).toEqual({
      dataRoot: 'data',
      generatedAt: null,
      collectorName: 'df-market',
      runId: null,
    });
    await runMarketCli(
      ['index', '--data', 'd2', '--generated-at', 'G', '--collector-name', 'cn', '--run-id', 'r2'],
      log,
    );
    expect(vi.mocked(runIndexCommand).mock.calls[1]?.[0]).toEqual({
      dataRoot: 'd2',
      generatedAt: 'G',
      collectorName: 'cn',
      runId: 'r2',
    });
  });

  it('index --help：子命令级 usage，不触执行体', async () => {
    const outcome = await runMarketCli(['index', '--help'], log);
    expect(outcome).toMatchObject({ command: 'market index', exitCode: 0 });
    expect(vi.mocked(runIndexCommand).mock.calls).toHaveLength(0);
  });

  it('search 分发：--q 与 --query-set 两态；limit 缺省 10；布尔开关照单', async () => {
    await runMarketCli(['search', '--q', 'palette'], log);
    expect(vi.mocked(runSearchCommand).mock.calls[0]?.[0]).toEqual({
      dataRoot: 'data',
      q: 'palette',
      limit: 10,
      querySet: false,
    });
    await runMarketCli(['search', '--query-set', '--limit', '5', '--data', 'd3'], log);
    expect(vi.mocked(runSearchCommand).mock.calls[1]?.[0]).toEqual({
      dataRoot: 'd3',
      q: null,
      limit: 5,
      querySet: true,
    });
  });

  it('search --help：子命令级 usage，不触执行体', async () => {
    const outcome = await runMarketCli(['search', '--help'], log);
    expect(outcome).toMatchObject({ command: 'market search', exitCode: 0 });
    expect(vi.mocked(runSearchCommand).mock.calls).toHaveLength(0);
  });

  it('未知子命令 → 用法错误（点出支持集）', async () => {
    await expect(runMarketCli(['nope'], log)).rejects.toThrow(
      '未知子命令：market nope（支持 collect|score|index|search）',
    );
  });
});
