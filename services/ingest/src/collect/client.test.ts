/**
 * GitHub 客户端测试（规格 §3.2/§3.4/§4.3）。
 *
 * 断言外部行为：GET 语义、认证头、ETag 条件请求与 304 短路（返回缓存解析结果）、
 * contents base64 解码、tree 解析（truncated 如实上报）、搜索不量 ETag、
 * 录制/重放（离线复跑不触网、缺样本明确报错）、凭据解析优先级。
 */

import { describe, expect, it } from 'vitest';
import type { ScriptedStep } from './__fixtures__/http-harness.ts';
import { jsonStep, makeHttpHarness } from './__fixtures__/http-harness.ts';
import {
  CACHE_BODY_MAX_BYTES,
  createGitHubClient,
  createRecordingFetch,
  createReplayFetch,
  decodeContentsText,
  loadFileCacheStore,
  parseRepoMeta,
  parseTree,
  ReplayMissError,
  resolveGitHubToken,
  UpstreamError,
} from './client.ts';

const REPO_JSON = {
  id: 1061953414,
  full_name: 'anthropics/skills',
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

const TREE_JSON = {
  sha: 'tree-sha-1',
  truncated: false,
  tree: [
    { path: 'skills', type: 'tree', sha: 's1' },
    { path: 'skills/pdf/SKILL.md', type: 'blob', sha: 'b1', size: 1200 },
  ],
};

const CONTENTS_JSON = {
  type: 'file',
  encoding: 'base64',
  path: 'skills/pdf/SKILL.md',
  name: 'SKILL.md',
  size: 20,
  content: Buffer.from('---\nname: pdf\n---\n', 'utf8').toString('base64'),
};

function makeClient(script: ScriptedStep[], token: string | null = 'tok-1') {
  const harness = makeHttpHarness(script);
  const client = createGitHubClient({ deps: harness.deps, token });
  return { ...harness, client };
}

describe('resolveGitHubToken 凭据解析（不落盘、不打印）', () => {
  it('环境变量优先（GH_TOKEN → GITHUB_TOKEN），其次 gh auth token', () => {
    expect(resolveGitHubToken({ GH_TOKEN: 'env-1' }, () => ({ status: 1, stdout: '' }))).toEqual({
      token: 'env-1',
      source: 'env',
    });
    expect(
      resolveGitHubToken({ GITHUB_TOKEN: 'env-2' }, () => ({ status: 1, stdout: '' })),
    ).toEqual({
      token: 'env-2',
      source: 'env',
    });
    expect(resolveGitHubToken({}, () => ({ status: 0, stdout: 'gh-token\n' }))).toEqual({
      token: 'gh-token',
      source: 'gh',
    });
  });

  it('都没有 → null（调用方按 exit 2 阻塞，不伪造数据）', () => {
    expect(resolveGitHubToken({}, () => ({ status: 1, stdout: '' }))).toBeNull();
    expect(resolveGitHubToken({}, () => ({ status: 0, stdout: '\n' }))).toBeNull();
  });
});

describe('createGitHubClient 请求行为', () => {
  it('getRepoMeta：GET + Bearer 认证；解析字段；ETag 留痕', async () => {
    const { client, script } = makeClient([jsonStep(REPO_JSON, { etag: 'W/"repo-1"' })]);
    const result = await client.getRepoMeta('anthropics/skills');

    expect(script.calls[0]?.init.method).toBe('GET');
    expect(script.calls[0]?.init.headers.authorization).toBe('Bearer tok-1');
    expect(result.meta.fullName).toBe('anthropics/skills');
    expect(result.meta.stars).toBe(181306);
    expect(result.meta.licenseSpdx).toBeNull();
    expect(result.etag).toBe('W/"repo-1"');
    expect(result.cacheHit).toBe(false);
  });

  it('304 → 返回缓存解析结果（不重复解析），cacheHit 标记', async () => {
    const { client, script } = makeClient([
      jsonStep(REPO_JSON, { etag: 'W/"repo-1"' }),
      { status: 304, headers: { etag: 'W/"repo-1"' } },
    ]);

    const first = await client.getRepoMeta('anthropics/skills');
    const second = await client.getRepoMeta('anthropics/skills');

    expect(script.calls[1]?.init.headers['if-none-match']).toBe('W/"repo-1"');
    expect(second.cacheHit).toBe(true);
    expect(second.meta).toEqual(first.meta);
    expect(client.stats().cacheHits304).toBe(1);
  });

  it('getTree：recursive=1 单次调用；truncated 如实上报', async () => {
    const { client, script } = makeClient([jsonStep({ ...TREE_JSON, truncated: true })]);
    const result = await client.getTree('anthropics/skills', 'main');
    expect(script.calls[0]?.url).toContain('/git/trees/main?recursive=1');
    expect(result.truncated).toBe(true);
    expect(result.entries.map((e) => e.path)).toEqual(['skills', 'skills/pdf/SKILL.md']);
  });

  it('getContents：base64 解码为描述性文本；大文件 encoding=none 视作未取回', async () => {
    const { client } = makeClient([
      jsonStep(CONTENTS_JSON),
      jsonStep({ type: 'file', encoding: 'none', size: 2_000_000, content: '' }),
    ]);
    const ok = await client.getContents('anthropics/skills', 'skills/pdf/SKILL.md', 'main');
    expect(ok.text).toBe('---\nname: pdf\n---\n');

    const tooBig = await client.getContents('anthropics/skills', 'big.bin', 'main');
    expect(tooBig.text).toBeNull();
  });

  it('getRef：解析 commit sha（source.ref 依据）', async () => {
    const { client, script } = makeClient([
      jsonStep({ ref: 'refs/heads/main', object: { sha: 'a'.repeat(40), type: 'commit' } }),
    ]);
    const ref = await client.getRef('anthropics/skills', 'main');
    expect(ref.commitSha).toBe('a'.repeat(40));
    expect(script.calls[0]?.url).toContain('/git/ref/heads/main');
  });

  it('searchByUrl：不携带 If-None-Match（列表端点天然漂移，规格 §3.2）', async () => {
    const { client, script } = makeClient([
      jsonStep(
        { items: [], total_count: 0 },
        { link: '<https://api.github.com/x?page=2>; rel="next"' },
      ),
    ]);
    const page = await client.searchByUrl('https://api.github.com/search/repositories?q=x');
    expect(page.linkNext).toBe('https://api.github.com/x?page=2');
    expect(script.calls[0]?.init.headers['if-none-match']).toBeUndefined();
    expect(script.calls[0]?.init.headers.authorization).toBe('Bearer tok-1');
  });
});

describe('上游异常分类（调用方按 status 分类，不静默吞）', () => {
  it('404 → UpstreamError（仓不存在/权限不足，规格 §3.4：不重试、记录并跳过）', async () => {
    const { client } = makeClient([{ status: 404, body: '{"message":"Not Found"}' }]);
    await expect(client.getRepoMeta('ghost/ghost')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('parseRepoMeta / parseTree / decodeContentsText 解析', () => {
  it('parseRepoMeta 缺字段时给安全默认', () => {
    const meta = parseRepoMeta({ id: 1, full_name: 'a/b' });
    expect(meta).toMatchObject({
      id: 1,
      fullName: 'a/b',
      owner: 'a',
      name: 'b',
      stars: 0,
      archived: false,
    });
    expect(meta.licenseSpdx).toBeNull();
  });

  it('parseTree 过滤非法条目', () => {
    const parsed = parseTree({
      sha: 't',
      truncated: false,
      tree: [{ path: 'a', type: 'blob', sha: 's' }, { path: 123 }, null],
    });
    expect(parsed.entries).toHaveLength(1);
  });

  it('decodeContentsText：非 base64/目录/超限统一返回 null', () => {
    expect(decodeContentsText({ encoding: 'base64', content: '' })).toBeNull();
    expect(decodeContentsText([{ type: 'file' }])).toBeNull();
    expect(decodeContentsText(null)).toBeNull();
  });
});

describe('loadFileCacheStore 跨运行 ETag 缓存（规格 §3.2）', () => {
  it('不存在/损坏 → 空缓存起步；写入后可跨实例读回（304 近零成本巡检基础）', async () => {
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'mk01-cache-'));
    try {
      const path = join(dir, 'etag-cache.json');
      const first = await loadFileCacheStore(path);
      expect(first.size()).toBe(0);

      first.set('https://api.github.com/repos/a/b', { etag: 'W/"e"', bodyText: '{"id":1}' });
      await first.save();

      const second = await loadFileCacheStore(path);
      expect(second.get('https://api.github.com/repos/a/b')).toEqual({
        etag: 'W/"e"',
        bodyText: '{"id":1}',
      });
      expect(JSON.parse(readFileSync(path, 'utf8')).schema).toBe('df.market.etag-cache/v1');

      writeFileSync(path, '{ 坏 JSON', 'utf8');
      const third = await loadFileCacheStore(path);
      expect(third.size()).toBe(0); // 损坏 → 空起步，不抛错
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('超大正文不落盘（避免 4MB 级 Trees 塞进缓存文件）', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'mk01-cache2-'));
    try {
      const store = await loadFileCacheStore(join(dir, 'etag-cache.json'));
      store.set('https://api.github.com/big', {
        etag: 'W/"big"',
        bodyText: 'x'.repeat(CACHE_BODY_MAX_BYTES + 1),
      });
      expect(store.size()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('录制与重放（规格 §4.3：离线复跑不触网）', () => {
  it('录制 fetch：写 JSONL 行（url/status/etag/linkNext/body），返回可再次读取的响应', async () => {
    const lines: string[] = [];
    const harness = makeHttpHarness([
      jsonStep(REPO_JSON, { etag: 'W/"e"', link: '<next>; rel="next"' }),
    ]);
    const recordingFetch = createRecordingFetch(harness.deps.fetchImpl, (line) => lines.push(line));

    const res = await recordingFetch('https://api.github.com/repos/a/b', {
      method: 'GET',
      headers: {},
    });
    const text = await res.text();
    expect(text).toContain('anthropics/skills');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      url: 'https://api.github.com/repos/a/b',
      status: 200,
      etag: 'W/"e"',
      linkNext: '<next>; rel="next"',
      body: { full_name: 'anthropics/skills' },
    });
  });

  it('重放 fetch：命中返回录制响应；未命中抛 ReplayMissError（明确阻塞，不静默）', async () => {
    const replayFetch = createReplayFetch([
      {
        url: 'https://api.github.com/repos/a/b',
        status: 200,
        etag: 'W/"e"',
        linkNext: null,
        body: REPO_JSON,
      },
    ]);

    const res = await replayFetch('https://api.github.com/repos/a/b', {
      method: 'GET',
      headers: {},
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ full_name: 'anthropics/skills' });

    await expect(
      replayFetch('https://api.github.com/repos/nope/nope', { method: 'GET', headers: {} }),
    ).rejects.toBeInstanceOf(ReplayMissError);
  });

  it('重放端到端：client 走重放 fetch，零网络产出相同解析结果', async () => {
    const harness = makeHttpHarness([jsonStep(REPO_JSON, { etag: 'W/"e"' })]);
    const replayFetch = createReplayFetch([
      {
        url: 'https://api.github.com/repos/anthropics/skills',
        status: 200,
        etag: 'W/"e"',
        linkNext: null,
        body: REPO_JSON,
      },
    ]);
    const client = createGitHubClient({
      deps: { ...harness.deps, fetchImpl: replayFetch },
      token: null,
    });
    const result = await client.getRepoMeta('anthropics/skills');
    expect(result.meta.fullName).toBe('anthropics/skills');
    expect(harness.script.calls).toHaveLength(0); // 原 fetch 未被触及
  });
});
