/**
 * 维度二 · 维护活跃度 `maintenance`（权重 .20，规格 §5.1/§5.2）。
 *
 * 信号与子权（维度内归一化，和 = 1.00）：
 *   maintenance.pushed-at     .40  pushed_at 新鲜度：≤90 天 1.0 / ≤365 天 0.5（M3）/ >365 天 0（M1）
 *   maintenance.ci            .35  `.github/workflows/` 存在性（缺 → M4）
 *   maintenance.commits-90d   .15  最近 90 天提交数 **v1+ 增强信号**：≥1 满分 / 0 → M5；无数据不参与
 *   maintenance.last-release  .10  最近一次发布 **v1+ 增强信号**：≤365 天满分 / 更早 → M6；无数据不参与
 *
 * 规格 §5.2 脚注：v1 只用 Trees + 仓库元数据可得的信号；issue 响应中位数等
 * 增强信号需额外调用预算，故本维度对 `commits90d`/`lastReleaseAt` 为 null 时
 * **不参与加权、不扣分**（宁可少判，不可假判）。
 *
 * 边界口径（规格 §5.4 / §5.3）：
 *   - 僵尸仓（>540 天且 <50★）→ 在信号扣分之上再扣 M2（.10）。
 *   - 归档仓 → 维度分封顶 ≤0.3，差额记 M7（卡片另示「已归档」）。
 *   - Trees 截断 → 「无 CI」不可证明 → 该信号置 null。
 */

import { REASON_TEXT } from './codes.ts';
import { hasWorkflowFiles } from './files.ts';
import { daysBetween } from './time.ts';
import type { DimensionResult, DwdAsset, SignalDetail } from './types.ts';
import { DEDUCTION_DUST, ROUND_DIM_DIGITS } from './types.ts';
import {
  clamp01,
  collectDeductions,
  finalizeScore,
  makeDeduction,
  normalizedWeight,
  roundTo,
  weightedMean,
} from './util.ts';

/** 归档仓维护活跃封顶线（规格 §5.4「如 ≤0.3」）。 */
export const ARCHIVED_MAINTENANCE_CAP = 0.3;

/** 僵尸仓判定线（规格 §5.3 M2：>540 天且 <50★）。 */
export const ZOMBIE_DAYS = 540;
export const ZOMBIE_STAR_CEILING = 50;
/** 僵尸仓额外扣分（维度分标度）。 */
export const ZOMBIE_PENALTY = 0.1;

/**
 * 维护活跃度评分。
 * @param asOf 批次时点（注入；一切时间差以此为基准，禁时钟依赖）。
 */
export function scoreMaintenance(input: DwdAsset, asOf: string): DimensionResult {
  const { repo, files } = input;
  // pushedAt 不可解析（直喂脏数据场景）→ 年龄无数据：信号不可得（不参与加权、不扣分），
  // 不臆造「很新」或「很旧」——与「宁可少判，不可假判」同口径（D4：NaN 不得进观测值/理由）。
  const pushedAge = daysBetween(repo.pushedAt, asOf);

  const pushedScore = pushedAge === null ? null : pushedAge <= 90 ? 1 : pushedAge <= 365 ? 0.5 : 0;
  const ciFound = hasWorkflowFiles(files.entries);
  const commits = repo.commits90d;
  const releaseAge = repo.lastReleaseAt === null ? null : daysBetween(repo.lastReleaseAt, asOf);
  const releaseScore = releaseAge === null ? null : releaseAge <= 365 ? 1 : 0;

  const signals: SignalDetail[] = [
    { code: 'maintenance.pushed-at', value: pushedAge, weight: 0.4, score: pushedScore },
    {
      code: 'maintenance.ci',
      value: ciFound ? true : files.truncated ? 'truncated' : false,
      weight: 0.35,
      score: ciFound ? 1 : files.truncated ? null : 0,
    },
    {
      code: 'maintenance.commits-90d',
      value: commits,
      weight: 0.15,
      score: commits === null ? null : commits >= 1 ? 1 : 0,
    },
    {
      code: 'maintenance.last-release',
      value: releaseAge,
      weight: 0.1,
      score: releaseScore,
    },
  ];

  /** 按信号当前子分记一笔扣分。 */
  const deduct = (signalCode: string, reasonCode: string, reason: string) => {
    const s = signals.find((x) => x.code === signalCode);
    if (s === undefined || s.score === null || s.score >= 1) return null;
    return makeDeduction(reasonCode, reason, normalizedWeight(signals, signalCode) * (1 - s.score));
  };

  const signalDeductions = [
    pushedAge === null
      ? null
      : deduct(
          'maintenance.pushed-at',
          pushedAge > 365 ? 'M1' : 'M3',
          pushedAge > 365 ? REASON_TEXT.M1 : REASON_TEXT.M3,
        ),
    deduct('maintenance.ci', 'M4', REASON_TEXT.M4),
    deduct('maintenance.commits-90d', 'M5', REASON_TEXT.M5),
    deduct('maintenance.last-release', 'M6', REASON_TEXT.M6),
  ];

  const raw = weightedMean(signals);
  const isZombie =
    pushedAge !== null && pushedAge > ZOMBIE_DAYS && repo.stars < ZOMBIE_STAR_CEILING;
  const adjusted = raw === null ? null : raw - (isZombie ? ZOMBIE_PENALTY : 0);
  const capped =
    adjusted === null
      ? null
      : repo.archived
        ? Math.min(adjusted, ARCHIVED_MAINTENANCE_CAP)
        : adjusted;

  // 封顶差额（仅当封顶真的生效：adjusted > 封顶线）。
  const capGap =
    adjusted !== null && capped !== null && repo.archived
      ? roundTo(clamp01(adjusted) - clamp01(capped), ROUND_DIM_DIGITS)
      : 0;

  const deductions = collectDeductions([
    ...signalDeductions,
    isZombie ? makeDeduction('M2', REASON_TEXT.M2, ZOMBIE_PENALTY) : null,
    capGap >= DEDUCTION_DUST ? makeDeduction('M7', REASON_TEXT.M7, capGap) : null,
  ]);

  return { score: finalizeScore(capped), signals, deductions };
}
