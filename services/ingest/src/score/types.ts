/**
 * 五维评分（DWS）类型与常量（MK-03）。
 *
 * 规格依据：《技能市场规格 v1》§5（权重 / 每维信号与算法 / 可解释输出 / 冷启动与边界）
 * + §1.2（ADS `quality` 字段）+ §4.4（DWS 层 `asset_quality` 字段摘要）。
 *
 * 输入契约说明：DWD 层的正式形状由 MK-02（`services/ingest/src/transform`）落地；
 * 本文件给出评分器的**最小输入契约** `DwdAsset`——直接对应规格 §4.4 的 DWD 四张表
 * （asset / asset_file / repo / license）+ 描述性文本抽取（MK-02 从 ODS blob 解析所得）。
 * 对接原则：多出的字段忽略（前向兼容，§1.5.1）；缺的字段由 `dwd.ts` 归一化为 null
 * （可选信号不参与加权，见 `dwd.ts` 头注释）；评分算法不因对接而改。
 */

/** 四类资产（规格 §2）。 */
export type AssetKind = 'skill' | 'plugin' | 'design-system' | 'template';

/** license 三档守门（规格 §7.2）。 */
export type LicenseGate = 'loadable' | 'view-only' | 'blocked';

/**
 * 规范符合度标记（规格 §2.2）。
 * `non-compliant`（如 7 个无 frontmatter 的 SKILL.md）→ 入库但 spec 走低、`confidence=low`（§5.4）。
 */
export type Compliance = 'ok' | 'non-compliant' | 'deferred';

/** 置信度（规格 §5.4：合规样本 `confidence=low`；`deferred` 如实降置信）。 */
export type Confidence = 'high' | 'low';

/** 五维键；数组顺序即雷达轴序（规格 §5.1 表格顺序）。 */
export const DIMENSIONS = ['spec', 'maintenance', 'docs', 'security', 'ecosystem'] as const;
export type DimKey = (typeof DIMENSIONS)[number];

/** 五维权重（规格 §5.1 定稿，合计 1.00）。 */
export const DIM_WEIGHTS: Readonly<Record<DimKey, number>> = Object.freeze({
  spec: 0.25,
  maintenance: 0.2,
  docs: 0.2,
  security: 0.2,
  ecosystem: 0.15,
});

/** 五维中文名（展示用；术语与规格 §5.1 一致）。 */
export const DIM_LABELS: Readonly<Record<DimKey, string>> = Object.freeze({
  spec: '规范符合度',
  maintenance: '维护活跃度',
  docs: '文档完备度',
  security: '安全性',
  ecosystem: '生态热度',
});

/** 维度分保留位数（内部精度；防浮点噪声污染快照）。 */
export const ROUND_DIM_DIGITS = 4;

/** 总分保留位数（规格 §5.1：两位小数）。 */
export const ROUND_TOTAL_DIGITS = 2;

/** 扣分记账的最小粒度：低于此值的扣分不记（避免浮点尘埃进入快照）。 */
export const DEDUCTION_DUST = 0.005;

/** DWS 层 schema 标识。 */
export const DWS_QUALITY_SCHEMA = 'df.market.dws.asset_quality/v1' as const;

/** 信号观测值（原始量，非分值；JSON 可序列化，快照稳定）。 */
export type SignalValue = number | string | boolean | null;

/** 一条信号明细（规格 §5.3 `signals: [{code, value, weight}]`；`score` 为本票扩展字段）。 */
export interface SignalDetail {
  /** 信号码（`codes.ts` 唯一真源，稳定可快照）。 */
  code: string;
  /** 观测到的原始值（人话可读；复合信号用短枚举串）。 */
  value: SignalValue;
  /** 该信号在本维度内的权重（0–1；同一维度内**可算**信号权重和为 1）。 */
  weight: number;
  /** 该信号子分 [0,1]；null = 无信号/不可得（不参与加权，雷达空心）。 */
  score: number | null;
}

/** 一条扣分原因（规格 §5.3 `deductions: [{code, reason, delta}]`）。 */
export interface Deduction {
  /** 原因码（`codes.ts` 唯一真源）。 */
  code: string;
  /** 该笔扣分的人话理由（含具体观测；UI 直接展示）。 */
  reason: string;
  /** 扣掉的**维度分**（0–1 标度；`L1` 等不扣分项恒为 0）。 */
  delta: number;
}

/** 单维结果：分值 + 信号明细 + 扣分原因码。 */
export interface DimensionResult {
  /** 维度分 [0,1]；null = 无可用信号（雷达空心，区别于 0 分，规格 §5.3）。 */
  score: number | null;
  signals: SignalDetail[];
  deductions: Deduction[];
}

/** 资产根文件条目（规格 §4.4 `asset_file`：相对路径 + sha256 + size）。 */
export interface DwdFileEntry {
  path: string;
  size: number;
  sha256: string;
}

/** 资产主表行（规格 §4.4 `asset`；评分所需子集）。 */
export interface DwdAssetView {
  /** `gh:<owner>/<repo>#<路径>`（规格 §1.2）。 */
  id: string;
  kind: AssetKind;
  name: string;
  /** 采集时点 commit（40 位 hex）。 */
  ref: string;
  /** 资产根相对路径（仓库根 = `""`）。 */
  path: string;
  compliance: Compliance;
  /**
   * 是否**显式声明**了能力。规格 §1.2：未声明时缺省注入 `["prompt:inject"]`，
   * 故 `capabilities` 非空不等于已声明——安全维 `X2` 以此布尔为准。
   */
  capabilitiesDeclared: boolean;
  capabilities: string[];
}

/** 仓库维度行（规格 §4.4 `repo`；评分所需子集）。 */
export interface DwdRepoView {
  repoId: number;
  /** `owner/repo`。 */
  fullName: string;
  stars: number;
  forks: number;
  /** 最后 push（维护活跃信号源，规格 §1.3）。 */
  pushedAt: string;
  /** 创建时间（冷启动 <90 天判定，规格 §5.4）。 */
  createdAt: string;
  archived: boolean;
  fork: boolean;
  /** 同源上游（规格 §1.3；许可署名信号源）。 */
  upstream: string | null;
  /** 最近 90 天提交数（v1+ 增强信号，规格 §5.2 脚注；null = 无数据，不参与加权）。 */
  commits90d: number | null;
  /** 最近一次 release 时间（v1+ 增强信号；null = 无数据/无 release）。 */
  lastReleaseAt: string | null;
}

/** 许可行（规格 §4.4 `license`：spdx 原文 + 判定档 + 证据哈希）。 */
export interface DwdLicenseView {
  spdx: string | null;
  gate: LicenseGate;
  evidence: { path: string | null; sha256: string | null };
}

/** 描述性文本抽取（MK-02 从 ODS blob 解析；评分文本信号源，规格 §2.1.5 只取描述性文本）。 */
export interface DwdTextView {
  /** frontmatter 解析结果（平坦键值）；无 frontmatter = null。 */
  frontmatter: Record<string, unknown> | null;
  /** SKILL.md 正文（去 frontmatter 后）；非 skill 类可为 null。 */
  body: string | null;
  /** README 正文（资产根优先、回退仓库根）；无 = null。 */
  readme: string | null;
  /** 清单 JSON 原样（plugin.json / design-system manifest / template manifest）。 */
  manifest: Record<string, unknown> | null;
  /** package.json 原样（安全审计：`scripts` 生命周期钩子）。 */
  packageJson: Record<string, unknown> | null;
  /** `.mcp.json` 原样（能力声明证据；规格 §2.3：单独出现不升类）。 */
  mcpJson: Record<string, unknown> | null;
  /** CHANGELOG 正文；无 = null。 */
  changelog: string | null;
}

/** 趋势信号源（规格 §4.4 摘要未列全，按 §5.2 生态热度信号补足；缺数据用 null）。 */
export interface DwdTrendView {
  /** 90 天前星标数（历史快照）；null = 增速信号不可得。 */
  stars90dAgo: number | null;
  /** 被其他仓引用 / 同源落点数；null = 无数据。 */
  referencedBy: number | null;
}

/** DWD 资产记录（评分输入，一资产一条）。 */
export interface DwdAsset {
  asset: DwdAssetView;
  repo: DwdRepoView;
  license: DwdLicenseView;
  /** 资产根文件清单；`truncated` = Trees 截断（超大仓口径，规格 §3.5/§5.4）。 */
  files: { truncated: boolean; entries: DwdFileEntry[] };
  text: DwdTextView;
  trend: DwdTrendView;
}

/** DWS 层 `asset_quality` 记录（规格 §4.4 + §5；ADS `quality` 由 `dws.ts#adsQualityOf` 直取）。 */
export interface AssetQualityRecord {
  schema: typeof DWS_QUALITY_SCHEMA;
  assetId: string;
  kind: AssetKind;
  /** 批次时点（注入，禁时钟依赖——同输入同输出，规格 §4.3.2）。 */
  asOf: string;
  /** 总分 = Σ(权重 × 维度分)（冷启动/无信号维度重归一化），两位小数；null = 无可算维度。 */
  score: number | null;
  confidence: Confidence;
  flags: {
    archived: boolean;
    /** 冷启动托底已生效（生态热度不计入总分，规格 §5.4）。 */
    coldStart: boolean;
    nonCompliant: boolean;
    filesTruncated: boolean;
  };
  /** 五维分（雷达数据点；null = 空心）。 */
  dims: Record<DimKey, number | null>;
  /** 每维信号明细与扣分原因码（规格 §5.3）。 */
  explain: Record<DimKey, { signals: SignalDetail[]; deductions: Deduction[] }>;
}

/** 评分批次选项（`asOf` 必填注入——复现基准）。 */
export interface ScoreBatchOptions {
  asOf: string;
}

/** 评分批次产物。 */
export interface ScoreBatchResult {
  records: AssetQualityRecord[];
  /** 批次统计（证据/报告用）。 */
  summary: {
    total: number;
    coldStart: number;
    archived: number;
    nonCompliant: number;
    /** 全维可算（无空心）的资产数。 */
    fullyScored: number;
  };
}
