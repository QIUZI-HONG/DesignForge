/**
 * GitHub REST 客户端（规格 §3：公开只读端点；§8.1 合规口径）。
 *
 * 职责：
 *  - 凭据解析：`GH_TOKEN`/`GITHUB_TOKEN` 环境变量优先，其次 `gh auth token`
 *    （不落盘、不打印；无凭据 → 调用方按 exit 2 阻塞，绝不匿名轮换）；
 *  - 端点封装：`repos/{o}/{r}`、`git/ref/heads/{branch}`、`git/trees/{ref}?recursive=1`、
 *    `contents/{path}`、`search/repositories`、`rate_limit` —— **全部 GET**；
 *  - 条件请求：core 资源带 `If-None-Match`，304 → 返回缓存解析结果（不重复下载）；
 *  - 录制/重放：录制 fetch 写 JSONL 样本；重放 fetch 离线复跑（缺样本抛
 *    `ReplayMissError`——明确阻塞，不静默伪造）。
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import type { FetchLike, HttpDeps, HttpResponseLike } from './http.ts';
import { requestText } from './http.ts';
import type { CandidateSource, RepoMeta, TreeEntry } from './types.ts';

/** 上游非 2xx/304 响应（由调用方分类处理：404 跳过、403/429 已由退避层处理）。 */
export class UpstreamError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number) {
    super(`上游响应异常：HTTP ${status}（${url}）`);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
  }
}

/** 重放样本缺失（离线复跑明确阻塞）。 */
export class ReplayMissError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`离线样本缺失：${url}（重放不触网；请补齐样本集或改跑真网）`);
    this.name = 'ReplayMissError';
    this.url = url;
  }
}

/** 凭据解析结果（来源可审计）。 */
export interface TokenResolution {
  token: string;
  source: 'env' | 'gh';
}

/**
 * 解析 GitHub 凭据：环境变量优先，其次 `gh auth token`。
 * `run` 可注入（测试）；返回 null 表示无凭据 → 上层按 exit 2 阻塞。
 */
export function resolveGitHubToken(
  env: Record<string, string | undefined>,
  run: (cmd: string, args: string[]) => { status: number; stdout: string },
): TokenResolution | null {
  const envToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (envToken !== undefined && envToken.trim() !== '') {
    return { token: envToken.trim(), source: 'env' };
  }
  const result = run('gh', ['auth', 'token']);
  if (result.status === 0 && result.stdout.trim() !== '') {
    return { token: result.stdout.trim(), source: 'gh' };
  }
  return null;
}

/** 生产用：spawnSync 调 `gh auth token`。 */
export function ghAuthTokenRunner(): { status: number; stdout: string } {
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/** 解析仓库元数据（缺字段给安全默认；`license.spdx_id=null` 原样保留）。 */
export function parseRepoMeta(json: unknown): RepoMeta {
  const record = (json ?? {}) as Record<string, unknown>;
  const fullName = typeof record.full_name === 'string' ? record.full_name : '';
  const [owner = '', name = ''] = fullName.split('/');
  const license = record.license;
  const licenseRecord =
    license !== null && typeof license === 'object' ? (license as Record<string, unknown>) : null;
  return {
    id: typeof record.id === 'number' ? record.id : 0,
    fullName,
    owner,
    name,
    defaultBranch: typeof record.default_branch === 'string' ? record.default_branch : 'main',
    stars: typeof record.stargazers_count === 'number' ? record.stargazers_count : 0,
    forks: typeof record.forks_count === 'number' ? record.forks_count : 0,
    pushedAt: typeof record.pushed_at === 'string' ? record.pushed_at : '',
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : '',
    archived: record.archived === true,
    fork: record.fork === true,
    sizeKb: typeof record.size === 'number' ? record.size : 0,
    homepage: typeof record.homepage === 'string' ? record.homepage : null,
    description: typeof record.description === 'string' ? record.description : null,
    topics: Array.isArray(record.topics)
      ? record.topics.filter((t): t is string => typeof t === 'string')
      : [],
    licenseSpdx:
      licenseRecord !== null && typeof licenseRecord.spdx_id === 'string'
        ? (licenseRecord.spdx_id as string)
        : null,
    licenseName:
      licenseRecord !== null && typeof licenseRecord.name === 'string'
        ? (licenseRecord.name as string)
        : null,
  };
}

/** 解析 Trees 响应。 */
export function parseTree(json: unknown): {
  entries: TreeEntry[];
  treeSha: string;
  truncated: boolean;
} {
  const record = (json ?? {}) as Record<string, unknown>;
  const rawTree = Array.isArray(record.tree) ? record.tree : [];
  const entries: TreeEntry[] = [];
  for (const raw of rawTree) {
    if (raw === null || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const path = item.path;
    const type = item.type;
    if (typeof path !== 'string') continue;
    if (type !== 'blob' && type !== 'tree' && type !== 'commit') continue;
    const entry: TreeEntry = {
      path,
      type,
      sha: typeof item.sha === 'string' ? item.sha : '',
    };
    if (typeof item.size === 'number') entry.size = item.size;
    entries.push(entry);
  }
  return {
    entries,
    treeSha: typeof record.sha === 'string' ? record.sha : '',
    truncated: record.truncated === true,
  };
}

/**
 * 解码 contents 端点正文（base64 → 文本）。
 * 目录/符号链接/超过 1MB（`encoding: 'none'`）→ null（= 未取回，如实记录）。
 */
export function decodeContentsText(json: unknown): string | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  if (record.encoding !== 'base64') return null;
  const content = record.content;
  if (typeof content !== 'string' || content.trim() === '') return null;
  return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
}

export interface GitHubClient extends CandidateSource {
  getRepoMeta(repo: string): Promise<{ meta: RepoMeta; etag: string | null; cacheHit: boolean }>;
  /** 分支头 commit sha（规格 §1.3 `source.ref` 依据）。 */
  getRef(repo: string, branch: string): Promise<{ commitSha: string | null; cacheHit: boolean }>;
  getTree(
    repo: string,
    ref: string,
  ): Promise<{
    entries: TreeEntry[];
    treeSha: string;
    truncated: boolean;
    etag: string | null;
    cacheHit: boolean;
  }>;
  getContents(
    repo: string,
    path: string,
    ref: string,
  ): Promise<{ text: string | null; cacheHit: boolean }>;
  searchByUrl(url: string): Promise<{ json: unknown; linkNext: string | null }>;
  getRateLimit(): Promise<{ json: unknown }>;
  stats(): { coreCalls: number; searchCalls: number; cacheHits304: number };
}

/**
 * ETag 缓存存储（规格 §3.2：`{etag, last_modified, body_digest, fetched_at}` 本地缓存；
 * 304 命中 → 不重复下载、不计主限额）。MK-01 用 JSON 文件持久化（复用 HTTP 缓存语义），
 * 后续 MK-02 落 SQLite `http_cache` 表可平滑替换。
 */
export interface JsonCacheStore {
  get(url: string): { etag: string | null; bodyText: string } | undefined;
  set(url: string, entry: { etag: string | null; bodyText: string }): void;
}

/** 单条缓存正文上限（超过则不落盘：避免把 4MB 级 Trees 塞进缓存文件）。 */
export const CACHE_BODY_MAX_BYTES = 512 * 1024;

/** 内存缓存（默认；单次运行内 304 短路）。 */
export function createMemoryCacheStore(): JsonCacheStore {
  const map = new Map<string, { etag: string | null; bodyText: string }>();
  return {
    get: (url) => map.get(url),
    set: (url, entry) => {
      if (Buffer.byteLength(entry.bodyText, 'utf8') > CACHE_BODY_MAX_BYTES) return;
      map.set(url, entry);
    },
  };
}

/** 文件缓存句柄（`save()` 仅在脏时写盘）。 */
export interface FileCacheStore extends JsonCacheStore {
  save(): Promise<void>;
  size(): number;
}

/**
 * 加载/创建文件缓存（跨运行复用 ETag + 正文；304 命中即近零成本巡检，规格 §3.2）。
 * 文件不存在/损坏 → 空缓存起步（首次运行），不报错。
 */
export async function loadFileCacheStore(cacheFilePath: string): Promise<FileCacheStore> {
  let entries: Record<string, { etag: string | null; bodyText: string }> = {};
  try {
    const parsed = JSON.parse(await readFile(cacheFilePath, 'utf8')) as {
      entries?: Record<string, { etag: string | null; bodyText: string }>;
    };
    entries = parsed.entries ?? {};
  } catch {
    entries = {};
  }
  const map = new Map(Object.entries(entries));
  let dirty = false;
  return {
    get: (url) => map.get(url),
    set: (url, entry) => {
      if (Buffer.byteLength(entry.bodyText, 'utf8') > CACHE_BODY_MAX_BYTES) return;
      map.set(url, entry);
      dirty = true;
    },
    size: () => map.size,
    save: async () => {
      if (!dirty) return;
      dirty = false;
      await writeFile(
        cacheFilePath,
        `${JSON.stringify({ schema: 'df.market.etag-cache/v1', entries: Object.fromEntries(map) })}\n`,
        'utf8',
      );
    },
  };
}

export interface ClientOptions {
  deps: HttpDeps;
  /** 凭据；null = 未认证（重放模式允许；真网运行由上层保证非空）。 */
  token: string | null;
  /** ETag 缓存存储（默认内存；真网运行注入文件缓存以跨运行复用）。 */
  cacheStore?: JsonCacheStore;
}

const API = 'https://api.github.com';

/**
 * 创建真实客户端。所有请求经 `requestText`（GET-only + 串行 + 桶 + 退避 + 事件留痕）；
 * 本层维护 URL → {etag, json} 缓存以支持 304 短路。
 */
export function createGitHubClient(opts: ClientOptions): GitHubClient {
  const { deps, token } = opts;
  const cache: JsonCacheStore = opts.cacheStore ?? createMemoryCacheStore();
  const headers: Record<string, string> = {};
  if (token !== null && token !== '') headers.authorization = `Bearer ${token}`;

  async function getJson(
    url: string,
    kind: 'core' | 'search',
  ): Promise<{ json: unknown; etag: string | null; cacheHit: boolean; linkNext: string | null }> {
    // 仅当本地持有同 URL 的 ETag+正文时才发条件请求（否则强制 200，避免 304 无法还原结果）。
    const cached = kind === 'core' ? cache.get(url) : undefined;
    const outcome = await requestText(deps, {
      url,
      kind,
      headers,
      ...(cached !== undefined && cached.etag !== null ? { ifNoneMatch: cached.etag } : {}),
      ...(kind === 'search' ? { useEtag: false } : {}),
    });
    if (outcome.cacheHit && cached !== undefined) {
      let json: unknown = null;
      try {
        json = JSON.parse(cached.bodyText);
      } catch {
        throw new UpstreamError(url, outcome.status);
      }
      return { json, etag: cached.etag, cacheHit: true, linkNext: null };
    }
    if (!outcome.ok) throw new UpstreamError(url, outcome.status);
    let json: unknown = null;
    if (outcome.bodyText !== null) {
      try {
        json = JSON.parse(outcome.bodyText);
      } catch {
        throw new UpstreamError(url, outcome.status);
      }
      if (kind === 'core') cache.set(url, { etag: outcome.etag, bodyText: outcome.bodyText });
    }
    return { json, etag: outcome.etag, cacheHit: false, linkNext: outcome.linkNext };
  }

  return {
    async getRepoMeta(repo) {
      const url = `${API}/repos/${repo}`;
      const { json, etag, cacheHit } = await getJson(url, 'core');
      return { meta: parseRepoMeta(json), etag, cacheHit };
    },
    async getRef(repo, branch) {
      const url = `${API}/repos/${repo}/git/ref/heads/${branch}`;
      const { json, cacheHit } = await getJson(url, 'core');
      const record = (json ?? {}) as Record<string, unknown>;
      const object = record.object;
      const commitSha =
        object !== null &&
        typeof object === 'object' &&
        typeof (object as Record<string, unknown>).sha === 'string'
          ? ((object as Record<string, unknown>).sha as string)
          : null;
      return { commitSha, cacheHit };
    },
    async getTree(repo, ref) {
      const url = `${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
      const { json, etag, cacheHit } = await getJson(url, 'core');
      const parsed = parseTree(json);
      return { ...parsed, etag, cacheHit };
    },
    async getContents(repo, path, ref) {
      const url = `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
      const { json, cacheHit } = await getJson(url, 'core');
      return { text: decodeContentsText(json), cacheHit };
    },
    async searchByUrl(url) {
      const { json, linkNext } = await getJson(url, 'search');
      return { json, linkNext };
    },
    async getRateLimit() {
      const { json } = await getJson(`${API}/rate_limit`, 'core');
      return { json };
    },
    stats() {
      const snapshot = deps.ledger.snapshot();
      return {
        coreCalls: snapshot.coreTotal,
        searchCalls: snapshot.searchTotal,
        cacheHits304: snapshot.cacheHits304,
      };
    },
  };
}

/** 一条录制样本（JSONL 每行）。 */
export interface RecordedResponse {
  url: string;
  status: number;
  etag: string | null;
  linkNext: string | null;
  body: unknown;
}

/**
 * 录制 fetch：把每次响应以 JSONL 行写入 `sink`，同时返回可再次读取的响应。
 * 录制的是**公开只读元数据与描述性文本**（合规口径：不落私有内容）。
 */
export function createRecordingFetch(inner: FetchLike, sink: (line: string) => void): FetchLike {
  return async (url, init) => {
    const response: HttpResponseLike = await inner(url, init);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // 非 JSON（理论上不会发生）：按原文记录。
    }
    const record: RecordedResponse = {
      url,
      status: response.status,
      etag: response.headers.get('etag'),
      linkNext: response.headers.get('link'),
      body,
    };
    sink(JSON.stringify(record));
    return {
      status: response.status,
      headers: response.headers,
      text: async () => text,
    };
  };
}

/** 解析 JSONL 样本为录制响应数组（重放入口）。 */
export function parseRecordedResponses(jsonl: string): RecordedResponse[] {
  const out: RecordedResponse[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const parsed = JSON.parse(trimmed) as RecordedResponse;
    out.push(parsed);
  }
  return out;
}

/**
 * 重放 fetch：离线复跑（**不触网**）。
 * 命中样本 → 按录制状态返回；未命中 → `ReplayMissError`（明确阻塞）。
 */
export function createReplayFetch(responses: RecordedResponse[]): FetchLike {
  const byUrl = new Map<string, RecordedResponse>();
  for (const response of responses) byUrl.set(response.url, response);
  return async (url) => {
    const recorded = byUrl.get(url);
    if (!recorded) throw new ReplayMissError(url);
    const headers = new Map<string, string>();
    if (recorded.etag !== null) headers.set('etag', recorded.etag);
    if (recorded.linkNext !== null) headers.set('link', recorded.linkNext);
    return {
      status: recorded.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: async () =>
        typeof recorded.body === 'string' ? recorded.body : JSON.stringify(recorded.body),
    };
  };
}
