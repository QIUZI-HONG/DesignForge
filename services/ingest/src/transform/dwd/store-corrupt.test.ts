/**
 * readTable 对损坏 JSON 列的容错（audit-d05 · D-06 回归）。
 *
 * 缺陷基线（~/df-evidence/audit-2026-11/quality/q8-q9-red.log · Q8）：store.ts 对 JSON 列
 * 裸 `JSON.parse`——磁盘上一个损坏 JSON 单元格（外部损坏/版本偏差/半写）令整批 SyntaxError，
 * 好行全损。修复口径：坏格降级 null + 逐格告警（计数/定位可见），好行照常返回。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parquetWriteBuffer } from 'hyparquet-writer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReadWarningOptions } from './store.ts';
import { readDwd, readTable } from './store.ts';

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'df-audit-d06-'));
  await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** 写一张手工 parquet（绕过 writeTable 的序列化，模拟磁盘上的坏 JSON 文本）。 */
async function writeRawParquet(
  name: string,
  columnData: { name: string; data: unknown[]; type: string }[],
): Promise<void> {
  const buffer = parquetWriteBuffer({ columnData });
  await writeFile(join(workDir, `${name}.parquet`), Buffer.from(new Uint8Array(buffer)));
}

/** 收集告警（替换缺省 stderr 出口，供断言计数与文本）。 */
function captureWarnings(): { warnings: string[]; options: ReadWarningOptions } {
  const warnings: string[] = [];
  return { warnings, options: { onWarning: (warning) => warnings.push(warning) } };
}

describe('readTable 对损坏 JSON 列的容错（D-06）', () => {
  it('损坏 JSON 单元格：不整批炸，坏格降级 null，好行照常返回', async () => {
    await writeRawParquet('repo', [
      { name: 'repo_id', data: [1n, 2n], type: 'INT64' },
      { name: 'topics', data: ['["a"]', '{corrupted'], type: 'JSON' },
    ]);
    const { warnings, options } = captureWarnings();
    const rows = await readTable<{ repo_id: number; topics: unknown }>(workDir, 'repo', options);
    // 好行照常、坏格降级（修复前：整批 SyntaxError → 审计红测实证）
    expect(rows).toHaveLength(2);
    expect(rows[0]?.repo_id).toBe(1);
    expect(rows[0]?.topics).toEqual(['a']);
    expect(rows[1]?.repo_id).toBe(2);
    expect(rows[1]?.topics).toBeNull();
    // 告警必须可见：恰好 1 条，定位到表/行/列
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('repo.parquet');
    expect(warnings[0]).toContain('第 2 行');
    expect(warnings[0]).toContain('topics');
  });

  it('多格损坏：逐格告警且计数正确；好格不受牵连', async () => {
    await writeRawParquet('asset', [
      { name: 'asset_id', data: ['a1', 'a2', 'a3'], type: 'STRING' },
      { name: 'capabilities', data: ['["x"]', '{bad', 'no-json'], type: 'JSON' },
    ]);
    const { warnings, options } = captureWarnings();
    const rows = await readTable<{ asset_id: string; capabilities: unknown }>(
      workDir,
      'asset',
      options,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]?.capabilities).toEqual(['x']);
    expect(rows[1]?.capabilities).toBeNull();
    expect(rows[2]?.capabilities).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('第 2 行');
    expect(warnings[1]).toContain('第 3 行');
  });

  it('readDwd 透传告警选项（消费入口 MK-03/MK-04 同口径）', async () => {
    await writeRawParquet('repo', [
      { name: 'repo_id', data: [1n], type: 'INT64' },
      { name: 'topics', data: ['{corrupted'], type: 'JSON' },
    ]);
    await writeRawParquet('asset', [
      { name: 'asset_id', data: [], type: 'STRING' },
      { name: 'repo_id', data: [], type: 'INT64' },
    ]);
    await writeRawParquet('asset_file', [
      { name: 'asset_id', data: [], type: 'STRING' },
      { name: 'file_id', data: [], type: 'STRING' },
    ]);
    await writeRawParquet('license', [
      { name: 'repo_id', data: [], type: 'INT64' },
      { name: 'spdx', data: [], type: 'STRING' },
    ]);
    const { warnings, options } = captureWarnings();
    const tables = await readDwd(workDir, options);
    expect(tables.repo).toHaveLength(1);
    expect(tables.repo[0]?.topics).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('repo.parquet');
  });

  it('未注入 onWarning：缺省写 stderr（不许静默吞）', async () => {
    await writeRawParquet('repo', [
      { name: 'repo_id', data: [1n], type: 'INT64' },
      { name: 'topics', data: ['{corrupted'], type: 'JSON' },
    ]);
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const rows = await readTable<{ topics: unknown }>(workDir, 'repo');
      expect(rows[0]?.topics).toBeNull();
    } finally {
      process.stderr.write = original;
    }
    expect(writes.some((line) => line.includes('DWD 读取容错'))).toBe(true);
  });
});
