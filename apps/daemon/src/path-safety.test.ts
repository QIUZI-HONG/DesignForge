/**
 * path-safety 单元测试（票 A · A3 · D-18 #6）。
 *
 * 接缝：`resolveWithin`（path-safety.ts 的唯一安全路径解析器）——段级词法校验是它的
 * 第一层防线，此前只拒 NUL/非 NFC/`.`/`..`，0x01–0x1F 其余控制字符不在段级词法内
 * （可藏进文档名/页 id/市场文件路径）。本块钉：段级控制字符拒绝 + 正常中文/空格/
 * 中文标点放行；documents 文档链路回归由 `documents/*.test.ts` 全量覆盖（resolveWithin
 * 是文档读写的必经点）。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWithin } from './path-safety.ts';

/** 临时数据根（可重试删除，避免追加写清理竞态）。 */
async function withTempRoot<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'df-path-safety-'));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('resolveWithin · 段级词法：控制字符拒绝（D-18 #6 · 票 A · A3）', () => {
  it.each([
    ['NUL', '\u0000'],
    ['0x01 SOH', '\u0001'],
    ['0x1F US', '\u001f'],
    ['TAB', '\t'],
    ['LF', '\n'],
    ['CR', '\r'],
    ['ESC', '\u001b'],
    ['DEL', '\u007f'],
  ])('%s 段 → null（不产生盘上路径）', async (_label: string, bad: string) => {
    await withTempRoot(async (root) => {
      expect(await resolveWithin(root, 'docs', `a${bad}b.json`)).toBeNull();
      expect(await resolveWithin(root, `bad${bad}name`, 'file.json')).toBeNull();
    });
  });

  it('正常中文名 / 空格 / 中文标点放行（既有中文文档名口径不受影响）', async () => {
    await withTempRoot(async (root) => {
      expect(await resolveWithin(root, '设计文档', '第 1 章：封面的定稿？.json')).not.toBeNull();
      expect(await resolveWithin(root, 'docs', '会议纪要（草案）、终版.md')).not.toBeNull();
      expect(await resolveWithin(root, 'my docs', 'page-1.json')).not.toBeNull();
    });
  });
});
