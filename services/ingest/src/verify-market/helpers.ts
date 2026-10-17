/**
 * 验证线（test/verify-market）共享夹具：剧本化 fetch、临时目录、两仓脚本。
 *
 * 独立于产品夹具（`collect/__fixtures__`）——验证方视角自造夹具，避免与被验对象共享假设。
 * 全程离线：真网路径一律用剧本化 fetch，重放路径不做任何网络出口。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchLike, HttpResponseLike } from '../collect/http.ts';

export const COMMIT = 'c'.repeat(40);
export const AS_OF_MS = Date.parse('2026-10-15T12:00:00Z');
export const RUN_ID = '20261015-1200';

const tempDirs: string[] = [];

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface ScriptedStep {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface ScriptedFetch {
  fetchImpl: FetchLike;
  calls: { url: string; init: { method: string; headers: Record<string, string> } }[];
  remaining: () => number;
}

/** 按调用顺序返回预设响应的 fetch（不触网）。 */
export function scriptedFetch(script: ScriptedStep[]): ScriptedFetch {
  const calls: ScriptedFetch['calls'] = [];
  let index = 0;
  return {
    calls,
    remaining: () => script.length - index,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const step = script[index];
      index += 1;
      if (step === undefined) throw new Error(`scriptedFetch：第 ${index} 次调用无剧本（${url}）`);
      const headers = new Map(Object.entries(step.headers ?? {}));
      const response: HttpResponseLike = {
        status: step.status,
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        text: async () => step.body ?? '',
      };
      return response;
    },
  };
}

export function jsonStep(
  json: unknown,
  opts: { status?: number; etag?: string; headers?: Record<string, string> } = {},
): ScriptedStep {
  return {
    status: opts.status ?? 200,
    headers: { ...(opts.etag === undefined ? {} : { etag: opts.etag }), ...(opts.headers ?? {}) },
    body: JSON.stringify(json),
  };
}

export function contentStep(text: string | Buffer, etag?: string): ScriptedStep {
  return {
    status: 200,
    ...(etag === undefined ? {} : { headers: { etag } }),
    body: JSON.stringify({
      encoding: 'base64',
      content: Buffer.from(text).toString('base64'),
    }),
  };
}

export function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

export function contentBody(text: string): string {
  return JSON.stringify({ encoding: 'base64', content: b64(text) });
}

export interface RepoMetaOverrides {
  id?: number;
  stars?: number;
  forks?: number;
  archived?: boolean;
  createdAt?: string;
  pushedAt?: string;
  licenseSpdx?: string | null;
  topics?: string[];
}

/** 一仓 meta 响应体（形状对齐 GitHub REST）。 */
export function repoMeta(fullName: string, over: RepoMetaOverrides = {}): Record<string, unknown> {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id: over.id ?? 900001,
    full_name: fullName,
    name,
    owner: { login: owner },
    description: 'verify-market fixture',
    default_branch: 'main',
    stargazers_count: over.stars ?? 100,
    forks_count: over.forks ?? 5,
    pushed_at: over.pushedAt ?? '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    created_at: over.createdAt ?? '2020-01-01T00:00:00Z',
    archived: over.archived ?? false,
    fork: false,
    size: 128,
    homepage: null,
    topics: over.topics ?? [],
    license:
      over.licenseSpdx === null
        ? null
        : { spdx_id: over.licenseSpdx ?? 'MIT', name: over.licenseSpdx ?? 'MIT License' },
  };
}

export function treeBody(entries: { path: string; type?: 'blob' | 'tree'; size?: number }[]): {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; sha: string; size?: number }[];
} {
  return {
    sha: 'tree-sha',
    truncated: false,
    tree: entries.map((entry, index) => ({
      path: entry.path,
      type: entry.type ?? 'blob',
      sha: `blob-${index}`.padEnd(40, '0'),
      ...(entry.size === undefined ? {} : { size: entry.size }),
    })),
  };
}

/**
 * 单仓剧本（meta → ref → tree → LICENSE → SKILL.md，5 次请求）。
 * 注意：真网路径受令牌桶节流（4 次突发后 1 次/秒），测试请给足超时。
 */
export function oneRepoScript(): ScriptedStep[] {
  const skillDoc = `---\nname: pdf-export\ndescription: 导出 PDF\n---\n\n${'正文内容。'.repeat(60)}`;
  return [
    jsonStep(repoMeta('acme/skills', { id: 900001, stars: 500 }), { etag: 'W/"a-meta"' }),
    jsonStep({ object: { sha: COMMIT, type: 'commit' } }, { etag: 'W/"a-ref"' }),
    jsonStep(
      treeBody([
        { path: 'LICENSE', size: 40 },
        { path: 'skills/pdf-export/SKILL.md', size: 400 },
      ]),
      { etag: 'W/"a-tree"' },
    ),
    contentStep('MIT License\n\nCopyright (c) 2026 acme', 'W/"a-lic"'),
    contentStep(skillDoc, 'W/"a-skill"'),
  ];
}

/**
 * 两仓完整剧本（每仓：meta → ref → tree → LICENSE → 内容…）。
 * 仓 A = 单技能根；仓 B = 单模板根（含渲染产物）。
 */
export function twoRepoScript(): ScriptedStep[] {
  const skillDoc = `---\nname: pdf-export\ndescription: 导出 PDF\n---\n\n${'正文内容。'.repeat(60)}`;
  const templateJson = JSON.stringify({ name: 'poster-kit', templates: ['page.html'] });
  return [
    jsonStep(repoMeta('acme/skills', { id: 900001, stars: 500 }), { etag: 'W/"a-meta"' }),
    jsonStep({ object: { sha: COMMIT, type: 'commit' } }, { etag: 'W/"a-ref"' }),
    jsonStep(
      treeBody([
        { path: 'LICENSE', size: 40 },
        { path: 'skills/pdf-export/SKILL.md', size: 400 },
      ]),
      { etag: 'W/"a-tree"' },
    ),
    contentStep('MIT License\n\nCopyright (c) 2026 acme', 'W/"a-lic"'),
    contentStep(skillDoc, 'W/"a-skill"'),
    jsonStep(repoMeta('acme/templates', { id: 900002, stars: 80 }), { etag: 'W/"b-meta"' }),
    jsonStep({ object: { sha: COMMIT, type: 'commit' } }, { etag: 'W/"b-ref"' }),
    jsonStep(
      treeBody([
        { path: 'LICENSE', size: 40 },
        { path: 'templates/poster-kit/template.json', size: 80 },
        { path: 'templates/poster-kit/page.html', size: 200 },
      ]),
      { etag: 'W/"b-tree"' },
    ),
    contentStep('MIT License\n\nCopyright (c) 2026 acme', 'W/"b-lic"'),
    contentStep(templateJson, 'W/"b-tpl"'),
    contentStep('<html><body>poster</body></html>', 'W/"b-html"'),
  ];
}
