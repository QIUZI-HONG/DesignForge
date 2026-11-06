/**
 * DWD 物理存储（Parquet 读写，规格 §4.2 格式抉择）。
 *
 * 写：`parquetWriteBuffer`（纯 JS，SNAPPY，确定性输出——同输入同字节，是重建一致性的前提）。
 * 读：`parquetReadObjects` + `asyncBufferFromFile`（MK-03/MK-04 消费入口 `readDwd`）。
 *
 * 类型口径：`INT64` 在写入端用 `BigInt`、读取端如实转回 `number`（repo_id 远小于 2^53）；
 * `JSON` 列在磁盘上是 UTF-8 文本，读取端解析回结构，保证「读回 == 构建时的行」。
 *
 * 读取容错（audit-d05 · D-06）：磁盘损坏的 JSON 单元格（外部损坏/版本偏差/半写）解析失败时
 * 降级为 null 并告警（`ReadWarningOptions.onWarning`，缺省 stderr）——好行照常返回，
 * 坏格不再炸整批；好数据路径的解析行为逐字节不变。
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

/**
 * 读取告警选项（audit-d05 · D-06）：
 * 磁盘 JSON 列可能因外部损坏/版本偏差/半写出现非 JSON 文本——读取容错把坏单元格降级为
 * null，但**不许静默吞**：每处降级经 `onWarning` 上报（缺省写 stderr，调用方可注入收集）。
 */
export interface ReadWarningOptions {
  /** 告警接收器（缺省 `process.stderr.write`；测试/CLI 注入以捕获计数）。 */
  onWarning?: (warning: string) => void;
}

/** 缺省告警出口：stderr（CLI/门禁日志可见，不污染 stdout 数据通道）。 */
function defaultWarn(warning: string): void {
  process.stderr.write(`${warning}\n`);
}

/** 归一告警接收器（未注入 → stderr）。 */
function warnSinkOf(opts: ReadWarningOptions | undefined): (warning: string) => void {
  return opts?.onWarning ?? defaultWarn;
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

/**
 * 读单表：按列定义还原类型（INT64→number、JSON→结构、其余原样）。
 *
 * 容错口径（audit-d05 · D-06）：JSON 列单元格解析失败时**只降级该单元格**为 null 并告警，
 * 好行照常返回——坏格不再炸整批（磁盘损坏的损失上限 = 单格，而不是全表）。
 */
export async function readTable<T>(
  dir: string,
  name: TableName,
  opts?: ReadWarningOptions,
): Promise<T[]> {
  const path = join(dir, `${name}.parquet`);
  const file = await asyncBufferFromFile(path);
  const raw = (await parquetReadObjects({ file })) as Record<string, unknown>[];
  const columns = columnsOf(name);
  const warn = warnSinkOf(opts);
  return raw.map((row, rowIndex) => {
    const converted: Record<string, unknown> = {};
    for (const column of columns) {
      const value = row[column.name];
      if (value === undefined || value === null) converted[column.name] = null;
      else if (column.type === 'JSON') {
        const text = String(value);
        try {
          converted[column.name] = JSON.parse(text) as unknown;
        } catch {
          // 坏格降级 + 告警（D-06：不许静默吞——计数与定位都在告警文本里）
          warn(
            `DWD 读取容错：${name}.parquet 第 ${rowIndex + 1} 行 ${column.name} 列 JSON 解析失败，已降级为 null（原文 ${text.length} 字符）`,
          );
          converted[column.name] = null;
        }
      } else if (column.type === 'INT64') converted[column.name] = Number(value as bigint);
      else converted[column.name] = value;
    }
    return converted as T;
  });
}

/** 读回四表（MK-03/MK-04 与重建比对的消费入口）；告警选项透传各表。 */
export async function readDwd(dir: string, opts?: ReadWarningOptions): Promise<DwdTables> {
  const repo = await readTable<DwdTables['repo'][number]>(dir, 'repo', opts);
  const asset = await readTable<DwdTables['asset'][number]>(dir, 'asset', opts);
  const assetFile = await readTable<DwdTables['asset_file'][number]>(dir, 'asset_file', opts);
  const license = await readTable<DwdTables['license'][number]>(dir, 'license', opts);
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
