/**
 * 市场装载安装路由测试（票③ market-load-loop · 简报 §6.2/§6.4）。
 *
 * 五分支纪律（简报指定）：成功 / 404 / digest 不符 / 无凭据 / ack 过期——全部走
 * `createTestDaemon`（临时数据根 + 注入 fetch 桩，不连真实 daemon 与 ~/.dforge）。
 * GitHub 桩形态：Trees API（文件清单）+ raw.githubusercontent.com（文件内容）。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';
import { transform } from '@dforge/ingest';
import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson, type TestDaemon } from '../testing/harness.ts';

/** 资产夹具（与 routes/market.test.ts 同族；可覆盖关键字段）。 */
function makeAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gh:acme/skills#skills/pdf-export',
    kind: 'skill',
    name: 'pdf-export',
    displayName: { 'zh-CN': 'PDF 导出', en: 'PDF Export' },
    summary: { 'zh-CN': '把设计稿一键导出为分页 PDF', en: 'Export to PDF' },
    source: {
      repo: 'acme/skills',
      repoId: 42,
      path: 'skills/pdf-export',
      ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      fetchedAt: '2026-10-15T22:05:11Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: 100,
      pushedAt: '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: ['prompt:inject'],
    facets: { category: '网站设计', lane: 'create', mode: 'template', tags: ['pdf'], scenes: [] },
    quality: {
      score: 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: ['subprocess'],
    },
    digest: `sha256:${'c'.repeat(64)}`,
    embeddingRef: null,
    yanked: null,
    ...overrides,
  };
}

function makeIndex(assets: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: MARKETPLACE_INDEX_SCHEMA,
    generatedAt: '2026-10-15T12:00:00Z',
    collector: { name: 'df-market', version: '0.1.0', runId: 'r1', odsWatermark: 'w1' },
    counts: {
      total: assets.length,
      byKind: { skill: assets.length, plugin: 0, 'design-system': 0, template: 0 },
      loadable: assets.length,
    },
    assets,
  };
}

async function seedIndex(daemon: TestDaemon, content: unknown): Promise<void> {
  const dir = join(daemon.dataRoot, 'market');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'df.marketplace.index.v1.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

/** GitHub 桩：Trees API 文件清单 + raw 内容；`missingPaths` 模拟 raw 404。 */
export interface GithubStubOptions {
  repo: string;
  ref: string;
  /** 仓库内完整路径 → 文本内容。 */
  files: Record<string, string>;
  /** 强制 raw 404 的路径（源已移除分支）。 */
  missingPaths?: string[];
  /** Trees API 状态码（默认 200）。 */
  treeStatus?: number;
}

function githubStub(options: GithubStubOptions): typeof fetch {
  return async (url: string | URL | Request): Promise<Response> => {
    const target = typeof url === 'string' ? url : url.toString();
    const treePrefix = `https://api.github.com/repos/${options.repo}/git/trees/`;
    if (target.startsWith(treePrefix)) {
      const status = options.treeStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ message: 'boom' }), { status });
      }
      const entries = Object.keys(options.files).map((path) => ({
        path,
        mode: '100644',
        type: 'blob',
        size: options.files[path]?.length ?? 0,
        sha: 'f'.repeat(40),
      }));
      return new Response(JSON.stringify({ sha: options.ref, tree: entries, truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const rawPrefix = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/`;
    if (target.startsWith(rawPrefix)) {
      const path = target.slice(rawPrefix.length);
      if (options.missingPaths?.includes(path) === true || !(path in options.files)) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(options.files[path] ?? '', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(JSON.stringify({ message: 'stub: unexpected url' }), { status: 404 });
  };
}

/** 规格 §1.6 digest 的独立推导（测试内直接转写规格，不调用被测实现）。 */
function specDigest(files: Record<string, string>): string {
  const lines = Object.entries(files)
    .map(([path, content]) => {
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      return `${path.slice('skills/pdf-export/'.length)}\0sha256:${hash}\0${Buffer.byteLength(
        content,
        'utf8',
      )}\n`;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('');
  return `sha256:${createHash('sha256').update(lines, 'utf8').digest('hex')}`;
}

const ASSET_FILES = {
  'skills/pdf-export/SKILL.md': '# PDF Export\n\n把设计稿导出为分页 PDF。\n',
  'skills/pdf-export/references/notes.md': '导出参数说明。\n',
};

/** 可装载夹具 daemon（凭据注入占位 GH_TOKEN；不走 gh CLI——CI 无凭据口径）。 */
async function createInstallDaemon(
  options: Parameters<typeof createTestDaemon>[0] = {},
): Promise<TestDaemon> {
  return createTestDaemon(options);
}

describe('market install · 装载提案签发一次性 ackToken', () => {
  it('loadable 提案带 ackToken + ackExpiresAt；view-only 提案不带', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        files: ASSET_FILES,
      }),
    });
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset(),
          makeAsset({
            id: 'gh:acme/skills#skills/view-only',
            name: 'view-only',
            installGate: {
              mode: 'view-only',
              licenseGate: 'view-only',
              security: 'pass',
              reasons: ['NOASSERTION'],
              ackRequired: [],
            },
          }),
        ]),
      );
      const loadable = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export' },
      });
      expect(loadable.statusCode).toBe(200);
      const loadableResult = (loadable.payload as { result: Record<string, unknown> }).result;
      expect(typeof loadableResult.ackToken).toBe('string');
      expect((loadableResult.ackToken as string).length).toBeGreaterThan(0);
      expect(typeof loadableResult.ackExpiresAt).toBe('string');

      const viewOnly = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/view-only' },
      });
      expect(viewOnly.statusCode).toBe(200);
      const viewOnlyResult = (viewOnly.payload as { result: Record<string, unknown> }).result;
      expect(viewOnlyResult.ackToken).toBeUndefined();
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知/已消费 ackToken → 403 market_install_ack_invalid（一次性，不静默重放）', async () => {
    const daemon = await createInstallDaemon();
    try {
      await seedIndex(daemon, makeIndex([makeAsset()]));
      const plan = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export' },
      });
      const ackToken = (plan.payload as { result: { ackToken: string } }).result.ackToken;

      // 未知 token
      const unknown = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken: 'deadbeef' },
      });
      expect(unknown.statusCode).toBe(403);
      expect((unknown.payload as { error: { code: string } }).error.code).toBe(
        'market_install_ack_invalid',
      );

      // token 与 assetId 不绑定（拿 A 资产的 token 装 B 资产）同样无效
      await seedIndex(
        daemon,
        makeIndex([makeAsset(), makeAsset({ id: 'gh:acme/skills#skills/other', name: 'other' })]),
      );
      const mismatch = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/other', ackToken },
      });
      expect(mismatch.statusCode).toBe(403);
      expect((mismatch.payload as { error: { code: string } }).error.code).toBe(
        'market_install_ack_invalid',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('过期 ackToken → 410 market_install_ack_expired（短 TTL，审计 decision=expired）', async () => {
    const clock = { now: new Date('2026-11-08T00:00:00Z') };
    const daemon = await createInstallDaemon({
      now: () => clock.now,
      marketInstallAckTtlMs: 1_000,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset()]));
      const plan = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export' },
      });
      const ackToken = (plan.payload as { result: { ackToken: string } }).result.ackToken;
      clock.now = new Date('2026-11-08T00:00:02Z'); // 越过 1s TTL
      const expired = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(expired.statusCode).toBe(410);
      expect((expired.payload as { error: { code: string } }).error.code).toBe(
        'market_install_ack_expired',
      );
      // 过期后审计留痕（decision=expired），且 token 不可再用（一次性语义收敛）
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      const decisions = audit
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { decision: string }).decision);
      expect(decisions).toContain('expired');
      const again = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(again.statusCode).toBe(403);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market install · 真写成功（拉取 → digest 对齐 → 落盘 → 回读 → 审计）', () => {
  const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  /** 期望 digest：测试内按规格 §1.6 独立转写（实现同式但独立成文，防同源伪绿）。 */
  const EXPECTED_DIGEST = specDigest(ASSET_FILES);

  it('digest 转写口径先与 @dforge/ingest computeAssetDigest 对账（独立真源）', () => {
    const oracle = transform.computeAssetDigest(
      Object.entries(ASSET_FILES).map(([path, content]) => ({
        path: path.slice('skills/pdf-export/'.length),
        gitSha: 'f'.repeat(40),
        sha256: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
        size: Buffer.byteLength(content, 'utf8'),
      })),
    );
    expect(oracle.status).toBe('ok');
    expect(oracle.digest).toBe(EXPECTED_DIGEST);
  });

  it('批准后真写 <数据根>/.dfg/market/<kind>/<slug>/：内容一致 + digest 对齐 + 审计只存哈希', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: { env: { GH_TOKEN: 'test-token-123' } },
      now: () => new Date('2026-11-08T00:00:00Z'),
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const plan = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export' },
      });
      const ackToken = (plan.payload as { result: { ackToken: string } }).result.ackToken;

      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(200);
      const result = (installed.payload as { result: Record<string, unknown> }).result;
      expect(result.schema).toBe(MARKETPLACE_INDEX_SCHEMA);
      expect(result.assetId).toBe('gh:acme/skills#skills/pdf-export');
      expect(result.kind).toBe('skill');
      expect(result.slug).toBe('pdf-export');
      expect(result.targetPath).toBe('.dfg/market/skill/pdf-export/');
      expect(result.digest).toBe(EXPECTED_DIGEST);
      expect(result.files).toEqual(['SKILL.md', 'references/notes.md']);
      expect(result.loadedAt).toBe('2026-11-08T00:00:00.000Z');
      expect(typeof result.auditId).toBe('string');

      // 落点真写：`<数据根>/.dfg/market/<kind>/<slug>/`，逐文件回读内容一致
      const target = join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export');
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(
        ASSET_FILES['skills/pdf-export/SKILL.md'],
      );
      expect(await readFile(join(target, 'references', 'notes.md'), 'utf8')).toBe(
        ASSET_FILES['skills/pdf-export/references/notes.md'],
      );

      // 审计：pending + approved（applied=true）；ackToken 与源 token 绝不明文出现
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      const records = audit
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { decision: string; applied: boolean; note: string });
      expect(records.map((record) => record.decision)).toEqual(['pending', 'approved']);
      const approved = records[1];
      expect(approved?.applied).toBe(true);
      expect(audit).not.toContain(ackToken);
      expect(audit).toContain('sha256:');
    } finally {
      await daemon.cleanup();
    }
  });

  it('一次性收敛：装载成功后同一 token 再装 → 403（重复装载须重新出提案）', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: { env: { GH_TOKEN: 'test-token-123' } },
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const plan = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export' },
      });
      const ackToken = (plan.payload as { result: { ackToken: string } }).result.ackToken;
      const first = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(first.statusCode).toBe(200);
      const second = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(second.statusCode).toBe(403);
      expect((second.payload as { error: { code: string } }).error.code).toBe(
        'market_install_ack_invalid',
      );
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market install · 源与内容失败分支（结构化错误，不静默）', () => {
  const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const EXPECTED_DIGEST = specDigest(ASSET_FILES);
  const CREDENTIALS = { env: { GH_TOKEN: 'test-token-123' } };

  async function planToken(daemon: TestDaemon, assetId: string): Promise<string> {
    const plan = await injectJson(daemon.app, {
      method: 'POST',
      url: '/market/load-plan',
      payload: { assetId },
    });
    return (plan.payload as { result: { ackToken: string } }).result.ackToken;
  }

  it('raw 404（源文件已移除）→ 503 source_unavailable，且不写任何文件', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: REF,
        files: ASSET_FILES,
        missingPaths: ['skills/pdf-export/SKILL.md'],
      }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(503);
      const error = (
        installed.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('market_install_source_unavailable');
      expect(error.details?.path).toBe('SKILL.md');
      // 未写入任何文件
      await expect(
        readFile(
          join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
          'utf8',
        ),
      ).rejects.toThrow();
      // 审计如实留痕：approved + applied=false
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('skill 资产缺 SKILL.md（树里有其他文件）→ 503 source_unavailable（SKILL.md 必需）', async () => {
    const files = { 'skills/pdf-export/README.md': 'readme only\n' };
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset()]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(503);
      const error = (installed.payload as { error: { details?: Record<string, unknown> } }).error;
      expect(error.details?.reason).toBe('skill-manifest-missing');
    } finally {
      await daemon.cleanup();
    }
  });

  it('无凭据 → 503 source_unavailable（env 与 gh 均空），且不发出任何源请求', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: { env: {}, ghRunner: () => ({ status: 1, stdout: '' }) },
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(503);
      const error = (
        installed.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('market_install_source_unavailable');
      expect(error.details?.reason).toBe('credentials-missing');
      expect(daemon.fetchCalls).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('digest 不符（索引 digest 与源内容不一致）→ 422 digest_mismatch，未写任何文件', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      // 索引 digest 是故意写错的字面量（损坏/被篡改形态）
      await seedIndex(daemon, makeIndex([makeAsset({ digest: `sha256:${'9'.repeat(64)}` })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(422);
      const error = (
        installed.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('market_install_digest_mismatch');
      expect(error.details?.expected).toBe(`sha256:${'9'.repeat(64)}`);
      expect(error.details?.actual).toBe(EXPECTED_DIGEST);
      await expect(
        readFile(
          join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
          'utf8',
        ),
      ).rejects.toThrow();
      // 审计：approved + applied=false（用户批了，但写入未发生）
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      const records = audit
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { decision: string; applied: boolean });
      expect(records.map((record) => [record.decision, record.applied])).toEqual([
        ['pending', false],
        ['approved', false],
      ]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('提案后索引更新（资产消失）→ 404 market_install_asset_not_found', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      // 提案后索引被重建，资产消失
      await seedIndex(daemon, makeIndex([]));
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(404);
      expect((installed.payload as { error: { code: string } }).error.code).toBe(
        'market_install_asset_not_found',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('不安全落点（资产名含路径穿越）→ 400 target_invalid，绝不写穿数据根', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({ id: 'gh:acme/skills#evil', name: '../evil', digest: EXPECTED_DIGEST }),
        ]),
      );
      const ackToken = await planToken(daemon, 'gh:acme/skills#evil');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#evil', ackToken },
      });
      expect(installed.statusCode).toBe(400);
      expect((installed.payload as { error: { code: string } }).error.code).toBe(
        'market_install_target_invalid',
      );
      // 数据根外不存在 evil 目录
      await expect(readFile(join(daemon.dataRoot, 'evil', 'SKILL.md'), 'utf8')).rejects.toThrow();
      await expect(
        readFile(join(daemon.dataRoot, '.dfg', 'evil', 'SKILL.md'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await daemon.cleanup();
    }
  });
});
