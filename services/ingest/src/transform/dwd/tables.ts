/**
 * DWD 四表的行类型与列定义（规格 §4.1 目录布局 / §4.2 落盘格式 / §4.4 四层字段）。
 *
 * 物理格式：**Parquet**（规格 §4.2 明示；列存 + 高压缩 + DuckDB 可直接读）。
 * 实现取纯 JS 写入器（`hyparquet-writer`）与读取器（`hyparquet`）——不引原生依赖、可离线复跑；
 * 列定义（名字/类型/可空）集中在本文件，是写、读、校验三处的单一真源。
 */

import type { LicenseGate, LicenseTier } from '../types.ts';

export type TableName = 'repo' | 'asset' | 'asset_file' | 'license';

export const TABLE_NAMES: TableName[] = ['repo', 'asset', 'asset_file', 'license'];

/**
 * 列类型（Parquet 基本类型子集）：
 * - `STRING`/`INT32`/`INT64`/`BOOLEAN`/`DOUBLE` 直接映射；
 * - `JSON` 承载嵌套结构（数组/对象）——列存里以 UTF-8 JSON 文本存放，读回时解析。
 */
export type ColumnType = 'STRING' | 'INT32' | 'INT64' | 'BOOLEAN' | 'DOUBLE' | 'JSON';

export interface ColumnSpec {
  name: string;
  type: ColumnType;
}

/** repo 表：仓库维度（规格 §4.4）。 */
export interface RepoRow {
  repo_id: number;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  stars: number;
  forks: number;
  size_kb: number;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  homepage: string | null;
  description: string | null;
  topics: string[];
  license_spdx: string | null;
  license_gate: LicenseGate;
  is_list_repo: boolean;
  /** 采集时点 commit（本仓最近一次观测）。 */
  ref: string;
  fetched_at: string;
  first_seen_run_id: string;
  last_seen_run_id: string;
  observation_count: number;
  /** 同源上游（`owner/repo` 或 URL），无则 null（规格 §1.3/§2.6.3）。 */
  upstream: string | null;
  /** 上游判定来源：`declared`（声明） / `body-link`（正文链接推断）。 */
  upstream_source: string | null;
  asset_count: number;
  /** 仓库创建时间（冷启动 <90 天判定，规格 §5.4）；null = 采集侧未给。 */
  created_at: string | null;
  /** 90 天前星标水位（生态维星标增速信号，规格 §5.2）；null = 未取到。 */
  stars_90d_ago: number | null;
  /** 被引用数（同批仓中 upstream 指向本仓的仓数；口径见 build DWD 头注释）。 */
  referenced_by: number;
  /** Trees 截断标志（超大仓：文件级「不存在」不可证明，规格 §3.5/§5.4）。 */
  tree_truncated: boolean;
  /** Trees 条目数（规模信号与截断复核）。 */
  tree_entry_count: number;
}

/** asset 表：资产主表（规格 §4.4，含 §1.2 的卡片基础字段）。 */
export interface AssetRow {
  asset_id: string;
  repo_id: number;
  repo_full_name: string;
  kind: string;
  name: string;
  display_name_zh_cn: string;
  display_name_en: string;
  summary_zh_cn: string;
  summary_en: string;
  /** 摘要原文语言（`zh`/`en`）；双语字段同源时标注，供 ADS 回退与翻译声明。 */
  summary_lang: string | null;
  description: string | null;
  description_lang: string | null;
  root: string;
  ref: string;
  fetched_at: string;
  version: string | null;
  declared_license: string | null;
  compliance: string;
  capabilities: string[];
  probes: { piece: string; path: string }[];
  checks: { rule: string; ok: boolean; detail: string }[];
  /** 解析留痕（frontmatter/manifest/tokens 三类解析结论）。 */
  parse_report: Record<string, unknown>;
  /** 主描述正文的字节数与「链接行占比」（规格 §2.2 redirect 判定证据）。 */
  body_bytes: number | null;
  body_links_ratio: number | null;
  /**
   * 描述性文本抽取组（规格 §4.4 `text` 组；MK-03 五维评分的文本信号源）。
   * 列与 `DwdTextView` 一一对应：body/readme/manifest/frontmatter/packageJson/mcpJson/changelog。
   */
  text_frontmatter: Record<string, unknown> | null;
  text_body: string | null;
  text_readme: string | null;
  text_manifest: Record<string, unknown> | null;
  text_package_json: Record<string, unknown> | null;
  text_mcp_json: Record<string, unknown> | null;
  text_changelog: string | null;
  file_count: number;
  known_sha256_count: number;
  /** 规格 §1.6 内容哈希（内容不齐时为 null，**不冒充**）。 */
  digest: string | null;
  digest_status: string;
  digest_coverage: number;
  /** 采集侧目录指纹（git blob sha 口径，始终可得）。 */
  tree_digest: string;
  cluster_id: string | null;
  cluster_size: number;
  cluster_reason: string;
  review_queue: boolean;
  review_with: string[];
  license_gate: LicenseGate;
  brand_derived: boolean;
  is_list_repo: boolean;
  first_seen_run_id: string;
  last_seen_run_id: string;
  observation_count: number;
}

/** asset_file 表：文件清单（相对路径 + sha256 + 字节数，规格 §4.4）。 */
export interface AssetFileRow {
  asset_id: string;
  repo_id: number;
  /** 资产根内相对路径。 */
  path: string;
  /** 仓内相对路径（装载与调试用）。 */
  repo_path: string;
  git_sha: string;
  size: number | null;
  sha256: string | null;
  blob_ref: string | null;
  media_type: string;
  is_license: boolean;
  is_descriptive_text: boolean;
  parsed: boolean;
}

/** license 表：协议与守门判定（规格 §4.4 / §7.2）。 */
export interface LicenseRow {
  repo_id: number;
  repo_full_name: string;
  /** 资产级守门为资产 id；仓级为 null。 */
  asset_id: string | null;
  scope: 'repo' | 'asset';
  spdx: string | null;
  tier: LicenseTier;
  gate: LicenseGate;
  reasons: string[];
  evidence_path: string | null;
  evidence_sha256: string | null;
  evidence_blob_ref: string | null;
  brand_derived: boolean;
  archived: boolean;
  /** 资产自声明许可（frontmatter/manifest 原样）。 */
  declared_license: string | null;
  ref: string;
  fetched_at: string;
  run_id: string;
}

export interface DwdTables {
  repo: RepoRow[];
  asset: AssetRow[];
  asset_file: AssetFileRow[];
  license: LicenseRow[];
}

const COLUMNS: Record<TableName, ColumnSpec[]> = {
  repo: [
    { name: 'repo_id', type: 'INT64' },
    { name: 'full_name', type: 'STRING' },
    { name: 'owner', type: 'STRING' },
    { name: 'name', type: 'STRING' },
    { name: 'default_branch', type: 'STRING' },
    { name: 'stars', type: 'INT32' },
    { name: 'forks', type: 'INT32' },
    { name: 'size_kb', type: 'INT32' },
    { name: 'pushed_at', type: 'STRING' },
    { name: 'archived', type: 'BOOLEAN' },
    { name: 'fork', type: 'BOOLEAN' },
    { name: 'homepage', type: 'STRING' },
    { name: 'description', type: 'STRING' },
    { name: 'topics', type: 'JSON' },
    { name: 'license_spdx', type: 'STRING' },
    { name: 'license_gate', type: 'STRING' },
    { name: 'is_list_repo', type: 'BOOLEAN' },
    { name: 'ref', type: 'STRING' },
    { name: 'fetched_at', type: 'STRING' },
    { name: 'first_seen_run_id', type: 'STRING' },
    { name: 'last_seen_run_id', type: 'STRING' },
    { name: 'observation_count', type: 'INT32' },
    { name: 'upstream', type: 'STRING' },
    { name: 'upstream_source', type: 'STRING' },
    { name: 'asset_count', type: 'INT32' },
    // 对接面修复（MK-05 阶段 A）：冷启动/生态维/Trees 截断的输入必须落列（规格 §4.4/§5.4）
    { name: 'created_at', type: 'STRING' },
    { name: 'stars_90d_ago', type: 'INT32' },
    { name: 'referenced_by', type: 'INT32' },
    { name: 'tree_truncated', type: 'BOOLEAN' },
    { name: 'tree_entry_count', type: 'INT32' },
  ],
  asset: [
    { name: 'asset_id', type: 'STRING' },
    { name: 'repo_id', type: 'INT64' },
    { name: 'repo_full_name', type: 'STRING' },
    { name: 'kind', type: 'STRING' },
    { name: 'name', type: 'STRING' },
    { name: 'display_name_zh_cn', type: 'STRING' },
    { name: 'display_name_en', type: 'STRING' },
    { name: 'summary_zh_cn', type: 'STRING' },
    { name: 'summary_en', type: 'STRING' },
    { name: 'summary_lang', type: 'STRING' },
    { name: 'description', type: 'STRING' },
    { name: 'description_lang', type: 'STRING' },
    { name: 'root', type: 'STRING' },
    { name: 'ref', type: 'STRING' },
    { name: 'fetched_at', type: 'STRING' },
    { name: 'version', type: 'STRING' },
    { name: 'declared_license', type: 'STRING' },
    { name: 'compliance', type: 'STRING' },
    { name: 'capabilities', type: 'JSON' },
    { name: 'probes', type: 'JSON' },
    { name: 'checks', type: 'JSON' },
    { name: 'parse_report', type: 'JSON' },
    { name: 'body_bytes', type: 'INT32' },
    { name: 'body_links_ratio', type: 'DOUBLE' },
    // text 抽取组（规格 §4.4；评分文本信号源）
    { name: 'text_frontmatter', type: 'JSON' },
    { name: 'text_body', type: 'STRING' },
    { name: 'text_readme', type: 'STRING' },
    { name: 'text_manifest', type: 'JSON' },
    { name: 'text_package_json', type: 'JSON' },
    { name: 'text_mcp_json', type: 'JSON' },
    { name: 'text_changelog', type: 'STRING' },
    { name: 'file_count', type: 'INT32' },
    { name: 'known_sha256_count', type: 'INT32' },
    { name: 'digest', type: 'STRING' },
    { name: 'digest_status', type: 'STRING' },
    { name: 'digest_coverage', type: 'DOUBLE' },
    { name: 'tree_digest', type: 'STRING' },
    { name: 'cluster_id', type: 'STRING' },
    { name: 'cluster_size', type: 'INT32' },
    { name: 'cluster_reason', type: 'STRING' },
    { name: 'review_queue', type: 'BOOLEAN' },
    { name: 'review_with', type: 'JSON' },
    { name: 'license_gate', type: 'STRING' },
    { name: 'brand_derived', type: 'BOOLEAN' },
    { name: 'is_list_repo', type: 'BOOLEAN' },
    { name: 'first_seen_run_id', type: 'STRING' },
    { name: 'last_seen_run_id', type: 'STRING' },
    { name: 'observation_count', type: 'INT32' },
  ],
  asset_file: [
    { name: 'asset_id', type: 'STRING' },
    { name: 'repo_id', type: 'INT64' },
    { name: 'path', type: 'STRING' },
    { name: 'repo_path', type: 'STRING' },
    { name: 'git_sha', type: 'STRING' },
    { name: 'size', type: 'INT32' },
    { name: 'sha256', type: 'STRING' },
    { name: 'blob_ref', type: 'STRING' },
    { name: 'media_type', type: 'STRING' },
    { name: 'is_license', type: 'BOOLEAN' },
    { name: 'is_descriptive_text', type: 'BOOLEAN' },
    { name: 'parsed', type: 'BOOLEAN' },
  ],
  license: [
    { name: 'repo_id', type: 'INT64' },
    { name: 'repo_full_name', type: 'STRING' },
    { name: 'asset_id', type: 'STRING' },
    { name: 'scope', type: 'STRING' },
    { name: 'spdx', type: 'STRING' },
    { name: 'tier', type: 'STRING' },
    { name: 'gate', type: 'STRING' },
    { name: 'reasons', type: 'JSON' },
    { name: 'evidence_path', type: 'STRING' },
    { name: 'evidence_sha256', type: 'STRING' },
    { name: 'evidence_blob_ref', type: 'STRING' },
    { name: 'brand_derived', type: 'BOOLEAN' },
    { name: 'archived', type: 'BOOLEAN' },
    { name: 'declared_license', type: 'STRING' },
    { name: 'ref', type: 'STRING' },
    { name: 'fetched_at', type: 'STRING' },
    { name: 'run_id', type: 'STRING' },
  ],
};

/** 列定义（写/读/校验共用；返回副本避免外部改写）。 */
export function columnsOf(name: TableName): ColumnSpec[] {
  return COLUMNS[name].map((column) => ({ ...column }));
}
