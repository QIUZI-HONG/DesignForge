/**
 * 五维评分的可解释展示口径（D2 雷达 + 扣分原因；规格 §5）。
 *
 * 权重与维度键按 §5.1 冻结；`explain` 是**开放式结构**（§5.3 给形状，MK-03 实现），
 * 因此本模块做**防御式解析**：认得的部分照规格渲染，不认得的字段一概忽略（§1.5 前向兼容），
 * 解析不出来也绝不编造——雷达退化为「有值但无解释」的实心点。
 *
 * 「无信号」与「0 分」必须可区分（§5.3）：`explain.<dim>.signals` 为空数组 = 无信号（空心点）。
 */

/** 维度键（§5.1 冻结）。 */
export type QualityDimKey = 'spec' | 'maintenance' | 'docs' | 'security' | 'ecosystem';

/** 维度定义（键 / i18n 标签 / 权重）。 */
export const QUALITY_DIMS: readonly { key: QualityDimKey; labelKey: string; weight: number }[] = [
  { key: 'spec', labelKey: 'market.dim.spec', weight: 0.25 },
  { key: 'maintenance', labelKey: 'market.dim.maintenance', weight: 0.2 },
  { key: 'docs', labelKey: 'market.dim.docs', weight: 0.2 },
  { key: 'security', labelKey: 'market.dim.security', weight: 0.2 },
  { key: 'ecosystem', labelKey: 'market.dim.ecosystem', weight: 0.15 },
];

/** 单维信号（§5.3 `signals: [{code, value, weight}]`）。 */
export interface QualitySignal {
  code: string;
  value: number | null;
  weight: number | null;
}

/** 扣分原因（§5.3 `deductions: [{code, reason, delta}]`）。 */
export interface QualityDeduction {
  code: string;
  reason: string;
  delta: number | null;
}

/** 单维解释（信号 + 扣分）。 */
export interface QualityDimExplain {
  signals: QualitySignal[];
  deductions: QualityDeduction[];
  /** 该维是否有信号（false = 无信号，雷达点画空心）。 */
  hasSignal: boolean;
}

/** 已知原因码 → i18n 键（词表见规格 §5.3；未收录的码回落数据自带的 reason）。 */
const DEDUCTION_LABEL_KEYS: Record<string, string> = {
  S1: 'market.deduct.s1',
  S2: 'market.deduct.s2',
  S3: 'market.deduct.s3',
  M1: 'market.deduct.m1',
  M2: 'market.deduct.m2',
  D1: 'market.deduct.d1',
  D2: 'market.deduct.d2',
  D3: 'market.deduct.d3',
  X1: 'market.deduct.x1',
  X2: 'market.deduct.x2',
  X3: 'market.deduct.x3',
  E1: 'market.deduct.e1',
  L1: 'market.deduct.l1',
};

/** 原因码的文案键（未收录返回 null：界面回落数据里的 reason 文本）。 */
export function deductionLabelKey(code: string): string | null {
  return DEDUCTION_LABEL_KEYS[code] ?? null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 解析单维解释（认不得的字段忽略；结构缺失 → 无信号）。 */
export function readDimExplain(explain: unknown, dim: QualityDimKey): QualityDimExplain {
  const dimRecord = asRecord(asRecord(explain)[dim]);
  const signals: QualitySignal[] = asArray(dimRecord.signals).map((item) => {
    const record = asRecord(item);
    return {
      code: asString(record.code),
      value: asNumberOrNull(record.value),
      weight: asNumberOrNull(record.weight),
    };
  });
  const deductions: QualityDeduction[] = asArray(dimRecord.deductions).map((item) => {
    const record = asRecord(item);
    return {
      code: asString(record.code),
      reason: asString(record.reason),
      delta: asNumberOrNull(record.delta),
    };
  });
  // 「无信号」只在**显式声明**时成立：explain.<dim>.signals 存在且为空数组。
  // 其余情形（无 explain 条目、条目不是对象、没有 signals 键）都按「有值无解释」处理——
  // 结构不认识 ≠ 无信号，宁可实心画点也不替采集线做判断。
  const dimEntry = asRecord(explain)[dim];
  const explicitEmptySignals =
    typeof dimEntry === 'object' &&
    dimEntry !== null &&
    Array.isArray((dimEntry as Record<string, unknown>).signals) &&
    ((dimEntry as Record<string, unknown>).signals as unknown[]).length === 0;
  return {
    signals,
    deductions,
    hasSignal: !explicitEmptySignals,
  };
}

/** 某维的展示值（缺失或越界一律夹到 [0,1]，避免画到雷达外）。 */
export function clampDim(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 扣分原因汇总（详情页「为什么是这个分」列表；按维度顺序，每维最多 3 条）。 */
export interface DimDeductionGroup {
  dim: QualityDimKey;
  labelKey: string;
  deductions: QualityDeduction[];
}

/** 汇总扣分原因（§5.3：每维前 2–3 条人话文案）。 */
export function summarizeDeductions(
  explain: unknown,
  options: { perDim?: number } = {},
): DimDeductionGroup[] {
  const perDim = options.perDim ?? 3;
  const groups: DimDeductionGroup[] = [];
  for (const dim of QUALITY_DIMS) {
    const parsed = readDimExplain(explain, dim.key);
    if (parsed.deductions.length === 0) continue;
    groups.push({
      dim: dim.key,
      labelKey: dim.labelKey,
      deductions: parsed.deductions.slice(0, perDim),
    });
  }
  return groups;
}

/** 雷达数据点（含无信号标记）。 */
export interface RadarDim {
  key: QualityDimKey;
  labelKey: string;
  value: number;
  hasSignal: boolean;
}

/** 组装雷达数据（五维齐；值夹到 [0,1]）。 */
export function buildRadarDims(dims: Record<QualityDimKey, number>, explain: unknown): RadarDim[] {
  return QUALITY_DIMS.map((dim) => ({
    key: dim.key,
    labelKey: dim.labelKey,
    value: clampDim(dims[dim.key]),
    hasSignal: readDimExplain(explain, dim.key).hasSignal,
  }));
}

/**
 * 雷达多边形顶点（SVG 坐标；从正上方顺时针）。
 * 纯几何：`ratio` 为半径比例，`count` 为轴数——便于单测断言对称性与退化情形。
 */
export function radarPolygon(
  ratios: readonly number[],
  center: number,
  radius: number,
): { x: number; y: number }[] {
  return ratios.map((ratio, index) => {
    const angle = (Math.PI * 2 * index) / ratios.length - Math.PI / 2;
    const r = radius * clampDim(ratio);
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle) };
  });
}

/** 顶点序列 → SVG points 字符串（保留两位小数，避免长浮点数进 DOM）。 */
export function toPointsAttr(points: readonly { x: number; y: number }[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}
