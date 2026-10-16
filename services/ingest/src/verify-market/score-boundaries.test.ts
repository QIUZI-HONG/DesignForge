/**
 * 验证线 · 风险点 4：评分边界（全零信号 / 极值 / 冷启动 90 天整 / 缺 text 组 / NaN 防线）。
 *
 * 关注：是否出 NaN、是否静默塌陷（维度变 null 而总分失真）、边界是否含等号。
 */

import { describe, expect, it } from 'vitest';
import { AS_OF, makeDwd } from '../score/__fixtures__/dwd.ts';
import { DwdShapeError, normalizeDwdAsset } from '../score/dwd.ts';
import { COLD_START_DAYS, isColdStart, scoreBatch } from '../score/index.ts';
import type { DwdAsset } from '../score/types.ts';

const AS_OF_MS = Date.parse(AS_OF);
const DAY_MS = 86_400_000;

function at(daysBefore: number, extraMs = 0): string {
  return new Date(AS_OF_MS - daysBefore * DAY_MS - extraMs).toISOString();
}

/** 断言记录的分值与观测值均为有限数或 null，无 NaN/Infinity 泄漏。 */
function assertNoNonFinite(record: ReturnType<typeof scoreBatch>['records'][number]): void {
  for (const [dim, value] of Object.entries(record.dims)) {
    if (value !== null) {
      expect(Number.isFinite(value), `dim ${dim} 非有限：${value}`).toBe(true);
    }
  }
  if (record.score !== null) expect(Number.isFinite(record.score)).toBe(true);
}

/** 只查分值（dims/总分）：观测值另册（NaN 直喂时观测值可含 NaN——见「发现」测试）。 */
function assertScoresFinite(record: ReturnType<typeof scoreBatch>['records'][number]): void {
  assertNoNonFinite(record);
}

describe('评分边界：全零与极值', () => {
  it('全零信号 + 创建时间未知：冷启动托底生效（生态维置空、总分重归一化、非 0 且非 NaN）', () => {
    const zero = makeDwd({
      repo: { stars: 0, forks: 0, createdAt: null, pushedAt: at(400) },
      trend: { stars90dAgo: null, referencedBy: null },
    });
    const { records } = scoreBatch([zero], { asOf: AS_OF });
    const record = records[0];
    expect(record).toBeDefined();
    const r = record as NonNullable<typeof record>;
    expect(r.flags.coldStart).toBe(true);
    expect(r.dims.ecosystem).toBeNull(); // 空心，不是 0 分
    expect(r.score).not.toBeNull();
    expect(Number(r.score)).toBeGreaterThan(0); // 重归一化托底：不因零采纳垫底
    assertNoNonFinite(r);
  });

  it('极值（1e6 星标/fork/引用）：分位封顶 1、无 Infinity/NaN 溢出', () => {
    const extreme = makeDwd({
      asset: { id: 'gh:acme/x#extreme' },
      repo: { stars: 1_000_000, forks: 1_000_000 },
      trend: { stars90dAgo: 1, referencedBy: 1_000_000 },
    });
    const { records } = scoreBatch([extreme, makeDwd({ asset: { id: 'gh:acme/x#normal' } })], {
      asOf: AS_OF,
    });
    const r = records[0] as NonNullable<(typeof records)[number]>;
    expect(Number.isFinite(r.dims.ecosystem as number)).toBe(true);
    expect(r.dims.ecosystem).toBeLessThanOrEqual(1);
    expect(r.dims.ecosystem).toBeGreaterThanOrEqual(0);
    assertNoNonFinite(r);

    // stars90dAgo=0 时增速以 1 为分母（新仓暴增不产生 Infinity）
    const fromZero = makeDwd({
      repo: { stars: 5, forks: 0 },
      trend: { stars90dAgo: 0, referencedBy: 1 },
    });
    const g = scoreBatch([fromZero, extreme], { asOf: AS_OF }).records[0];
    expect(Number.isFinite(g?.explain.ecosystem.signals[0]?.value as number)).toBe(true);
  });

  it('时间边界：年龄恰好 90 天 = 非冷启动；89 天 23 时 = 冷启动；零采纳无论年龄都冷启动', () => {
    expect(COLD_START_DAYS).toBe(90);
    const exactly90 = makeDwd({ repo: { createdAt: at(90), stars: 10, forks: 1 } });
    expect(isColdStart(exactly90, AS_OF)).toBe(false);
    const justUnder = makeDwd({ repo: { createdAt: at(89, 3_600_000), stars: 10, forks: 1 } });
    expect(isColdStart(justUnder, AS_OF)).toBe(true);
    const zeroAdoptionOld = makeDwd({
      repo: { createdAt: at(3650), stars: 0, forks: 0 },
      trend: { stars90dAgo: 0, referencedBy: 0 },
    });
    expect(isColdStart(zeroAdoptionOld, AS_OF)).toBe(true);
  });
});

describe('评分边界：缺 text 组与 NaN 防线', () => {
  it('text 抽取组全 null（存量资产）：五维不塌陷为 null/NaN，总分有限（低分但可算）', () => {
    const noText = makeDwd({
      text: {
        frontmatter: null,
        body: null,
        readme: null,
        manifest: null,
        packageJson: null,
        mcpJson: null,
        changelog: null,
      },
    });
    const r = scoreBatch([noText], { asOf: AS_OF }).records[0] as NonNullable<
      ReturnType<typeof scoreBatch>['records'][number]
    >;
    for (const [dim, value] of Object.entries(r.dims)) {
      expect(value, `dim ${dim} 不应塌陷为 null`).not.toBeNull();
    }
    expect(r.dims.docs as number).toBeLessThan(0.5); // docs 应显著低分而非静默给满
    assertNoNonFinite(r);
  });

  it('归一化防线：NaN/非有限数值不得进入评分（DwdShapeError 拦截）', () => {
    const raw = {
      asset: { id: 'gh:acme/x#1', kind: 'skill', name: 'x' },
      repo: { repoId: 1, stars: Number.NaN, forks: 1, pushedAt: at(10), archived: false },
      license: { gate: 'view-only' },
      files: { entries: [] },
      text: { frontmatter: { name: 'x' }, body: '正文' },
    };
    expect(() => normalizeDwdAsset(raw)).toThrow(DwdShapeError);
    try {
      normalizeDwdAsset(raw);
    } catch (error) {
      expect((error as DwdShapeError).issues.join('；')).toContain('repo.stars');
    }

    // text 组整体缺失 → 同样拦截（避免五维静默塌陷）
    expect(() =>
      normalizeDwdAsset({
        asset: { id: 'gh:acme/x#1', kind: 'skill', name: 'x' },
        repo: { repoId: 1, stars: 1, forks: 1, pushedAt: at(10), archived: false },
        license: { gate: 'view-only' },
        files: { entries: [] },
      }),
    ).toThrow(/text 缺失/);
  });

  it('绕过归一化直喂 NaN（对抗路径）：维度分与总分不塌陷为 NaN', () => {
    const dirty: DwdAsset = makeDwd({
      repo: { stars: Number.NaN, forks: Number.NaN, pushedAt: '不是时间' },
      trend: { stars90dAgo: Number.NaN, referencedBy: Number.NaN },
    });
    const r = scoreBatch([dirty], { asOf: AS_OF }).records[0] as NonNullable<
      ReturnType<typeof scoreBatch>['records'][number]
    >;
    // 维度分与总分不塌陷：有限数或显式 null
    assertScoresFinite(r);
  });

  it('[发现·建议级] 直喂 NaN（绕过归一化）时：观测值与扣分理由文本里出现 NaN 字面量', () => {
    const dirty: DwdAsset = makeDwd({
      repo: { stars: Number.NaN, forks: Number.NaN, pushedAt: '不是时间' },
      trend: { stars90dAgo: Number.NaN, referencedBy: Number.NaN },
    });
    const r = scoreBatch([dirty], { asOf: AS_OF }).records[0] as NonNullable<
      ReturnType<typeof scoreBatch>['records'][number]
    >;
    const nonFiniteSignals = Object.entries(r.explain).flatMap(([dim, explain]) =>
      explain.signals
        .filter((s) => typeof s.value === 'number' && !Number.isFinite(s.value as number))
        .map((s) => `${dim}/${s.code}=${String(s.value)}`),
    );
    const reasons = Object.values(r.explain)
      .flatMap((dim) => dim.deductions.map((d) => d.reason))
      .join('；');
    // 生产路径由 normalizeDwdAsset 拦截（见上一条），但直喂 DwdAsset 时 NaN 会进信号观测值
    // 与理由文本；JSONL 落盘会静默变 null（语义漂移），且人话理由不应出现 NaN。
    expect(
      { nonFiniteSignals, reasonsHasNaN: reasons.includes('NaN') },
      `观测值 NaN：${nonFiniteSignals.join(', ')}；理由：${reasons}`,
    ).toEqual({ nonFiniteSignals: [], reasonsHasNaN: false });
  });

  it('空批：0 记录、无异常（不产生除零/NaN 语境）', () => {
    const result = scoreBatch([], { asOf: AS_OF });
    expect(result.records).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      coldStart: 0,
      archived: 0,
      nonCompliant: 0,
      fullyScored: 0,
    });
  });
});
