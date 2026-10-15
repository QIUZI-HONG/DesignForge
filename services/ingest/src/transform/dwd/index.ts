/**
 * DWD 层模块出口（构建 / 读取 / 校验 / 表定义）。
 */

export type { DwdBuildInput, DwdBuildResult, DwdManifest } from './build.ts';
export { buildDwd, DWD_TABLE_NAMES, detectLanguage, inferUpstream, sha256Of } from './build.ts';
export type { TableArtifact } from './store.ts';
export { readDwd, readTable, readTableBytes, writeDwd, writeTable } from './store.ts';
export type {
  AssetFileRow,
  AssetRow,
  ColumnSpec,
  ColumnType,
  DwdTables,
  LicenseRow,
  RepoRow,
  TableName,
} from './tables.ts';
export { columnsOf, TABLE_NAMES } from './tables.ts';
export { validateDwd } from './validate.ts';
