/**
 * 本地装载记录（D4 审计的本地真值；「已装载」态与更新判定的数据源）。
 *
 * 口径（《技能市场规格 v1》§7.4）：真实装载落点 `.dfg/market/<kind>/<slug>/`（文档工作目录内），
 * 写入走 daemon `POST /market/install`（`apps/daemon/src/market/install.ts`——安全语义为
 * 「等价复刻 MCP 确认桩」的独立服务；D-18 #7 勘误：旧注释「写入归 daemon 的 MCP 确认桩」失实）；
 * **前端持有的是本地记录册**（装载过什么、什么版本、授了什么权），
 * 用于「已装载」徽标、`digest` 变化提示与卸载入口。存储走 `localStorage`（遥测默认仅本地，§8.3）。
 *
 * 读写机制收编 lib `createLocalStore`（票 D）：读 = safe 解析 + 形状谓词逐条过滤；
 * 记录归一（缺省字段补默认、未知键剥离）是**变换**不是谓词，留在本册逐条执行。
 * 读写全部经本模块的纯函数（storage 作为参数注入——测试不需要浏览器）。
 */

import {
  createLocalStore,
  type KeyValueReadWriter,
  type LocalStore,
  rethrowWriteError,
} from '@/lib/local-store';

import type { LoadRecord } from './load-token';

/** 存储键（版本化：形状变化时新键，不就地改旧数据）。 */
export const LOADED_RECORDS_KEY = 'dfg.market.loaded.v1';

/** 最小存储接口（lib 册引擎读写子集的单一真源；既有注入替身不变）。 */
export type LoadStoreLike = KeyValueReadWriter;

/** 装载记录册引擎（lib 收编；键与后端由本册固定；写失败上抛挂 lib 单份
 * rethrowWriteError——use-market 的 save 回调依赖异常可见，不静默吞）。 */
function recordStore(storage: LoadStoreLike): LocalStore<LoadRecord> {
  return createLocalStore<LoadRecord>({
    key: LOADED_RECORDS_KEY,
    backend: storage,
    validate: isLoadRecordShape,
    onWriteError: rethrowWriteError,
  });
}

/** 记录的必需键校验（缺 assetId/digest 的条目丢弃——旧版本数据与手改坏数据不进册）。 */
function isLoadRecordShape(value: unknown): value is LoadRecord {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.assetId === 'string' &&
    raw.assetId.length > 0 &&
    typeof raw.digest === 'string' &&
    raw.digest.length > 0
  );
}

/**
 * 逐条归一：必需键已由 {@link isLoadRecordShape} 钉住，其余字段补默认、未知键剥离。
 * 输入可能是旧版本/手改的残缺记录，逐字段 typeof 再取值，不信任形状断言以外的部分。
 */
function normalizeLoadRecord(raw: LoadRecord): LoadRecord {
  const record: LoadRecord = {
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
  // daemon 真写完成时刻（票③）：存在才回填，缺失省略（不补造假时刻）
  if (typeof raw.loadedAt === 'string' && raw.loadedAt.length > 0) {
    record.loadedAt = raw.loadedAt;
  }
  return record;
}

/** 读取记录册（损坏/越权数据一律当空册——本地记录不该拖垮页面）。 */
export function readLoadRecords(storage: LoadStoreLike): LoadRecord[] {
  return recordStore(storage).load().map(normalizeLoadRecord);
}

/** 写入记录（同 assetId 覆盖——同一资产只留最近一次装载；返回新册便于断言）。 */
export function writeLoadRecord(storage: LoadStoreLike, record: LoadRecord): LoadRecord[] {
  const existing = readLoadRecords(storage).filter((item) => item.assetId !== record.assetId);
  const next = [record, ...existing];
  recordStore(storage).save(next);
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

/**
 * 可更新计数（票②）：记录册逐条复用 {@link isUpdateAvailable} 对照「当前索引 digest」计数。
 * 索引里查不到当前 digest 的记录（未采集/已下架）**不判定也不计数**——不虚报可更新数。
 */
export function countUpdateAvailable(
  records: readonly LoadRecord[],
  current: readonly { id: string; digest: string }[],
): number {
  const digestById = new Map(current.map((asset) => [asset.id, asset.digest]));
  let count = 0;
  for (const record of records) {
    const digest = digestById.get(record.assetId);
    if (digest === undefined) continue;
    if (isUpdateAvailable(record, { digest })) count += 1;
  }
  return count;
}

/** 删除某资产的装载记录（卸载）；返回新册。 */
export function removeLoadRecord(storage: LoadStoreLike, assetId: string): LoadRecord[] {
  const next = readLoadRecords(storage).filter((record) => record.assetId !== assetId);
  recordStore(storage).save(next);
  return next;
}
