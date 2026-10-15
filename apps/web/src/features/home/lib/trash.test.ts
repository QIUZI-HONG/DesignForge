/**
 * 首页删除记录（回收站分区）测试（FE-02）。
 *
 * 语义边界（本票口径）：daemon 的删除是**物理删除**（`.dfg` 目录不可恢复），
 * 因此「回收站」在本票只保留**删除记录**（名称 + 删除时间），不承诺正文恢复；
 * 记录存浏览器 localStorage（本机、不上云），容量有上限，坏数据一律容忍丢弃。
 */
import { describe, expect, it } from 'vitest';

import {
  appendTrashRecord,
  parseTrashRecords,
  removeTrashRecord,
  serializeTrashRecords,
  TRASH_RECORD_LIMIT,
  type TrashRecord,
} from './trash';

function record(id: string, deletedAt = '2026-10-15T10:00:00.000Z'): TrashRecord {
  return { id, name: `文档 ${id}`, deletedAt };
}

describe('parseTrashRecords', () => {
  it('null / 空串 / 坏 JSON → 空数组（不抛错）', () => {
    expect(parseTrashRecords(null)).toEqual([]);
    expect(parseTrashRecords('')).toEqual([]);
    expect(parseTrashRecords('{不是数组')).toEqual([]);
  });

  it('丢弃坏项，保留合法项', () => {
    const raw = JSON.stringify([record('a'), { id: 'b' }, 42, null, { name: 'x' }]);
    expect(parseTrashRecords(raw).map((item) => item.id)).toEqual(['a']);
  });

  it('往返：序列化后解析得到同一批记录', () => {
    const records = [record('a'), record('b', '2026-10-14T09:00:00.000Z')];
    expect(parseTrashRecords(serializeTrashRecords(records))).toEqual(records);
  });
});

describe('appendTrashRecord', () => {
  it('新记录插到最前', () => {
    const result = appendTrashRecord([record('a')], record('b'));
    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('同 id 去重（重复删除同一文档只留一条）', () => {
    const result = appendTrashRecord([record('a')], record('a'));
    expect(result).toEqual([record('a')]);
  });

  it('超出上限时截断最老的记录', () => {
    const many = Array.from({ length: TRASH_RECORD_LIMIT }, (_, index) =>
      record(`bulk-${String(index)}`),
    );
    const result = appendTrashRecord(many, record('newest'));
    expect(result).toHaveLength(TRASH_RECORD_LIMIT);
    expect(result[0]?.id).toBe('newest');
    // 最老的（列表末尾）被挤掉，最新的仍在前部
    expect(result.some((item) => item.id === `bulk-${String(TRASH_RECORD_LIMIT - 1)}`)).toBe(false);
    expect(result.some((item) => item.id === 'bulk-0')).toBe(true);
  });
});

describe('removeTrashRecord', () => {
  it('按 id 移除（彻底删除记录的语义）', () => {
    expect(removeTrashRecord([record('a'), record('b')], 'a').map((item) => item.id)).toEqual([
      'b',
    ]);
  });

  it('id 不存在时原样返回', () => {
    const records = [record('a')];
    expect(removeTrashRecord(records, 'zzz')).toEqual(records);
  });
});
