/**
 * 市场回流计数（D5 采纳展示 / 试跑次数；遥测默认仅本地，规格 §8.3）。
 *
 * 口径：埋点（装载/运行/采纳/放弃）**默认只存本地**；未授权云聚合时这里就是全部真值。
 * 存储形状版本化（`dfg.market.feedback.v1`）；读写机制收编 lib `createLocalStore`（票 D）：
 * 读 = safe 解析 + 形状谓词逐条过滤；计数归一（非法值→0）是**变换**不是谓词，留在本册逐条执行。
 * **不冒充**云端聚合数据：界面展示一律标「本地计数」。
 */

import {
  createLocalStore,
  type KeyValueReadWriter,
  type LocalStore,
  rethrowWriteError,
} from '@/lib/local-store';

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

/** 最小存储接口（lib 册引擎读写子集的单一真源；既有注入替身不变）。 */
export type FeedbackStoreLike = KeyValueReadWriter;

/** 回流计数册引擎（lib 收编；键与后端由本册固定；写失败上抛挂 lib 单份 rethrowWriteError）。 */
function feedbackStore(storage: FeedbackStoreLike): LocalStore<FeedbackEntry> {
  return createLocalStore<FeedbackEntry>({
    key: FEEDBACK_KEY,
    backend: storage,
    validate: isFeedbackEntryShape,
    onWriteError: rethrowWriteError,
  });
}

/** 条目的必需键校验（缺 assetId 的条目丢弃）。 */
function isFeedbackEntryShape(value: unknown): value is FeedbackEntry {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.assetId === 'string' && raw.assetId.length > 0;
}

/** 逐条归一：非法计数值归一为 0（不把负数/字符串带进界面）。 */
function normalizeFeedbackEntry(raw: FeedbackEntry): FeedbackEntry {
  return {
    assetId: raw.assetId,
    runs: typeof raw.runs === 'number' && raw.runs >= 0 ? raw.runs : 0,
    adoptions: typeof raw.adoptions === 'number' && raw.adoptions >= 0 ? raw.adoptions : 0,
    lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : '',
  };
}

/** 读取（损坏/非法一律当空——本地计数不该拖垮面板）。 */
export function readFeedback(storage: FeedbackStoreLike): FeedbackEntry[] {
  return feedbackStore(storage).load().map(normalizeFeedbackEntry);
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
  feedbackStore(storage).save(entries);
  return entries;
}
