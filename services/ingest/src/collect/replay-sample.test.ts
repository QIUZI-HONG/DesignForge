/**
 * 冻结样本集离线复跑测试（issue #30 判据：固定样本仓库集确定性测试 + 不触网重放）。
 *
 * 样本：`__fixtures__/replay-sample/`——2026-10-15 真网小跑（`--limit 5`）录制的
 * 真实 API 响应裁剪而来（两个仓：anthropics/skills、zarazhangrui/beautiful-html-templates；
 * 仅含公开只读元数据与描述性文本）。重放走 `createReplayFetch`——**零网络**，
 * 样本缺失即 `ReplayMissError`（明确阻塞，不静默伪造）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { CollectOptions } from './run.ts';
import { runCollect } from './run.ts';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'replay-sample');

interface ReplayManifest {
  runId: string;
  asOfMs: number;
  repos: string[];
  replayParams: { seeds: string[]; topics: string[]; maxContentPerRepo: number };
}

const manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8'),
) as ReplayManifest;

function replayOptions(outDir: string): CollectOptions {
  return {
    outDir,
    runId: manifest.runId,
    asOfMs: manifest.asOfMs,
    seeds: manifest.replayParams.seeds,
    topics: manifest.replayParams.topics,
    sorts: ['stars'],
    perTopic: 5,
    maxPagesPerQuery: 1,
    limit: null,
    since: null,
    maxContentPerRepo: manifest.replayParams.maxContentPerRepo,
    replayDir: FIXTURE_DIR,
    token: null, // 离线：不触网、无需凭据
  };
}

describe('冻结样本集：离线复跑（不触网）', () => {
  it('两个真实仓的认定结果与 licence 三档如实产出（exit 0）', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const out = mkdtempSync(join(tmpdir(), 'mk01-replay-'));
    try {
      const result = await runCollect(replayOptions(out));

      expect(result.exitCode).toBe(0);
      expect(result.blockedReason).toBeNull();
      expect(result.evidence.offline).toBe(true);
      expect(result.records).toHaveLength(2);

      const anthro = result.records.find((r) => r.repo.fullName === 'anthropics/skills');
      const bht = result.records.find(
        (r) => r.repo.fullName === 'zarazhangrui/beautiful-html-templates',
      );
      expect(anthro).toBeDefined();
      expect(bht).toBeDefined();

      // commit 冻结（source.ref 依据）
      expect(anthro?.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(bht?.ref).toMatch(/^[0-9a-f]{40}$/);

      // anthropics/skills：仓库 license=null → 仅看（默认全保留权利）
      expect(anthro?.license.gate).toBe('view-only');
      expect(anthro?.license.tier).toBe('none');
      const anthroKinds = (anthro?.assets ?? []).map((a) => a.kind);
      expect(anthroKinds.filter((k) => k === 'plugin')).toHaveLength(1); // .claude-plugin/marketplace.json 自指
      expect(anthroKinds.filter((k) => k === 'skill').length).toBeGreaterThanOrEqual(2); // academy-guide / algorithmic-art
      const anthroSkill = anthro?.assets.find(
        (a) => a.id === 'gh:anthropics/skills#skills/academy-guide',
      );
      expect(anthroSkill?.compliance).toBe('ok');
      // 未取回正文的技能如实标 deferred（预算 3：清单 + 2 个 SKILL.md）
      expect(anthro?.assets.some((a) => a.compliance === 'deferred')).toBe(true);

      // beautiful-html-templates：MIT + 仓根 LICENSE → 可装载；模板为身份型清单 + 同根 template.html
      expect(bht?.license.gate).toBe('loadable');
      expect(bht?.license.evidence.path).toBe('LICENSE');
      expect(bht?.license.evidence.sha256).toMatch(/^sha256:/);
      const templates = (bht?.assets ?? []).filter((a) => a.kind === 'template');
      // 预算 3 → 恰 3 个模板完成内容校验（ok），其余如实 deferred（不假装校验过）
      expect(templates.filter((a) => a.compliance === 'ok').map((a) => a.id)).toEqual([
        'gh:zarazhangrui/beautiful-html-templates#templates/8-bit-orbit',
        'gh:zarazhangrui/beautiful-html-templates#templates/biennale-yellow',
        'gh:zarazhangrui/beautiful-html-templates#templates/block-frame',
      ]);
      expect(templates.some((a) => a.compliance === 'deferred')).toBe(true);

      // 一仓一记录 + fetchedAt 冻结
      for (const record of result.records) {
        expect(record.fetchedAt).toBe(new Date(manifest.asOfMs).toISOString());
        expect(record.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('确定性：同一样本集两次复跑 → 产物摘要与记录摘要逐字节一致', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const outA = mkdtempSync(join(tmpdir(), 'mk01-replay-a-'));
    const outB = mkdtempSync(join(tmpdir(), 'mk01-replay-b-'));
    try {
      const a = await runCollect(replayOptions(outA));
      const b = await runCollect(replayOptions(outB));
      expect(a.exitCode).toBe(0);
      expect(b.exitCode).toBe(0);
      expect(a.artifacts.map((x) => x.sha256)).toEqual(b.artifacts.map((x) => x.sha256));
      expect(a.records.map((r) => r.digest)).toEqual(b.records.map((r) => r.digest));
      expect(a.records.map((r) => r.assets.map((x) => `${x.id}:${x.compliance}`))).toEqual(
        b.records.map((r) => r.assets.map((x) => `${x.id}:${x.compliance}`)),
      );
    } finally {
      rmSync(outA, { recursive: true, force: true });
      rmSync(outB, { recursive: true, force: true });
    }
  });

  it('样本外的请求 → 明确阻塞（exit 2，不触网、不伪造）', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const out = mkdtempSync(join(tmpdir(), 'mk01-replay-miss-'));
    try {
      const result = await runCollect({
        ...replayOptions(out),
        seeds: ['not/in-sample'],
      });
      expect(result.exitCode).toBe(2);
      expect(result.blockedReason).toContain('离线样本缺失');
      expect(result.records).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
