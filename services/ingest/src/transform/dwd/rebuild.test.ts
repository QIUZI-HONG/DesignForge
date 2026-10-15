/**
 * 重建一致性测试（规格 §4.3.3：删任一上层目录，从上层重跑结果一致）。
 *
 * 断言外部行为：删 DWD → 从 ODS 重跑 → 四表字节一致且 manifest 相同（同输入同输出）；
 * 同时验证「删掉 DWD 后仍能读回」的路径（readDwd 在重建前必须失败，说明真的删了）。
 */

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializeOds } from '../ods/materialize.ts';
import { rebuildDwd } from '../rebuild.ts';
import { buildDwd } from './build.ts';
import { readDwd } from './store.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'ods-source');
const TABLE_NAMES = ['repo', 'asset', 'asset_file', 'license'] as const;

let workDir = '';
let dataRoot = '';
let odsRoot = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mk02-rebuild-'));
  const source = join(workDir, 'source');
  await cp(FIXTURE, source, { recursive: true });
  dataRoot = join(workDir, 'data');
  odsRoot = join(dataRoot, 'ods');
  await materializeOds({ source, out: odsRoot });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('rebuildDwd（删 DWD → 从 ODS 重跑）', () => {
  it('重建前后四表字节一致（规格 §4.3.2/§4.3.3 不变式）', async () => {
    const first = await buildDwd({ odsRoot, out: join(dataRoot, 'dwd') });
    const before = await Promise.all(
      TABLE_NAMES.map(async (name) => readFile(join(dataRoot, 'dwd', `${name}.parquet`))),
    );

    const result = await rebuildDwd({ dataRoot });

    expect(result.consistent).toBe(true);
    expect(result.differences).toEqual([]);
    expect(result.manifest.tables).toEqual(first.manifest.tables);
    for (const [index, name] of TABLE_NAMES.entries()) {
      const after = await readFile(join(dataRoot, 'dwd', `${name}.parquet`));
      expect(after.equals(before[index] ?? Buffer.alloc(0))).toBe(true);
    }
  });

  it('重建确实删除了 DWD 目录（不留旧文件冒充新结果）', async () => {
    await buildDwd({ odsRoot, out: join(dataRoot, 'dwd') });
    await rm(join(dataRoot, 'dwd'), { recursive: true, force: true });
    await expect(readDwd(join(dataRoot, 'dwd'))).rejects.toThrow();

    const result = await rebuildDwd({ dataRoot });
    expect(result.manifest.tables.map((table) => table.name)).toEqual([...TABLE_NAMES]);
    const tables = await readDwd(join(dataRoot, 'dwd'));
    expect(tables.repo).toHaveLength(2);
  });

  it('重建不触网也不读时钟：asOf 注入相同 → 结果相同', async () => {
    const a = await rebuildDwd({ dataRoot, asOf: '2026-10-15T12:00:00Z' });
    const b = await rebuildDwd({ dataRoot, asOf: '2026-10-15T12:00:00Z' });
    expect(b.manifest.asOf).toBe('2026-10-15T12:00:00Z');
    expect(b.manifest.tables).toEqual(a.manifest.tables);
  });

  it('缺 ODS 层 → 明确阻塞错误（不生成空 DWD 冒充通过）', async () => {
    await rm(odsRoot, { recursive: true, force: true });
    await expect(rebuildDwd({ dataRoot })).rejects.toThrow();
  });
});
