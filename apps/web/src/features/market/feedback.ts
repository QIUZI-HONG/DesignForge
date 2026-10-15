/**
 * 市场回流计数（D5 采纳展示 / 试跑次数；遥测默认仅本地，规格 §8.3）。
 *
 * 口径：埋点（装载/运行/采纳/放弃）**默认只存本地**；未授权云聚合时这里就是全部真值。
 * 存储形状版本化（`dfg.market.feedback.v1`），读写经纯函数（storage 注入，测试不用浏览器）。
 * **不冒充**云端聚合数据：界面展示一律标「本地计数」。
 */

/** 单资产回流行。 */
export interface FeedbackEntry {
  assetId: string;
  /** 试跑次数（dryRun 无副作用运行）。 */
  runs: number;
  /** 采纳次数（用户明确采纳，不改文档）。 */
  adoptions: number;
  /** 最近一次操作时刻（ISO）。 */
  lastAt: string;
}

/** 存储键。 */
export const FEEDBACK_KEY = 'dfg.market.feedback.v1';

/** 最小存储接口。 */
export interface FeedbackStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 读取（损坏/非法一律当空——本地计数不该拖垮面板）。 */
export function readFeedback(storage: FeedbackStoreLike): FeedbackEntry[] {
  const raw = storage.getItem(FEEDBACK_KEY);
  if (raw === null || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: FeedbackEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.assetId !== 'string' || record.assetId.length === 0) continue;
    entries.push({
      assetId: record.assetId,
      runs: typeof record.runs === 'number' && record.runs >= 0 ? record.runs : 0,
      adoptions:
        typeof record.adoptions === 'number' && record.adoptions >= 0 ? record.adoptions : 0,
      lastAt: typeof record.lastAt === 'string' ? record.lastAt : '',
    });
  }
  return entries;
}

/** 取某资产的计数（无记录给零值，界面照常显示 0 而不隐藏——本地计数是如实值）。 */
export function feedbackOf(entries: readonly FeedbackEntry[], assetId: string): FeedbackEntry {
  return (
    entries.find((entry) => entry.assetId === assetId) ?? {
      assetId,
      runs: 0,
      adoptions: 0,
      lastAt: '',
    }
  );
}

/** 累加某资产的计数（`field` 指定 runs/adoptions）。 */
export function bumpFeedback(
  storage: FeedbackStoreLike,
  assetId: string,
  field: 'runs' | 'adoptions',
  at: string,
): FeedbackEntry[] {
  const existing = readFeedback(storage);
  const current = feedbackOf(existing, assetId);
  const next: FeedbackEntry = {
    assetId,
    runs: field === 'runs' ? current.runs + 1 : current.runs,
    adoptions: field === 'adoptions' ? current.adoptions + 1 : current.adoptions,
    lastAt: at,
  };
  const entries = [next, ...existing.filter((entry) => entry.assetId !== assetId)];
  storage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
  return entries;
}
