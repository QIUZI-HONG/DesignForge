/**
 * DWD 物理存储（Parquet 读写，规格 §4.2 格式抉择）。
 *
 * 写：`parquetWriteBuffer`（纯 JS，SNAPPY，确定性输出——同输入同字节，是重建一致性的前提）。
 * 读：`parquetReadObjects` + `asyncBufferFromFile`（MK-03/MK-04 消费入口 `readDwd`）。
 *
 * 类型口径：`INT64` 在写入端用 `BigInt`、读取端如实转回 `number`（repo_id 远小于 2^53）；
 * `JSON` 列在磁盘上是 UTF-8 文本，读取端解析回结构，保证「读回 == 构建时的行」。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';

import { columnsOf, type DwdTables, TABLE_NAMES, type TableName } from './tables.ts';

export interface TableArtifact {
  name: TableName;
  path: string;
  sha256: string;
  length: number;
  rows: number;
}

/** 行对象 → 列数据（含 JSON 序列化与 INT64 的 BigInt 转换）。 */
function toColumnData(name: TableName, rows: Record<string, unknown>[]) {
  return columnsOf(name).map((column) => {
    const data = rows.map((row) => {
      const value = row[column.name];
      if (value === undefined) return null;
      if (column.type === 'JSON') return value === null ? null : JSON.stringify(value);
      if (column.type === 'INT64') return value === null ? null : BigInt(value as number);
      return value;
    });
    return { name: column.name, data, type: column.type };
  });
}

/** 写单表（Parquet + 行数 + 内容哈希）。 */
export async function writeTable(
  dir: string,
  name: TableName,
  rows: Record<string, unknown>[],
): Promise<TableArtifact> {
  const buffer = parquetWriteBuffer({ columnData: toColumnData(name, rows) });
  const bytes = Buffer.from(new Uint8Array(buffer));
  const path = join(dir, `${name}.parquet`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes);
  return {
    name,
    path,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    length: bytes.byteLength,
    rows: rows.length,
  };
}

/** 读单表：按列定义还原类型（INT64→number、JSON→结构、其余原样）。 */
export async function readTable<T>(dir: string, name: TableName): Promise<T[]> {
  const path = join(dir, `${name}.parquet`);
  const file = await asyncBufferFromFile(path);
  const raw = (await parquetReadObjects({ file })) as Record<string, unknown>[];
  const columns = columnsOf(name);
  return raw.map((row) => {
    const converted: Record<string, unknown> = {};
    for (const column of columns) {
      const value = row[column.name];
      if (value === undefined || value === null) converted[column.name] = null;
      else if (column.type === 'JSON')
        converted[column.name] = JSON.parse(String(value)) as unknown;
      else if (column.type === 'INT64') converted[column.name] = Number(value as bigint);
      else converted[column.name] = value;
    }
    return converted as T;
  });
}

/** 读回四表（MK-03/MK-04 与重建比对的消费入口）。 */
export async function readDwd(dir: string): Promise<DwdTables> {
  const repo = await readTable<DwdTables['repo'][number]>(dir, 'repo');
  const asset = await readTable<DwdTables['asset'][number]>(dir, 'asset');
  const assetFile = await readTable<DwdTables['asset_file'][number]>(dir, 'asset_file');
  const license = await readTable<DwdTables['license'][number]>(dir, 'license');
  return { repo, asset, asset_file: assetFile, license };
}

/** 写 DWD 四表（顺序固定：repo → asset → asset_file → license）。 */
export async function writeDwd(dir: string, tables: DwdTables): Promise<TableArtifact[]> {
  const artifacts: TableArtifact[] = [];
  for (const name of TABLE_NAMES) {
    artifacts.push(
      await writeTable(dir, name, tables[name] as unknown as Record<string, unknown>[]),
    );
  }
  return artifacts;
}

/** 读回单表的原始字节（重建比对用，避免反序列化误差）。 */
export async function readTableBytes(dir: string, name: TableName): Promise<Buffer> {
  return readFile(join(dir, `${name}.parquet`));
}
