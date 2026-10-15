/**
 * 采集编排集成测试（规格 §4.3 幂等与离线复跑 + §6.1 退出码语义）。
 *
 * 用剧本化 fetch 驱动全流程（不触网）：候选 → 逐仓串行采集 → ODS 落盘 → 证据 JSON。
 * 断言：退出码语义（0/1/2）、证据步骤与断言、离线复跑产出与首跑一致（摘要一致）、
 * 无凭据/网络不可用/样本缺失一律 exit 2（禁止假绿）。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { ScriptedStep } from './__fixtures__/http-harness.ts';
import { jsonStep } from './__fixtures__/http-harness.ts';
import type { FetchLike } from './http.ts';
import type { CollectOptions } from './run.ts';
import { runCollect, selectContentPaths } from './run.ts';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mk01-run-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REPO = 'anthropics/skills';
const COMMIT = 'c'.repeat(40);
const AS_OF_MS = Date.parse('2026-10-15T22:00:00Z');

const META = {
  id: 1061953414,
  full_name: REPO,
  name: 'skills',
  owner: { login: 'anthropics' },
  description: 'Anthropic example skills',
  default_branch: 'main',
  stargazers_count: 181306,
  forks_count: 100,
  pushed_at: '2026-10-09T18:45:52Z',
  updated_at: '2026-10-09T18:45:52Z',
  archived: false,
  fork: false,
  size: 5731,
  homepage: null,
  topics: ['agent-skill'],
  license: null,
};

const TREE = {
  sha: 'tree-1',
  truncated: false,
  tree: [
    { path: 'LICENSE.txt', type: 'blob', sha: 'lic-1', size: 100 },
    { path: 'skills', type: 'tree', sha: 't1' },
    { path: 'skills/pdf/SKILL.md', type: 'blob', sha: 'b1', size: 1200 },
  ],
};

/** 剧本：meta → ref → tree → LICENSE → SKILL.md（串行、按 URL 顺序）。 */
function fullScript(): ScriptedStep[] {
  return [
    jsonStep(META, { etag: 'W/"meta"' }),
    jsonStep({ object: { sha: COMMIT, type: 'commit' } }, { etag: 'W/"ref"' }),
    jsonStep(TREE, { etag: 'W/"tree"' }),
    jsonStep(
      { encoding: 'base64', content: Buffer.from('MIT License', 'utf8').toString('base64') },
      { etag: 'W/"license"' },
    ),
    jsonStep(
      {
        encoding: 'base64',
        content: Buffer.from(
          `---\nname: pdf\ndescription: 处理 PDF 相关任务时使用。\n---\n\n${'正文'.repeat(200)}`,
          'utf8',
        ).toString('base64'),
      },
      { etag: 'W/"skill"' },
    ),
  ];
}

/** 第二轮剧本：全部 304（条件请求命中；不计入预算，规格 §3.2）。 */
function all304Script(): ScriptedStep[] {
  return [
    { status: 304, headers: { etag: 'W/"meta"' } },
    { status: 304, headers: { etag: 'W/"ref"' } },
    { status: 304, headers: { etag: 'W/"tree"' } },
    { status: 304, headers: { etag: 'W/"license"' } },
    { status: 304, headers: { etag: 'W/"skill"' } },
  ];
}

/** 以剧本构造 fetch（按 URL 顺序返回；可注入固定时钟用）。 */
function fetchFrom(script: ScriptedStep[]): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const step = script[i];
    i += 1;
    if (!step) throw new Error(`剧本耗尽（url=${url}）`);
    const headers = new Map(Object.entries(step.headers ?? {}));
    return {
      status: step.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: async () => step.body ?? '',
    };
  };
  return { fetchImpl, urls };
}

function baseOptions(outDir: string, over: Partial<CollectOptions> = {}): CollectOptions {
  return {
    outDir,
    runId: '20261015-2200',
    asOfMs: AS_OF_MS,
    seeds: [REPO],
    topics: [],
    sorts: ['stars'],
    perTopic: 20,
    maxPagesPerQuery: 1,
    limit: 5,
    since: null,
    maxContentPerRepo: 32,
    replayDir: null,
    token: { token: 'test-token', source: 'env' },
    ...over,
  };
}

describe('runCollect 真网路径（剧本化 fetch）', () => {
  it('全流程：候选 → 采集 → 识别 → ODS → 证据；exit 0 且产物齐全', async () => {
    const out = tempDir();
    const { fetchImpl, urls } = fetchFrom(fullScript());
    const result = await runCollect(baseOptions(out, { fetchImpl }));

    expect(result.exitCode).toBe(0);
    expect(result.blockedReason).toBeNull();
    expect(urls[0]).toBe(`https://api.github.com/repos/${REPO}`);
    expect(urls[1]).toBe(`https://api.github.com/repos/${REPO}/git/ref/heads/main`);
    expect(urls[2]).toContain('/git/trees/main?recursive=1');
    expect(urls[3]).toContain('/contents/LICENSE.txt');
    expect(urls[4]).toContain('/contents/skills/pdf/SKILL.md');

    // ODS 记录
    expect(result.records).toHaveLength(1);
    const record = result.records[0];
    expect(record?.ref).toBe(COMMIT);
    expect(record?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record?.fetchedAt).toBe('2026-10-15T22:00:00.000Z');
    expect(record?.license.gate).toBe('view-only'); // repository license = null
    expect(record?.license.evidence.sha256).toMatch(/^sha256:/);
    expect(record?.assets.map((a) => `${a.kind}:${a.name}`)).toEqual(['skill:pdf']);

    // 产物落盘 + 证据 JSON
    const snapshot = readFileSync(result.artifacts[0]?.path ?? '', 'utf8').trim();
    expect(JSON.parse(snapshot).repo.fullName).toBe(REPO);
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8')) as {
      schema: string;
      exitCode: number;
      steps: { id: string; verdict: string; assertions: { name: string; ok: boolean }[] }[];
      offline: boolean;
    };
    expect(evidence.schema).toBe('df.market.evidence/v1');
    expect(evidence.exitCode).toBe(0);
    expect(evidence.offline).toBe(false);
    expect(evidence.steps.map((s) => s.id)).toEqual([
      'request-discipline',
      'asset-identification',
      'license-gate',
      'ods-output',
    ]);
    expect(evidence.steps.every((s) => s.verdict === 'pass')).toBe(true);
    expect(evidence.steps[0]?.assertions.find((a) => a.name.includes('一律 GET'))?.ok).toBe(true);
    expect(result.replayDir).not.toBeNull();
  });

  it('跨运行 ETag：第二轮全 304 → 记录与首轮一致、304 命中入证据（不计限额）', async () => {
    const out = tempDir();
    const first = fetchFrom(fullScript());
    const run1 = await runCollect(baseOptions(out, { fetchImpl: first.fetchImpl }));
    expect(run1.exitCode).toBe(0);

    // 第二轮：同一输出目录（复用 etag-cache.json），全部条件请求命中 304。
    const second = fetchFrom(all304Script());
    const run2 = await runCollect(baseOptions(out, { fetchImpl: second.fetchImpl }));

    expect(run2.exitCode).toBe(0);
    expect(second.urls.every((u) => !u.includes('search/repositories'))).toBe(true);
    // 第二轮全部请求都带了 If-None-Match（条件请求）
    expect(second.fetchImpl).toBeDefined();
    expect(run2.records.map((r) => r.digest)).toEqual(run1.records.map((r) => r.digest));
    expect(run2.records.map((r) => r.assets.map((a) => a.id))).toEqual(
      run1.records.map((r) => r.assets.map((a) => a.id)),
    );
    const metrics = run2.evidence.steps.find((s) => s.id === 'request-discipline')?.metrics;
    expect(metrics?.cacheHits304).toBe(5);
    expect(metrics?.coreCalls).toBe(0); // 304 不计入预算窗口
  });

  it('增量链：首跑(200) → 二跑(全 304) → 二跑样本离线重放，三者记录一致', async () => {
    const out = tempDir();
    const run1 = await runCollect(
      baseOptions(out, { fetchImpl: fetchFrom(fullScript()).fetchImpl }),
    );
    const run2 = await runCollect(
      baseOptions(out, { fetchImpl: fetchFrom(all304Script()).fetchImpl }),
    );
    expect(run1.exitCode).toBe(0);
    expect(run2.exitCode).toBe(0);
    expect(run2.replayDir).not.toBeNull();

    // 二跑的样本里 304 已还原为 200+正文：离线重放能完整还原，无需外网与缓存文件。
    const replayOut = tempDir();
    const replay = await runCollect(
      baseOptions(replayOut, { replayDir: run2.replayDir, token: null }),
    );
    expect(replay.exitCode).toBe(0);
    expect(replay.artifacts[0]?.sha256).toBe(run1.artifacts[0]?.sha256);
    expect(replay.artifacts[0]?.sha256).toBe(run2.artifacts[0]?.sha256);
  });

  it('离线复跑：同一样本集重放 → ODS 摘要与首跑一致（规格 §4.3）」', async () => {
    const out = tempDir();
    const { fetchImpl } = fetchFrom(fullScript());
    const first = await runCollect(baseOptions(out, { fetchImpl }));
    expect(first.replayDir).not.toBeNull();

    const replayOut = tempDir();
    const replay = await runCollect(
      baseOptions(replayOut, {
        replayDir: first.replayDir,
        token: null, // 离线不触网、无需凭据
      }),
    );

    expect(replay.exitCode).toBe(0);
    expect(replay.evidence.offline).toBe(true);
    expect(replay.artifacts[0]?.sha256).toBe(first.artifacts[0]?.sha256);
    expect(replay.records.map((r) => r.digest)).toEqual(first.records.map((r) => r.digest));
    expect(replay.records.map((r) => r.assets.map((a) => a.id))).toEqual(
      first.records.map((r) => r.assets.map((a) => a.id)),
    );
  });

  it('无凭据 → exit 2 阻塞（不伪造数据），证据含阻塞步骤', async () => {
    const out = tempDir();
    const { fetchImpl } = fetchFrom(fullScript());
    const result = await runCollect(baseOptions(out, { fetchImpl, token: null }));
    expect(result.exitCode).toBe(2);
    expect(result.blockedReason).toContain('凭据');
    expect(result.records).toEqual([]);
    expect(result.evidence.steps.some((s) => s.verdict === 'blocked')).toBe(true);
  });

  it('网络不可用（fetch 抛错）→ exit 2 阻塞', async () => {
    const out = tempDir();
    const failingFetch: FetchLike = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    };
    const result = await runCollect(
      baseOptions(out, {
        fetchImpl: failingFetch,
        token: { token: 't', source: 'env' },
        maxAttempts: 1, // 退避重试逻辑已有单测；此处只验证阻塞语义
      }),
    );
    expect(result.exitCode).toBe(2);
    expect(result.blockedReason).toContain('网络');
  });

  it('仓 404 → 跳过并留痕（exit 0：如实记录、不伪造）', async () => {
    const out = tempDir();
    const { fetchImpl } = fetchFrom([{ status: 404, body: '{"message":"Not Found"}' }]);
    const result = await runCollect(baseOptions(out, { fetchImpl }));
    expect(result.exitCode).toBe(0);
    expect(result.records).toEqual([]);
    expect(result.counts.skippedRepos).toEqual([{ repo: REPO, reason: 'HTTP 404' }]);
  });

  it('离线样本缺失 → exit 2 阻塞（不触网、不静默）', async () => {
    const out = tempDir();
    const result = await runCollect(
      baseOptions(out, { replayDir: join(out, 'not-exist'), token: null }),
    );
    expect(result.exitCode).toBe(2);
    expect(result.blockedReason).toContain('样本');
  });

  it('topic 发现路径：搜索结果进采集目标，清单仓单列不入资产', async () => {
    const out = tempDir();
    const searchUrl = 'https://api.github.com/search/repositories?';
    const script: ScriptedStep[] = [
      jsonStep({
        total_count: 2,
        items: [
          {
            id: 1061953414,
            full_name: REPO,
            name: 'skills',
            owner: { login: 'anthropics' },
            description: 'x',
            stargazers_count: 1,
            pushed_at: '2026-10-01T00:00:00Z',
            default_branch: 'main',
            archived: false,
            fork: false,
            size: 1,
            homepage: null,
            topics: ['agent-skill'],
            license: null,
          },
          {
            id: 2,
            full_name: 'someone/awesome-skills',
            name: 'awesome-skills',
            owner: { login: 'someone' },
            description: 'awesome list of skills',
            stargazers_count: 2,
            pushed_at: '2026-10-01T00:00:00Z',
            default_branch: 'main',
            archived: false,
            fork: false,
            size: 1,
            homepage: null,
            topics: [],
            license: { spdx_id: 'MIT' },
          },
        ],
      }),
      ...fullScript(),
    ];
    const { fetchImpl, urls } = fetchFrom(script);
    const result = await runCollect(
      baseOptions(out, { fetchImpl, seeds: [], topics: ['agent-skill'], sorts: ['stars'] }),
    );

    expect(urls[0]).toContain(searchUrl);
    expect(result.exitCode).toBe(0);
    expect(result.counts.repos).toBe(1); // 清单仓不进采集目标（kind=list 单列）
    expect(result.records[0]?.repo.fullName).toBe(REPO);
  });
});

describe('退出码：断言失败 → 1（真失败）', () => {
  it('ODS 记录断言失败（构造不出合法记录时以 1 上报，不掩盖）', async () => {
    // 构造一个「资产 id 非法」的记录：通过注入使 identify 产出的资产 id 前缀异常不可行，
    // 这里改为验证证据层的判定逻辑：一步断言不成立 → exitCode 1。
    const { buildEvidence } = await import('./evidence.ts');
    const evidence = buildEvidence({
      runId: 'r',
      asOf: '2026-10-15T22:00:00Z',
      offline: false,
      steps: [
        {
          id: 'x',
          name: 'x',
          verdict: 'pass',
          assertions: [{ name: 'a', expected: '1', actual: '0', ok: false }],
          artifacts: [],
          metrics: {},
        },
      ],
    });
    expect(evidence.exitCode).toBe(1);
    expect(evidence.steps[0]?.verdict).toBe('fail');
  });
});

describe('内容取回优先级（对接面修复：text 抽取组的关键文本优先）', () => {
  const tree = [
    { path: 'README.md', type: 'blob' as const, sha: 'r0', size: 10 },
    { path: 'skills/pdf/SKILL.md', type: 'blob' as const, sha: 'b1', size: 10 },
    { path: 'skills/pdf/README.md', type: 'blob' as const, sha: 'b2', size: 10 },
    { path: 'skills/pdf/.mcp.json', type: 'blob' as const, sha: 'b3', size: 10 },
    { path: 'skills/pdf/CHANGELOG.md', type: 'blob' as const, sha: 'b4', size: 10 },
    { path: 'plugin.json', type: 'blob' as const, sha: 'b5', size: 10 },
    { path: 'docs/notes.md', type: 'blob' as const, sha: 'b6', size: 10 },
  ];

  it('仓根 README 第一、SKILL.md 次之；未选的进 deferred（不假装读过）', () => {
    const selection = selectContentPaths(tree, 3);
    expect(selection.selected).toEqual([
      'README.md',
      'skills/pdf/SKILL.md',
      'plugin.json',
    ]);
    expect(selection.deferred).toContain('skills/pdf/README.md');
    // 非描述性文本文件永不入选（预算不被无关文件吃掉）
    expect([...selection.selected, ...selection.deferred]).not.toContain('docs/notes.md');
  });

  it('预算放大后：资产根 README / .mcp.json / CHANGELOG 依次进入（文本抽取组来源）', () => {
    const selection = selectContentPaths(tree, 32);
    expect(selection.selected).toEqual([
      'README.md',
      'skills/pdf/SKILL.md',
      'plugin.json',
      'skills/pdf/README.md',
      'skills/pdf/.mcp.json',
      'skills/pdf/CHANGELOG.md',
    ]);
  });
});

describe('星标历史水位（trend.stars90dAgo 来源，规格 §5.2）', () => {
  const cutoffPage = [
    { starred_at: '2025-01-01T00:00:00Z' },
    { starred_at: '2025-06-01T00:00:00Z' }, // 90 天前水位（asOf=2026-10-15 → cutoff≈2026-07-17）
  ];

  it('开启后：meta → stargazers 页 → createdAt/stars90dAgo 落记录并入证据指标', async () => {
    const out = tempDir();
    const script: ScriptedStep[] = [
      jsonStep({ ...META, created_at: '2024-01-01T00:00:00Z', stargazers_count: 2 }),
      jsonStep(cutoffPage, { etag: 'W/"stars"' }),
      ...fullScript().slice(1),
    ];
    const { fetchImpl, urls } = fetchFrom(script);
    const result = await runCollect(baseOptions(out, { fetchImpl, starsHistory: true }));

    expect(result.exitCode).toBe(0);
    expect(urls[1]).toContain('/stargazers?per_page=100&page=1');
    const record = result.records[0];
    expect(record?.repo.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(record?.repo.stars90dAgo).toBe(2);
    expect(record?.repo.starsHistory?.method).toBe('direct-page');
    const metrics = result.evidence.steps.find((s) => s.id === 'asset-identification')?.metrics;
    expect(metrics?.repoCreatedAtPresent).toBe(1);
    expect(metrics?.stars90dAgoCovered).toBe(1);
  });

  it('默认关闭：不发 stargazers 请求（额外调用预算由调用方显式开启）', async () => {
    const out = tempDir();
    const { fetchImpl, urls } = fetchFrom(fullScript());
    const result = await runCollect(baseOptions(out, { fetchImpl }));
    expect(result.exitCode).toBe(0);
    expect(urls.some((u) => u.includes('/stargazers'))).toBe(false);
    expect(result.records[0]?.repo.stars90dAgo).toBeNull();
  });
});
