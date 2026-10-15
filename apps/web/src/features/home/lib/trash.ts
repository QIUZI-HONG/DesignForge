/**
 * 删除记录（回收站分区，FE-02）。
 *
 * 口径：daemon 侧删除是**物理删除**（`.dfg` 目录不可恢复），所以本模块只保留「删除记录」：
 * 名称 + 删除时间，供回收站分区如实展示与手工清理；**不承诺正文恢复**。
 * 存储形态是 localStorage 里的 JSON 串——读写必须容忍坏数据（用户可手改），
 * 坏项丢弃而不是整块清空。
 */

/** 一条删除记录。 */
export interface TrashRecord {
  /** 文档 id（= 原 `.dfg` 目录名）。 */
  id: string;
  /** 文档名（删除时的名字）。 */
  name: string;
  /** 删除时间（ISO 串）。 */
  deletedAt: string;
}

/** localStorage 键（版本化：结构变更时换键，避免旧数据误读）。 */
export const TRASH_STORAGE_KEY = 'dfg-home-trash-v1';

/** 记录条数上限（超出截断最老的，避免无限增长）。 */
export const TRASH_RECORD_LIMIT = 50;

/** 校验任意值是否为合法记录。 */
function isTrashRecord(value: unknown): value is TrashRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    typeof record.deletedAt === 'string'
  );
}

/** 解析存储串：坏 JSON 与坏项一律丢弃（不抛错）。 */
export function parseTrashRecords(raw: string | null): TrashRecord[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrashRecord);
  } catch {
    return [];
  }
}

/** 序列化（写入存储用）。 */
export function serializeTrashRecords(records: TrashRecord[]): string {
  return JSON.stringify(records);
}

/** 追加记录：插到最前、同 id 去重、超出上限截断最老的。 */
export function appendTrashRecord(
  records: TrashRecord[],
  record: TrashRecord,
  limit: number = TRASH_RECORD_LIMIT,
): TrashRecord[] {
  if (records.some((item) => item.id === record.id)) return records;
  return [record, ...records].slice(0, limit);
}

/** 移除记录（回收站里的「彻底删除」= 清掉这条记录）。 */
export function removeTrashRecord(records: TrashRecord[], id: string): TrashRecord[] {
  return records.filter((item) => item.id !== id);
}
