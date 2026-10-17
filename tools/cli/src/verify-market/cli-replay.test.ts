/**
 * 验证线 · 风险点 1/6 交叉：`df market collect --replay` 的耦合与不触网证明。
 *
 * 关键事实（对抗发现）：离线重放时 runCollect **不把样本拷进数据根**（只有真网运行写
 * `<data>/replay/<runId>/`），而 DWD 规整（materializeOds）要读 `<data>/replay/**` 的录制正文
 * 才能重建 Trees 清单与文本。于是「样本在数据根外」的组合会让 ODS/DWD 段产出退化产物。
 */

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '@dforge/ingest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCollectCommand } from '../market/collect-cmd.ts';

const REPLAY_SAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
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

const RUN_ID = '20261015-174931';
let workDir = '';
let externalReplay = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'verify-cli-replay-'));
  externalReplay = join(workDir, 'external-sample');
  await cp(REPLAY_SAMPLE, externalReplay, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runReplay(dataRoot: string, replayDir: string, log: (l: string) => void = () => {}) {
  return runCollectCommand(
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
      replayDir,
      stage: 'all',
    },
    log,
  );
}

async function assetFileCount(dataRoot: string): Promise<number> {
  try {
    const tables = await transform.readDwd(join(dataRoot, 'dwd'));
    return tables.asset_file.length;
  } catch {
    return -1;
  }
}

describe('collect --replay 的样本位置耦合', () => {
  it('样本放在数据根内（<data>/replay/<runId>/）→ 全链 exit 0 且 DWD 文件清单非空', async () => {
    const dataRoot = join(workDir, 'in-root-data');
    const replayDir = join(dataRoot, 'replay', RUN_ID);
    await cp(externalReplay, replayDir, { recursive: true });

    const res = await runReplay(dataRoot, replayDir);
    expect(res.exitCode).toBe(0);
    expect(await assetFileCount(dataRoot)).toBeGreaterThan(0);
  }, 60_000);

  it('[发现] 样本在数据根外（--replay 指向外部目录）→ 不得产出退化 DWD：应完整跑通或明确阻塞 exit 2', async () => {
    const dataRoot = join(workDir, 'external-data');
    const res = await runReplay(dataRoot, externalReplay);
    const rows = await assetFileCount(dataRoot);

    // 现状：raw 段成功（2 仓记录），但 ods 段报 files-listing-missing×2 → exit 1；
    // 落盘的 DWD 文件清单为 0 行、text 抽取组全空（下游 score 会以 exit 2 阻塞）。
    const complete = res.exitCode === 0 && rows > 0;
    const blockedClear = res.exitCode === 2;
    expect(
      complete || blockedClear,
      `外部 --replay 目录：期望完整跑通（exit 0 且 asset_file>0）或明确阻塞（exit 2）；` +
        `实际 exit=${res.exitCode}，asset_file=${rows}，blockedReason=${String(res.blockedReason)}`,
    ).toBe(true);
  }, 60_000);

  it('--replay 指向不存在的目录 → 阻塞 exit 2（离线样本不可读）', async () => {
    const dataRoot = join(workDir, 'missing-data');
    const res = await runReplay(dataRoot, join(workDir, 'no-such-dir'));
    expect(res.exitCode).toBe(2);
    expect(res.blockedReason ?? '').toContain('离线样本不可读');
  }, 30_000);

  it('重放零网络出口：全局 fetch 换成抛错计数桩后仍 exit 0（桩零调用）', async () => {
    const dataRoot = join(workDir, 'netproof-data');
    const replayDir = join(dataRoot, 'replay', RUN_ID);
    await cp(externalReplay, replayDir, { recursive: true });

    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('验证桩：重放不得触网');
    }) as typeof fetch;
    try {
      const res = await runReplay(dataRoot, replayDir);
      expect(res.exitCode).toBe(0);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  }, 60_000);
});

describe('collect 真网路径的失败分类（CLI 层）', () => {
  /**
   * 凭据注入（CI 可复现的关键）：本组用例测的是**网络失败分类**，而本机 `gh auth token`
   * 恰好可用会掩盖环境依赖——CI runner 无任何凭据，凭据预检会先于 404/429 分类阻塞
   * （exit 2 + 「无 GitHub 凭据」），两条断言因此误红。这里注入占位 token 让预检确定性
   * 通过（`resolveGitHubToken` 的 env 优先于 `gh`）；真实请求已被 fetch 桩拦截，不触网。
   */
  let savedGhToken: string | undefined;
  beforeAll(() => {
    savedGhToken = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'verify-dummy-token';
  });
  afterAll(() => {
    if (savedGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGhToken;
  });

  it('全仓 404 → exit 1（断言失败「仓数 > 0」），不得以 0 仓冒充通过', async () => {
    const dataRoot = join(workDir, 'notfound-data');
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 404,
      headers: { get: () => null },
      text: async () => '{"message":"Not Found"}',
    })) as unknown as typeof fetch;
    try {
      const res = await runCollectCommand(
        {
          dataRoot,
          limit: null,
          seeds: ['acme/nope'],
          topics: [],
          sorts: ['stars'],
          perTopic: 5,
          maxPagesPerQuery: 1,
          since: null,
          maxContent: 32,
          starsHistory: false,
          asOf: '2026-10-15T00:00:00Z',
          runId: 'r404',
          replayDir: null,
          stage: 'raw',
        },
        () => {},
      );
      expect(res.exitCode).toBe(1);
      const evidence = JSON.parse(
        await readFile(join(dataRoot, 'evidence', 'cli-r404-raw.json'), 'utf8'),
      ) as { exitCode: number; steps: { verdict: string }[] };
      expect(evidence.exitCode).toBe(1);
      expect(evidence.steps[0]?.verdict).toBe('fail');
    } finally {
      globalThis.fetch = original;
    }
  }, 60_000);

  it('连续 429 → 熔断阻塞 exit 2（不落退化产物）', async () => {
    const dataRoot = join(workDir, 'ratelimit-data');
    const original = globalThis.fetch;
    const stub = async () => ({
      status: 429,
      headers: {
        get: (name: string) => {
          const map: Record<string, string> = {
            'retry-after': '0',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1',
          };
          return map[name.toLowerCase()] ?? null;
        },
      },
      text: async () => '{"message":"API rate limit exceeded"}',
    });
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const res = await runCollectCommand(
        {
          dataRoot,
          limit: null,
          seeds: ['acme/one'],
          topics: [],
          sorts: ['stars'],
          perTopic: 5,
          maxPagesPerQuery: 1,
          since: null,
          maxContent: 32,
          starsHistory: false,
          asOf: '2026-10-15T00:00:00Z',
          runId: 'ratelimit-run',
          replayDir: null,
          stage: 'all',
        },
        () => {},
      );
      expect(res.exitCode).toBe(2);
      expect(res.blockedReason ?? '').toContain('连续');
      // 阻塞时不得落 DWD 产物（不产出退化中间层）
      expect(await assetFileCount(dataRoot)).toBe(-1);
      const evidenceText = await readFile(
        join(dataRoot, 'evidence', `cli-ratelimit-run-all.json`),
        'utf8',
      );
      const evidence = JSON.parse(evidenceText) as {
        exitCode: number;
        steps: { verdict: string }[];
      };
      expect(evidence.exitCode).toBe(2);
      expect(evidence.steps.some((s) => s.verdict === 'blocked')).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  }, 60_000);
});
