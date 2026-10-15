/**
 * MK-02 公共 API 出口：规范化与四层仓落盘（ODS → DWD）。
 *
 * 消费方：
 *   - MK-03（五维评分）读 `readDwd` 的四表；
 *   - MK-04（索引与检索）读 `readDwd` + `validateDwd`；
 *   - MK-05（CLI 与首批跑通）经 `runTransformCli` / `materializeOds` / `buildDwd` / `rebuildDwd` 串链路；
 *   - D6 数据看板用 `_dwd_manifest.json` 与 `validateDwd` 的孤儿引用结论。
 *
 * 规格依据：《技能市场规格 v1》§1.6（digest）/§2（识别与归一）/§4（四层仓布局、落盘、幂等、字段）。
 */

export type { CliOutcome } from './cli.ts';
export { runTransformCli } from './cli.ts';
export type { DwdBuildInput, DwdBuildResult, DwdManifest } from './dwd/build.ts';
export { buildDwd, detectLanguage, inferUpstream } from './dwd/build.ts';
export type { TableArtifact } from './dwd/store.ts';
export { readDwd, readTable, readTableBytes, writeDwd, writeTable } from './dwd/store.ts';
export type {
  AssetFileRow,
  AssetRow,
  DwdTables,
  LicenseRow,
  RepoRow,
  TableName,
} from './dwd/tables.ts';
export { columnsOf, TABLE_NAMES } from './dwd/tables.ts';
export { validateDwd } from './dwd/validate.ts';
export type { ClusterAssetInput, ClusterAssignment, ClusterResult } from './lineage/cluster.ts';
export {
  assignClusters,
  bodyFingerprint,
  clusterIdOf,
  hammingDistance,
  jaccard,
  minhashSignature,
  normalizeBody,
  signatureSimilarity,
  simhash64,
} from './lineage/cluster.ts';
export type { AssetDigestResult, AssetFileHash } from './lineage/digest.ts';
export { computeAssetDigest } from './lineage/digest.ts';
export type { MaterializeInput, MaterializeResult } from './ods/materialize.ts';
export {
  classifyMediaType,
  listingDigest,
  materializeOds,
  repoDirName,
} from './ods/materialize.ts';
export type { OdsBundle, OdsSourceBundle } from './ods/read.ts';
export {
  OdsMissingError,
  readBlobText,
  readOds,
  readOdsSource,
  resolveOdsRoot,
} from './ods/read.ts';
export {
  computeSnapshotDigest,
  validateFilesSnapshot,
  validateOdsRepoRecord,
  validateRawEvent,
  validateSnapshotDigest,
} from './ods/schema.ts';
export { parseFrontmatter } from './parse/frontmatter.ts';
export { parseManifest } from './parse/manifest.ts';
export { parseTokensDocument } from './parse/tokens.ts';
export type {
  IdentifiedAsset,
  LicenseAssessment,
  OdsFileEntry,
  OdsRepoFilesSnapshot,
  OdsRepoRecord,
  OdsSourceFile,
  OdsValidationIssue,
  RawEvent,
} from './types.ts';
