/**
 * 重建 DWD（规格 §4.3.3：删任一上层目录，从上层重跑结果一致）。
 *
 * 语义：**删掉 `dwd/` 目录**（不留旧文件冒充新结果）→ 仅从 `ods/` 重跑 → 比对重建前后
 * 四表字节哈希与行数。差异非空即不一致（判 `consistent=false` 并逐条列出），由调用方上报退出码。
 */

import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { buildDwd, type DwdManifest } from './dwd/build.ts';
import { TABLE_NAMES, type TableName } from './dwd/tables.ts';
import { readOds } from './ods/read.ts';

export interface RebuildInput {
  /** 四层仓数据根（含 `ods/` 与 `dwd/`）。 */
  dataRoot: string;
  /** 批次时点注入（缺省取 ODS 记录中的最大 fetchedAt）。 */
  asOf?: string;
}

export interface TableSummary {
  name: TableName;
  rows: number;
  sha256: string;
  length: number;
}

export interface RebuildResult {
  consistent: boolean;
  differences: string[];
  before: TableSummary[];
  after: TableSummary[];
  manifest: DwdManifest;
  dwdRoot: string;
}

/** 读回目录中四表摘要（缺文件如实报缺，不当作 0 行通过）。 */
async function summarize(dwdRoot: string): Promise<TableSummary[]> {
  const out: TableSummary[] = [];
  for (const name of TABLE_NAMES) {
    const path = join(dwdRoot, `${name}.parquet`);
    const bytes = await readFile(path);
    out.push({
      name,
      rows: -1,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      length: bytes.byteLength,
    });
  }
  return out;
}

/** 删 DWD → 从 ODS 重跑 → 比对一致性。 */
export async function rebuildDwd(input: RebuildInput): Promise<RebuildResult> {
  const dwdRoot = join(input.dataRoot, 'dwd');
  const odsRoot = join(input.dataRoot, 'ods');

  // 前置：ODS 层必须在（否则是阻塞，不是「重建完成」）
  await readOds(odsRoot);

  let before: TableSummary[] = [];
  let hadBefore = true;
  try {
    before = await summarize(dwdRoot);
  } catch {
    hadBefore = false;
  }

  // 删除整个 DWD 目录：重建不得复用任何旧文件
  await rm(dwdRoot, { recursive: true, force: true });

  const built = await buildDwd(
    input.asOf === undefined
      ? { odsRoot, out: dwdRoot }
      : { odsRoot, out: dwdRoot, asOf: input.asOf },
  );
  const after = await summarize(dwdRoot);
  const afterByTable = new Map(built.artifacts.map((artifact) => [artifact.name, artifact]));
  const afterCounted = after.map((table) => ({
    ...table,
    rows: afterByTable.get(table.name)?.rows ?? -1,
  }));

  const beforeCounted = before.map((table) => ({
    ...table,
    rows: table.rows,
  }));

  const differences: string[] = [];
  if (!hadBefore) {
    differences.push('重建前无 DWD 目录（首次构建，无对照）');
  } else {
    for (const name of TABLE_NAMES) {
      const prev = beforeCounted.find((table) => table.name === name);
      const next = afterCounted.find((table) => table.name === name);
      if (prev === undefined || next === undefined) {
        differences.push(
          `表 ${name} 缺一边：before=${prev !== undefined} after=${next !== undefined}`,
        );
        continue;
      }
      if (prev.sha256 !== next.sha256) {
        differences.push(`表 ${name} 字节不一致：${prev.sha256} → ${next.sha256}`);
      }
      if (prev.length !== next.length) {
        differences.push(`表 ${name} 长度不一致：${prev.length} → ${next.length}`);
      }
    }
  }

  return {
    consistent: hadBefore && differences.length === 0,
    differences,
    before: beforeCounted,
    after: afterCounted,
    manifest: built.manifest,
    dwdRoot,
  };
}
