/**
 * 市场装载安装路由测试（票③ market-load-loop · 简报 §6.2/§6.4）。
 *
 * 五分支纪律（简报指定）：成功 / 404 / digest 不符 / 无凭据 / ack 过期——全部走
 * `createTestDaemon`（临时数据根 + 注入 fetch 桩，不连真实 daemon 与 ~/.dforge）。
 * GitHub 桩形态：Trees API（文件清单）+ raw.githubusercontent.com（文件内容）。
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MarketAsset } from '@dforge/contracts';
import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';
import { transform } from '@dforge/ingest';
import { describe, expect, it } from 'vitest';

import { createMarketInstallService } from '../market/install.ts';
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
  /**
   * 清单里虚报超大 size 的路径（评审 F2）：内容照常给（小文本），但 Trees 条目 size
   * 报成超过 MAX_FILE_BYTES 的值——断言预检在 raw 下载前即终态失败。
   */
  oversizedPaths?: string[];
  /** 记录收到的全部请求 URL（票 A · A1：断言 raw 下载 URL 的段级编码形态）。 */
  recordUrls?: string[];
}

function githubStub(options: GithubStubOptions): typeof fetch {
  return async (url: string | URL | Request): Promise<Response> => {
    const target = typeof url === 'string' ? url : url.toString();
    options.recordUrls?.push(target);
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
        size:
          options.oversizedPaths?.includes(path) === true
            ? 11 * 1024 * 1024
            : (options.files[path]?.length ?? 0),
        sha: 'f'.repeat(40),
      }));
      return new Response(JSON.stringify({ sha: options.ref, tree: entries, truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const rawPrefix = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/`;
    if (target.startsWith(rawPrefix)) {
      // 装载侧按段级编码请求（票 A · A1）：stub 模拟源站行为——收到编码 URL 后按
      // 解码路径命中真实文件（全 ASCII 路径解码后不变，既有用例不受影响）。
      const path = decodeURIComponent(target.slice(rawPrefix.length));
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

/** 规格 §1.6 digest 的独立推导（测试内直接转写规格，不调用被测实现）。
 * `assetPath` 为资产根（缺省夹具前缀；仓根资产传 ''——相对路径即仓库内完整路径）。 */
function specDigest(files: Record<string, string>, assetPath = 'skills/pdf-export'): string {
  const cut = assetPath.length === 0 ? 0 : assetPath.length + 1;
  const lines = Object.entries(files)
    .map(([path, content]) => {
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      return `${path.slice(cut)}\0sha256:${hash}\0${Buffer.byteLength(content, 'utf8')}\n`;
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

  it('仓根资产（path=""，F5）→ 装载全仓文件成功（对齐 ingest schema 的 allowEmpty 语义）', async () => {
    const rootFiles = {
      'SKILL.md': '# Root Skill\n\n整仓即资产。\n',
      'references/notes.md': '根级参考。\n',
    };
    const rootDigest = specDigest(rootFiles, '');
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: rootFiles }),
      marketInstallCredentials: { env: { GH_TOKEN: 'test-token-123' } },
    });
    try {
      const base = makeAsset();
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({
            id: 'gh:acme/skills#',
            name: 'root-skill',
            digest: rootDigest,
            source: { ...(base.source as Record<string, unknown>), path: '' },
          }),
        ]),
      );
      const plan = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:acme/skills#' },
      });
      expect(plan.statusCode).toBe(200);
      const ackToken = (plan.payload as { result: { ackToken: string } }).result.ackToken;
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#', ackToken },
      });
      expect(installed.statusCode).toBe(200);
      const result = (installed.payload as { result: Record<string, unknown> }).result;
      // 全仓文件都进清单（相对路径 = 仓库内完整路径）
      expect(result.files).toEqual(['SKILL.md', 'references/notes.md']);
      expect(result.digest).toBe(rootDigest);
      expect(result.targetPath).toBe('.dfg/market/skill/root-skill/');
      // 落点真写：根级与子目录文件都在
      const target = join(daemon.dataRoot, '.dfg', 'market', 'skill', 'root-skill');
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(rootFiles['SKILL.md']);
      expect(await readFile(join(target, 'references', 'notes.md'), 'utf8')).toBe(
        rootFiles['references/notes.md'],
      );
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market install · raw URL 段级编码（D-18 #1 · 票 A · A1）', () => {
  const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  /** 含空格 / 中文 / `#` 的仓库路径：此前直接拼 URL，`#` 截断为片段、空格与非 ASCII 直接 404。 */
  const UNICODE_FILES = {
    'skills/pdf-export/SKILL.md': '# PDF Export\n\n把设计稿导出为分页 PDF。\n',
    'skills/pdf-export/docs/a b/中文名#1.md': '带空格、中文与 # 的路径。\n',
  };
  const UNICODE_DIGEST = specDigest(UNICODE_FILES);
  const CREDENTIALS = { env: { GH_TOKEN: 'test-token-123' } };

  it('raw 下载 URL 对 fullPath 逐段 encodeURIComponent（保留 / 分隔符）且装载成功', async () => {
    const requested: string[] = [];
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: REF,
        files: UNICODE_FILES,
        recordUrls: requested,
      }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: UNICODE_DIGEST })]));
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
      // 装载成功：stub 按解码路径命中文件 → 段级编码不失真（相对路径仍是原始形态）
      expect(installed.statusCode).toBe(200);
      const result = (installed.payload as { result: { files: string[] } }).result;
      expect(result.files).toEqual(['SKILL.md', 'docs/a b/中文名#1.md']);

      // raw 请求 URL 逐段编码：空格 → %20、中文 → UTF-8 百分号、`#` → %23、`/` 分隔符保留
      const rawUrls = requested.filter((url) =>
        url.startsWith(`https://raw.githubusercontent.com/acme/skills/${REF}/`),
      );
      expect(rawUrls).toContain(
        `https://raw.githubusercontent.com/acme/skills/${REF}/skills/pdf-export/SKILL.md`,
      );
      expect(rawUrls).toContain(
        `https://raw.githubusercontent.com/acme/skills/${REF}/skills/pdf-export/docs/a%20b/%E4%B8%AD%E6%96%87%E5%90%8D%231.md`,
      );
      // 未编码形态（空格/`#` 裸现）不得出现
      expect(rawUrls.every((url) => !url.includes('a b/') && !url.includes('#1.md'))).toBe(true);
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

  /** 覆盖 source.ref 的资产夹具（makeAsset 返回 Record<string, unknown>，source 展开需显式形态）。 */
  function assetWithRef(
    ref: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return makeAsset({
      ...overrides,
      source: { ...(makeAsset().source as Record<string, unknown>), ref },
    });
  }

  it('畸形 ref（非 40-hex commit）→ 503 source_unavailable（ref-invalid），不发起任何源请求（D-18 #5 · 票 A · A2）', async () => {
    const requested: string[] = [];
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: 'main', // 资产索引里登记的畸形 ref（分支名，不是 commit SHA）
        files: ASSET_FILES,
        recordUrls: requested,
      }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(
        daemon,
        makeIndex([
          assetWithRef('main'),
          assetWithRef('a1b2c3d', { id: 'gh:acme/skills#skills/short-ref', name: 'short-ref' }),
        ]),
      );
      for (const assetId of [
        'gh:acme/skills#skills/pdf-export',
        'gh:acme/skills#skills/short-ref',
      ]) {
        const ackToken = await planToken(daemon, assetId);
        const installed = await injectJson(daemon.app, {
          method: 'POST',
          url: '/market/install',
          payload: { assetId, ackToken },
        });
        expect(installed.statusCode).toBe(503);
        const error = (
          installed.payload as { error: { code: string; details?: Record<string, unknown> } }
        ).error;
        expect(error.code).toBe('market_install_source_unavailable');
        expect(error.details?.reason).toBe('ref-invalid');
      }
      // 零源请求：Trees/raw 都不发（畸形 ref 在装载前即终态）
      expect(requested).toEqual([]);
      // 未写入任何文件
      await expect(
        readFile(join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export'), 'utf8'),
      ).rejects.toThrow();
      // 审计如实留痕
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  /** 覆盖 source.repo 的资产夹具（repo 形态校验用例，quality-p1 评审 #2）。 */
  function assetWithRepo(
    repo: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return makeAsset({
      ...overrides,
      source: { ...(makeAsset().source as Record<string, unknown>), repo },
    });
  }

  it('repo 形态不符（?/#/多余 /）→ 503 source_unavailable（source-incomplete），不发起任何源请求（评审 #2 纵深防御）', async () => {
    const requested: string[] = [];
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: REF,
        files: ASSET_FILES,
        recordUrls: requested,
      }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(
        daemon,
        makeIndex([
          assetWithRepo('acme/skills?redirect=x', {
            id: 'gh:acme/skills#skills/q-mark',
            name: 'q-mark',
          }),
          assetWithRepo('acme/skills#fragment', {
            id: 'gh:acme/skills#skills/frag',
            name: 'frag',
          }),
          assetWithRepo('acme/skills/extra', {
            id: 'gh:acme/skills#skills/extra-slash',
            name: 'extra-slash',
          }),
        ]),
      );
      for (const assetId of [
        'gh:acme/skills#skills/q-mark',
        'gh:acme/skills#skills/frag',
        'gh:acme/skills#skills/extra-slash',
      ]) {
        const ackToken = await planToken(daemon, assetId);
        const installed = await injectJson(daemon.app, {
          method: 'POST',
          url: '/market/install',
          payload: { assetId, ackToken },
        });
        expect(installed.statusCode).toBe(503);
        const error = (
          installed.payload as { error: { code: string; details?: Record<string, unknown> } }
        ).error;
        expect(error.code).toBe('market_install_source_unavailable');
        expect(error.details?.reason).toBe('source-incomplete');
      }
      // 零源请求：repo 形态不符在 URL 拼接前即终态（Trees/raw 都不发）
      expect(requested).toEqual([]);
      await expect(
        readFile(join(daemon.dataRoot, '.dfg', 'market', 'skill', 'q-mark'), 'utf8'),
      ).rejects.toThrow();
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('Trees 清单路径含 .. 点段 → 503 source_unavailable（path-segment-invalid），raw 零请求（评审 #2 纵深防御）', async () => {
    const requested: string[] = [];
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: REF,
        // 恶意清单：资产前缀内的 .. 点段——WHATWG URL 归一会把 raw 请求路径
        // 「归」到资产目录之外（encodeURIComponent('..') 不中和点段）
        files: {
          ...ASSET_FILES,
          'skills/pdf-export/references/../../../escape.md': 'escaped',
        },
        recordUrls: requested,
      }),
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
      const error = (
        installed.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('market_install_source_unavailable');
      expect(error.details?.reason).toBe('path-segment-invalid');
      // Trees 请求必然已发（路径来自清单），但 raw 下载一个都不发
      expect(
        requested.filter((url) => url.startsWith('https://raw.githubusercontent.com/')),
      ).toEqual([]);
      await expect(
        readFile(join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export'), 'utf8'),
      ).rejects.toThrow();
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

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

  it('清单 size 超单文件上限（F2）→ 预检即 503，不发起任何 raw 下载', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({
        repo: 'acme/skills',
        ref: REF,
        files: ASSET_FILES,
        oversizedPaths: ['skills/pdf-export/SKILL.md'],
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
      expect(error.details?.reason).toBe('file-too-large');
      expect(error.details?.phase).toBe('precheck');
      expect(error.details?.path).toBe('SKILL.md');
      // 预检失败 = 只发过 Trees 清单请求，raw 内容下载一次都没发生
      const rawCalls = daemon.fetchCalls.filter((call) =>
        call.url.startsWith('https://raw.githubusercontent.com/'),
      );
      expect(rawCalls).toEqual([]);
      expect(daemon.fetchCalls.length).toBeGreaterThan(0);
      // 落点零写入 + 审计终态留痕
      await expect(
        readFile(
          join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
          'utf8',
        ),
      ).rejects.toThrow();
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
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

  it('gh 探测失控（挂起超时形态，F3）→ 结构化失败不挂死：runner 抛错按无凭据口径', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: {
        env: {},
        // 模拟 gh auth token 挂起后被 spawnSync timeout 击杀的失控形态（探测本身抛错）：
        // 装载请求必须得到结构化终态（source_unavailable），绝不无限等待或 500
        ghRunner: () => {
          throw new Error('gh auth token timed out（模拟挂起超时）');
        },
      },
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
      // 凭据探测失败即终态：不发起任何源请求，审计留痕
      expect(daemon.fetchCalls).toEqual([]);
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
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
      // 失败终态全审计（F4）：提案后资产消失也要留痕（approved + applied=false）
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('asset_not_found');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('提案后资产被 yank（F7 消费时复查闸门）→ 403 gate_blocked：旧 token 被拒 + 零写入 + 审计', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      // 提案后索引重建：同 digest 的资产被标记下架（yank）
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({
            digest: EXPECTED_DIGEST,
            yanked: { reason: '权利人要求', at: '2026-11-08T00:00:00Z', source: 'rights-holder' },
          }),
        ]),
      );
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(403);
      const error = (
        installed.payload as {
          error: { code: string; message: string; details?: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('market_install_gate_blocked');
      expect(error.details?.yanked).toBe(true);
      expect(error.message).toContain('下架或不再可装载');
      // 拒绝即终态：零写入 + 审计留痕（gate_blocked）
      await expect(
        readFile(
          join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
          'utf8',
        ),
      ).rejects.toThrow();
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('gate_blocked');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('提案后闸门改为不可装载（F7）→ 403 gate_blocked（mode 复查）', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: EXPECTED_DIGEST })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      // 提案后索引重建：许可档降为 view-only（闸门改判）
      await seedIndex(
        daemon,
        makeIndex([
          makeAsset({
            digest: EXPECTED_DIGEST,
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
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(403);
      const error = (
        installed.payload as { error: { code: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('market_install_gate_blocked');
      expect(error.details?.mode).toBe('view-only');
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
      // 失败终态全审计（F4）：落点不安全同样留痕
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('target_invalid');
      expect(audit).toContain('"applied":false');
      // 数据根外不存在 evil 目录
      await expect(readFile(join(daemon.dataRoot, 'evil', 'SKILL.md'), 'utf8')).rejects.toThrow();
      await expect(
        readFile(join(daemon.dataRoot, '.dfg', 'evil', 'SKILL.md'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await daemon.cleanup();
    }
  });

  it('NFD 文件名资产（F4）→ 预写校验拒绝：装不上 + 零残留 + 审计留痕', async () => {
    // é 的 NFD 分解（e + U+0301 组合附加符）：路径安全层按非 NFC 拒绝
    const nfdRelative = 'cafe\u0301.md';
    const nfdFiles = { ...ASSET_FILES, [`skills/pdf-export/${nfdRelative}`]: 'NFD 文件名\n' };
    const nfdDigest = specDigest(nfdFiles);
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: nfdFiles }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: nfdDigest })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(400);
      const error = (
        installed.payload as {
          error: { code: string; message: string; details?: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('market_install_target_invalid');
      expect(error.details?.phase).toBe('prewrite');
      expect(error.details?.path).toBe(nfdRelative);
      expect(error.message).toContain('未写入任何文件');
      // 单事务两阶段（先验证后写入）：连合法的 SKILL.md 也零写入（无半批落盘中间态）
      const target = join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export');
      await expect(readFile(join(target, 'SKILL.md'), 'utf8')).rejects.toThrow();
      // 审计：预写拒绝留痕（零写入）
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('零写入');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('写入中断（F4）→ 尽力清理已写文件 + 终态 internal + 审计如实（不谎称未写入）', async () => {
    // 树里同时有同名「文件 docs」与「目录内文件 docs/a.md」：写完 docs 文件后再建
    // docs 目录必 EEXIST——制造写循环中途失败的真实形态
    const collisionFiles = {
      'skills/pdf-export/SKILL.md': '# PDF Export\n\n把设计稿导出为分页 PDF。\n',
      'skills/pdf-export/docs': '同名文件占位\n',
      'skills/pdf-export/docs/a.md': '子文件\n',
    };
    const collisionDigest = specDigest(collisionFiles);
    const daemon = await createInstallDaemon({
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: collisionFiles }),
      marketInstallCredentials: CREDENTIALS,
    });
    try {
      await seedIndex(daemon, makeIndex([makeAsset({ digest: collisionDigest })]));
      const ackToken = await planToken(daemon, 'gh:acme/skills#skills/pdf-export');
      const installed = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/install',
        payload: { assetId: 'gh:acme/skills#skills/pdf-export', ackToken },
      });
      expect(installed.statusCode).toBe(500);
      const error = (
        installed.payload as {
          error: { code: string; message: string; details?: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('internal');
      expect(error.details?.reason).toBe('write-failed');
      // 文案如实：写入中断 + 清理结果，不再声称「未写入任何文件」
      expect(error.message).toContain('写入中断');
      expect(error.message).not.toContain('未写入任何文件');
      // 失败消息剥绝对路径（R2）：details.message 只留 errno 短语 + 相对路径，
      // 原始 fs message 里的数据根绝对路径绝不进 HTTP details
      const detailMessage = String(error.details?.message);
      expect(detailMessage).toBe('文件系统错误（EEXIST）：docs/a.md');
      expect(detailMessage).not.toContain(daemon.dataRoot);
      // 尽力清理：本次已写的 SKILL.md 与 docs 文件都已删除（零残留）
      const target = join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export');
      await expect(readFile(join(target, 'SKILL.md'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(target, 'docs'), 'utf8')).rejects.toThrow();
      // 审计：写入中断留痕（含清理结果）；审计 note 同样剥绝对路径（R2）
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('写入中断');
      expect(audit).toContain('文件系统错误（EEXIST）：docs/a.md');
      expect(audit).not.toContain(daemon.dataRoot);
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market install · 回读失败终态（F4：直连服务 + readFile 注入，不经 HTTP）', () => {
  const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const EXPECTED_DIGEST = specDigest(ASSET_FILES);

  it('回读失败 → 审计 failed + 文案如实（已写入、可能有残留，不再声称未写入）', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'df-install-readback-'));
    const service = createMarketInstallService({
      auditPath: join(tempRoot, 'audit', 'market-install.jsonl'),
      dataRoot: tempRoot,
      fetchImpl: githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES }),
      credentials: { env: { GH_TOKEN: 'test-token-123' } },
      loadAsset: async () => makeAsset({ digest: EXPECTED_DIGEST }) as unknown as MarketAsset,
      // 模拟写入后磁盘读失败（EIO 形态）：文件在盘上但校验无法完成
      readFileImpl: async () => {
        throw new Error('EIO：模拟回读失败');
      },
    });
    try {
      const assetId = 'gh:acme/skills#skills/pdf-export';
      const issued = await service.issue({ assetId });
      const result = await service.install({ assetId, ackToken: issued.ackToken });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('market_install_digest_mismatch');
      expect(result.details?.phase).toBe('readback');
      // 文案如实：文件已落盘（残留），绝不谎称「未写入任何文件」
      expect(result.message).toContain('已写入');
      expect(result.message).not.toContain('未写入任何文件');
      // 残留如实：写入的文件确实在盘上（回读失败 ≠ 未写入）
      const onDisk = await readFile(
        join(tempRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
        'utf8',
      );
      expect(onDisk).toBe(ASSET_FILES['skills/pdf-export/SKILL.md']);
      // 审计：pending + 失败终态（applied=false，note 带原因与「已落盘」事实）
      const audit = await readFile(join(tempRoot, 'audit', 'market-install.jsonl'), 'utf8');
      const records = audit
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { decision: string; applied: boolean; note: string });
      expect(records.map((record) => record.decision)).toEqual(['pending', 'approved']);
      const failed = records[1];
      expect(failed?.applied).toBe(false);
      expect(failed?.note).toContain('回读失败');
      expect(failed?.note).toContain('已落盘');
      expect(audit).not.toContain(issued.ackToken);
    } finally {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('market install · 网络中断/超时（R1/R3：体读失败必须结构化收口）', () => {
  const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const EXPECTED_DIGEST = specDigest(ASSET_FILES);
  const CREDENTIALS = { env: { GH_TOKEN: 'test-token-123' } };

  /** TimeoutError 形态错误（与 AbortSignal.timeout 的中止原因同 name；等价真超时到点）。 */
  function timeoutError(): Error {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    return error;
  }

  /** 200 + 先给半截内容再 TimeoutError 的响应体（模拟 AbortSignal.timeout 在体读阶段到点）。 */
  function midBodyTimeoutResponse(contentType: string): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"sha":"半截'));
          controller.error(timeoutError());
        },
      }),
      { status: 200, headers: { 'content-type': contentType } },
    );
  }

  async function planToken(daemon: TestDaemon, assetId: string): Promise<string> {
    const plan = await injectJson(daemon.app, {
      method: 'POST',
      url: '/market/load-plan',
      payload: { assetId },
    });
    return (plan.payload as { result: { ackToken: string } }).result.ackToken;
  }

  it('raw 体读超时（R1）→ 503 source_unavailable（reason=network）+ 审计留痕，绝不变非结构化 500', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: (url) => {
        const target = typeof url === 'string' ? url : String(url);
        if (target.startsWith(`https://raw.githubusercontent.com/acme/skills/${REF}/`)) {
          return Promise.resolve(midBodyTimeoutResponse('text/plain; charset=utf-8'));
        }
        return githubStub({ repo: 'acme/skills', ref: REF, files: ASSET_FILES })(url);
      },
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
      expect(error.details?.reason).toBe('network');
      expect(error.details?.path).toBe('SKILL.md');
      // 零写入 + 审计终态留痕（旧码 TimeoutError 逸出 → 全局非结构化 500 且跳过审计，必红）
      await expect(
        readFile(
          join(daemon.dataRoot, '.dfg', 'market', 'skill', 'pdf-export', 'SKILL.md'),
          'utf8',
        ),
      ).rejects.toThrow();
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('网络中断/超时');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('Trees 清单体读超时（R3）→ reason=network「读取超时」，不再误诊为 trees-invalid-json', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: (url) => {
        const target = typeof url === 'string' ? url : String(url);
        if (target.startsWith('https://api.github.com/repos/acme/skills/git/trees/')) {
          return Promise.resolve(midBodyTimeoutResponse('application/json'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'stub: unexpected url' }), { status: 404 }),
        );
      },
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
        installed.payload as {
          error: { code: string; message: string; details?: Record<string, unknown> };
        }
      ).error;
      expect(error.code).toBe('market_install_source_unavailable');
      expect(error.details?.reason).toBe('network');
      expect(error.message).toContain('读取超时');
      expect(error.message).not.toContain('不是合法 JSON');
      // 审计终态留痕
      const audit = await readFile(join(daemon.dataRoot, 'audit', 'market-install.jsonl'), 'utf8');
      expect(audit).toContain('"applied":false');
    } finally {
      await daemon.cleanup();
    }
  });

  it('Trees 清单体确实非法（对照分支）→ 仍按 trees-invalid-json 终态', async () => {
    const daemon = await createInstallDaemon({
      fetchImpl: (url) => {
        const target = typeof url === 'string' ? url : String(url);
        if (target.startsWith('https://api.github.com/repos/acme/skills/git/trees/')) {
          // 体完整但内容不是 JSON（SyntaxError 形态）：不落超时分支
          return Promise.resolve(
            new Response('not-json{{{', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'stub: unexpected url' }), { status: 404 }),
        );
      },
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
      const error = (installed.payload as { error: { details?: Record<string, unknown> } }).error;
      expect(error.details?.reason).toBe('trees-invalid-json');
    } finally {
      await daemon.cleanup();
    }
  });
});
