/**
 * 验证线 · 风险点 2：坏输入（空仓 / 只有 README / 巨仓 / 404 / 429 / 304 空正文 / 畸形 frontmatter /
 * 二进制伪装成文本 / 同名多根）。
 *
 * 纪律：只报告现象与断言；不触网（剧本化 fetch / 重放样本）。
 */

import { afterAll, describe, expect, it } from 'vitest';
import { decodeContentsText } from '../collect/client.ts';
import { defaultViewOnlyLicense, identifyAssets } from '../collect/identify.ts';
import type { CollectOptions } from '../collect/run.ts';
import { runCollect } from '../collect/run.ts';
import type { TreeEntry } from '../collect/types.ts';
import { validateSkillDoc } from '../collect/validate.ts';
import { parseFrontmatter } from '../transform/parse/frontmatter.ts';
import {
  AS_OF_MS,
  cleanupTempDirs,
  contentStep,
  jsonStep,
  RUN_ID,
  repoMeta,
  type ScriptedStep,
  scriptedFetch,
  tempDir,
  treeBody,
} from './helpers.ts';

afterAll(cleanupTempDirs);

const COMMIT = 'c'.repeat(40);

function base(outDir: string, over: Partial<CollectOptions> = {}): CollectOptions {
  return {
    outDir,
    runId: RUN_ID,
    asOfMs: AS_OF_MS,
    seeds: ['acme/one'],
    topics: [],
    sorts: ['stars'],
    perTopic: 5,
    maxPagesPerQuery: 1,
    limit: null,
    since: null,
    maxContentPerRepo: 8,
    replayDir: null,
    token: { token: 'verify-token', source: 'env' },
    maxAttempts: 1,
    ...over,
  };
}

const refStep = () => jsonStep({ object: { sha: COMMIT, type: 'commit' } });

describe('坏输入：仓库形态', () => {
  it('空仓（tree=[]）：exit 0、一仓一记录、0 资产、空流 digest，不崩', async () => {
    const res = await runCollect(
      base(tempDir('verify-empty'), {
        fetchImpl: scriptedFetch([
          jsonStep(repoMeta('acme/one')),
          refStep(),
          jsonStep(treeBody([])),
        ]).fetchImpl,
      }),
    );
    expect(res.exitCode).toBe(0);
    expect(res.records).toHaveLength(1);
    expect(res.records[0]?.assets).toEqual([]);
    expect(res.records[0]?.rejected).toEqual([]);
    // 空流 sha256（e3b0c4…）——空目录也有确定性摘要，不是 null
    expect(res.records[0]?.digest).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('只有 README：0 资产 0 拒选（README 不是结构件，不得误认）', async () => {
    const res = await runCollect(
      base(tempDir('verify-readme'), {
        fetchImpl: scriptedFetch([
          jsonStep(repoMeta('acme/one')),
          refStep(),
          jsonStep(treeBody([{ path: 'README.md', size: 30 }])),
          contentStep('# 一个只有说明文件的仓'),
        ]).fetchImpl,
      }),
    );
    expect(res.exitCode).toBe(0);
    expect(res.records[0]?.assets).toEqual([]);
    expect(res.records[0]?.rejected).toEqual([]);
  });

  it('巨型仓（tree truncated + 超量条目）：truncated 如实上报，预算内资产 deferred，不崩', async () => {
    const entries: { path: string; size: number }[] = [];
    for (let i = 0; i < 3000; i += 1) entries.push({ path: `skills/s${i}/SKILL.md`, size: 200 });
    const tree = treeBody(entries);
    tree.truncated = true;
    const res = await runCollect(
      base(tempDir('verify-giant'), {
        maxContentPerRepo: 2,
        fetchImpl: scriptedFetch([
          jsonStep(repoMeta('acme/one', { stars: 1_000_000 })),
          refStep(),
          jsonStep(tree),
          ...entries
            .slice(0, 2)
            .map((e) => contentStep(`---\nname: ${e.path}\ndescription: d\n---\n\n正文`)),
        ]).fetchImpl,
      }),
    );
    expect(res.exitCode).toBe(0);
    const record = res.records[0];
    expect(record?.tree.truncated).toBe(true);
    expect(record?.tree.entryCount).toBe(3000);
    expect(record?.assets).toHaveLength(3000); // 结构件在 Trees 里都算候选
    expect(res.counts.deferredAssets).toBeGreaterThan(2900); // 预算 2 → 绝大多数如实 deferred
    expect(record?.assets.every((a) => a.probe.length > 0 && a.checks.length > 0)).toBe(true);
  });

  it('404：单仓全 404 → 记 skippedRepos、不伪造记录（库层退出码见「已知问题」）', async () => {
    const res = await runCollect(
      base(tempDir('verify-404'), {
        fetchImpl: scriptedFetch([{ status: 404, body: '{"message":"Not Found"}' }]).fetchImpl,
      }),
    );
    expect(res.records).toEqual([]);
    expect(res.counts.skippedRepos).toEqual([{ repo: 'acme/one', reason: 'HTTP 404' }]);
    // 【发现】0 记录仍返回 exit 0：MK-01 库层无「仓数 > 0」断言（CLI 层会补断言 → exit 1）。
    // 断言当前口径，问题描述见验证报告。
    expect(res.exitCode).toBe(0);
  });

  it('429 连续限速 → ConsecutiveRateLimitAbort → 阻塞 exit 2（默认 5 次尝试内熔断）', async () => {
    const res = await runCollect(
      base(tempDir('verify-429'), {
        maxAttempts: 5,
        fetchImpl: scriptedFetch(
          Array.from({ length: 6 }, () => ({
            status: 429,
            headers: { 'retry-after': '0', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' },
            body: '{"message":"API rate limit exceeded"}',
          })),
        ).fetchImpl,
      }),
    );
    expect(res.exitCode).toBe(2);
    expect(res.blockedReason).toContain('连续');
    expect(res.records).toEqual([]);
  });

  it('304 但样本/缓存无正文：不得静默吞掉（当前按单仓跳过处理）', async () => {
    const res = await runCollect(
      base(tempDir('verify-304'), {
        fetchImpl: scriptedFetch([
          jsonStep(repoMeta('acme/one'), { etag: 'W/"meta"' }),
          refStep(),
          { status: 304, headers: {} },
        ]).fetchImpl,
      }),
    );
    expect(res.records).toEqual([]);
    expect(
      res.counts.skippedRepos.some((s) => s.reason.includes('304 Not Modified 但本地无缓存正文')),
    ).toBe(true);
  });

  it('[发现] 304 空正文（样本损坏场景）应视为阻塞（exit 2），不得以 exit 0 收场（禁止假绿）', async () => {
    const res = await runCollect(
      base(tempDir('verify-304-block'), {
        fetchImpl: scriptedFetch([
          jsonStep(repoMeta('acme/one'), { etag: 'W/"meta"' }),
          refStep(),
          { status: 304, headers: {} },
        ]).fetchImpl,
      }),
    );
    // 现状：全部仓被跳过 → 0 记录，仍返回 exit 0（与「0 = 全流程走完且断言全过」的语义冲突：
    // 本仓实为样本/缓存不完整，属阻塞类异常；同类 ReplayMissError 是 exit 2）。
    expect(
      res.exitCode,
      `全仓 304-无正文被跳过时 exitCode=${res.exitCode}（records=${res.records.length}）`,
    ).not.toBe(0);
  });
});

describe('坏输入：文本形态', () => {
  it('畸形 frontmatter 全谱：缺 --- / 未闭合 / 井号色值 / CRLF+BOM / 超长值 / 无冒号', () => {
    const body = '正'.repeat(200);
    expect(validateSkillDoc(body).compliance).toBe('non-compliant'); // 缺 frontmatter → 可入库但不计规范分
    expect(validateSkillDoc(`---\nname: a\ndescription: b\n${body}`).reasons.join('；')).toContain(
      'frontmatter 未闭合',
    );
    // YAML 井号：`#0F1B3D` 色值不得被当注释截断；` # 注释` 应剥掉
    expect(
      validateSkillDoc(`---\nname: a\ndescription: 用 #0F1B3D 配色 # 这段是注释\n---\n${body}`)
        .compliance,
    ).toBe('ok');
    // CRLF + BOM 归一
    expect(
      validateSkillDoc(`\uFEFF---\r\nname: a\r\ndescription: b\r\n---\r\n${body}`).compliance,
    ).toBe('ok');
    // 超长值（100KB description）不崩、不截断到丢失 name
    const huge = validateSkillDoc(
      `---\nname: a\ndescription: ${'x'.repeat(100_000)}\n---\n${body}`,
    );
    expect(huge.compliance).toBe('ok');
    // 无冒号行 → 缺 name（不得猜）
    expect(validateSkillDoc(`---\njust text\n---\n${body}`).reasons.join('；')).toContain(
      '缺 name',
    );

    // transform 侧解析器（第二实现）同谱系不崩
    expect(parseFrontmatter('name: a\n').hasBlock).toBe(false);
    const fm = parseFrontmatter(`---\nname: a\ndescription: 用 #0F1B3D 配色\n---\n${body}`);
    expect(fm.ok).toBe(true);
    expect(fm.data.description).toBe('用 #0F1B3D 配色');
  });

  it('二进制伪装成文本（SKILL.md 为二进制垃圾）：判定 suspect/non-compliant，不崩、不含非法 JSON 值', () => {
    const binary = Buffer.concat([
      Buffer.from([0xff, 0xfe, 0x00, 0x01]),
      Buffer.from('garbage\u0000tail'),
    ]);
    const decoded = decodeContentsText({
      encoding: 'base64',
      content: binary.toString('base64'),
    });
    expect(decoded).not.toBeNull();
    const verdict = validateSkillDoc(decoded as string);
    expect(['suspect', 'non-compliant']).toContain(verdict.compliance);
    expect(verdict.name).toBeNull();

    // 走识别层：短二进制 → suspect → 不进资产、进 rejected；长二进制 → non-compliant → 入库
    const tree: TreeEntry[] = [{ path: 's/SKILL.md', type: 'blob', sha: 'b'.repeat(40), size: 20 }];
    const short = identifyAssets({
      repoFullName: 'acme/bin',
      tree,
      contents: new Map([['s/SKILL.md', decoded as string]]),
      deferredPaths: new Set(),
      license: defaultViewOnlyLicense(),
    });
    expect(short.assets).toEqual([]);
    expect(short.rejected).toHaveLength(1);

    const longText = `${decoded as string}${'A'.repeat(500)}`;
    const long = identifyAssets({
      repoFullName: 'acme/bin',
      tree,
      contents: new Map([['s/SKILL.md', longText]]),
      deferredPaths: new Set(),
      license: defaultViewOnlyLicense(),
    });
    expect(long.assets.map((a) => [a.kind, a.compliance])).toEqual([['skill', 'non-compliant']]);
  });

  it('同名多根（两目录同名资产）：产出两条不同 id 的资产，不互相覆盖', () => {
    const doc = `---\nname: same\ndescription: d\n---\n\n${'正文'.repeat(100)}`;
    const tree: TreeEntry[] = [
      { path: 'a/SKILL.md', type: 'blob', sha: '1'.repeat(40), size: 400 },
      { path: 'b/SKILL.md', type: 'blob', sha: '2'.repeat(40), size: 400 },
    ];
    const result = identifyAssets({
      repoFullName: 'acme/dup',
      tree,
      contents: new Map([
        ['a/SKILL.md', doc],
        ['b/SKILL.md', doc],
      ]),
      deferredPaths: new Set(),
      license: defaultViewOnlyLicense(),
    });
    expect(result.assets.map((a) => a.id)).toEqual(['gh:acme/dup#a', 'gh:acme/dup#b']);
    expect(new Set(result.assets.map((a) => a.treeDigest)).size).toBe(2); // 摘要按根不同
  });
});

describe('坏输入：候选发现噪声（topic 有而结构无）', () => {
  it('meta 有 topics 但树无结构件 → 不认定（topic 只作候选，不构成认定）', async () => {
    const script: ScriptedStep[] = [
      jsonStep(repoMeta('acme/noise', { topics: ['claude-skills', 'design-system', 'template'] })),
      refStep(),
      jsonStep(
        treeBody([
          { path: 'src/index.ts', size: 10 },
          { path: 'docs/notes.md', size: 10 },
        ]),
      ),
    ];
    const res = await runCollect(
      base(tempDir('verify-topic'), { fetchImpl: scriptedFetch(script).fetchImpl }),
    );
    expect(res.exitCode).toBe(0);
    expect(res.records[0]?.assets).toEqual([]);
    expect(res.records[0]?.repo.topics).toEqual(['claude-skills', 'design-system', 'template']);
  });
});
