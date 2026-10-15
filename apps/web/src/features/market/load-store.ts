/**
 * 本地装载记录（D4 审计的本地真值；「已装载」态与更新判定的数据源）。
 *
 * 口径（《技能市场规格 v1》§7.4）：真实装载落点 `.dfg/market/<kind>/<slug>/`（文档工作目录内），
 * 写入归 daemon 的 MCP 确认桩；**前端持有的是本地记录册**（装载过什么、什么版本、授了什么权），
 * 用于「已装载」徽标、`digest` 变化提示与卸载入口。存储走 `localStorage`（遥测默认仅本地，§8.3），
 * 读写全部经本模块的纯函数（storage 作为参数注入——测试不需要浏览器）。
 */

import type { LoadRecord } from './load-token';

/** 存储键（版本化：形状变化时新键，不就地改旧数据）。 */
export const LOADED_RECORDS_KEY = 'dfg.market.loaded.v1';

/** 最小存储接口（`localStorage` 的子集；测试用内存实现）。 */
export interface LoadStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 读取记录册（损坏/越权数据一律当空册——本地记录不该拖垮页面）。 */
export function readLoadRecords(storage: LoadStoreLike): LoadRecord[] {
  const raw = storage.getItem(LOADED_RECORDS_KEY);
  if (raw === null || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: LoadRecord[] = [];
  for (const item of parsed) {
    const record = asLoadRecord(item);
    if (record !== null) records.push(record);
  }
  return records;
}

/** 单个记录的最小校验（缺 assetId/digest 的条目丢弃）。 */
function asLoadRecord(value: unknown): LoadRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.assetId !== 'string' || raw.assetId.length === 0) return null;
  if (typeof raw.digest !== 'string' || raw.digest.length === 0) return null;
  return {
    assetId: raw.assetId,
    name: typeof raw.name === 'string' ? raw.name : '',
    kind: typeof raw.kind === 'string' ? raw.kind : '',
    digest: raw.digest,
    ref: typeof raw.ref === 'string' ? raw.ref : '',
    targetPath: typeof raw.targetPath === 'string' ? raw.targetPath : null,
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : '',
    caller: 'user',
  };
}

/** 写入记录（同 assetId 覆盖——同一资产只留最近一次装载；返回新册便于断言）。 */
export function writeLoadRecord(storage: LoadStoreLike, record: LoadRecord): LoadRecord[] {
  const existing = readLoadRecords(storage).filter((item) => item.assetId !== record.assetId);
  const next = [record, ...existing];
  storage.setItem(LOADED_RECORDS_KEY, JSON.stringify(next));
  return next;
}

/** 已装载的资产 id 集合（卡片三态与「已装载」筛选共用）。 */
export function loadedAssetIds(records: readonly LoadRecord[]): string[] {
  return records.map((record) => record.assetId);
}

/** 查某资产的装载记录（无则 null）。 */
export function findLoadRecord(records: readonly LoadRecord[], assetId: string): LoadRecord | null {
  return records.find((record) => record.assetId === assetId) ?? null;
}

/**
 * 更新判定（规格 §7.4 / §9.7 暂定双条件）：`digest` 或自声明版本变化即为「可更新」。
 * 只比对 `digest`（内容哈希）——版本号缺省时由内容哈希兜底。
 */
export function isUpdateAvailable(record: LoadRecord | null, current: { digest: string }): boolean {
  if (record === null) return false;
  return record.digest !== current.digest;
}

/** 删除某资产的装载记录（卸载）；返回新册。 */
export function removeLoadRecord(storage: LoadStoreLike, assetId: string): LoadRecord[] {
  const next = readLoadRecords(storage).filter((record) => record.assetId !== assetId);
  storage.setItem(LOADED_RECORDS_KEY, JSON.stringify(next));
  return next;
}
