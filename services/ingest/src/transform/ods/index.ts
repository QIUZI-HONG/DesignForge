/**
 * ODS 层模块出口（读取 / 校验 / 规整）。
 *
 * 备忘：`RawEvent` 在本文件内仅作为类型参数使用，故以 `import type` 引入（verbatimModuleSyntax）。
 */

export { stableStringify } from './canonical.ts';
export type {
  MaterializeArtifact,
  MaterializeInput,
  MaterializeResult,
} from './materialize.ts';
export { classifyMediaType, listingDigest, materializeOds, repoDirName } from './materialize.ts';
export type { OdsBundle, OdsSourceBundle } from './read.ts';
export { OdsMissingError, readBlobText, readOds, readOdsSource, resolveOdsRoot } from './read.ts';
export {
  computeSnapshotDigest,
  validateFilesSnapshot,
  validateOdsRepoRecord,
  validateRawEvent,
  validateSnapshotDigest,
} from './schema.ts';
