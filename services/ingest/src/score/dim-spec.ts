/**
 * 维度一 · 规范符合度 `spec`（权重 .25，规格 §5.1/§5.2）。
 *
 * 信号与子权（维度内归一化，和 = 1.00）：
 *   spec.frontmatter        .25  frontmatter 必要字段（name + description，规格 §2.2 内容校验）
 *   spec.description-usage  .15  description 是否写成「何时使用」（含触发语境）
 *   spec.workflow           .20  正文是否含显式工作流（步骤 / 命令块）
 *   spec.aux-dirs           .10  是否附 references/ 或 examples/
 *   spec.manifest           .20  清单 schema 字段完整度（plugin / design-system / template）
 *   spec.body               .10  正文非空且非纯链接清单（规格 §2.2 内容校验③）
 *
 * 边界口径：
 *   - 无文本（正文与 README 都缺）→ `spec.workflow` **不可得**（null，不冤枉扣分）；
 *     而 `spec.body` 仍判 0（「正文非空」本身就是被检查的存在性）。两条信号分工不同。
 *   - Trees 截断（超大仓）→ 文件级「不存在」不可证明 → `spec.aux-dirs` 置 null。
 *   - skill 无清单要求 → `spec.manifest` 标 `n/a` 且不参与加权；
 *     其余三类按本类清单字段齐备性判定（缺整体清单同样计入 S5）。
 */

import { REASON_TEXT } from './codes.ts';
import { hasAuxDir } from './files.ts';
import { hasExplicitWorkflow, isPureLinkList, looksLikeWhenToUse } from './text.ts';
import type { AssetKind, DimensionResult, DwdAsset, SignalDetail } from './types.ts';
import {
  collectDeductions,
  finalizeScore,
  makeDeduction,
  normalizedWeight,
  weightedMean,
} from './util.ts';

/** 清单字段要求（规格 §5.2：plugin.json / design-system manifest 字段齐）。 */
interface ManifestCheck {
  /** 本类资产是否要求清单（skill = 否）。 */
  applicable: boolean;
  ok: boolean;
  /** 缺失字段（人话，进 S5 理由）。 */
  missing: string[];
}

/** plugin 清单的「条目字段」集合（规格 §2.3：声明了 skills/components/commands 等）。 */
const PLUGIN_ENTRY_KEYS = [
  'skills',
  'components',
  'commands',
  'mcpServers',
  'contributes',
  'hooks',
];
/** design-system 清单的条目字段（规格 §2.4）。 */
const DESIGN_SYSTEM_ENTRY_KEYS = ['tokens', 'components', 'styles', 'files', 'preview'];
/** template 清单的条目字段（规格 §2.5）。 */
const TEMPLATE_ENTRY_KEYS = ['files', 'pages', 'screens', 'entry', 'html'];

/** 字段是否已声明（非空字符串 / 非空数组 / 其他非 null 值）。 */
function hasAnyField(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = record[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

/** 按资产类判定清单 schema 完整度（缺字段清单进理由）。 */
function checkManifest(
  kind: AssetKind,
  manifest: Record<string, unknown> | null,
  packageJson: Record<string, unknown> | null,
): ManifestCheck {
  if (kind === 'skill') return { applicable: false, ok: true, missing: [] };
  const keys =
    kind === 'plugin'
      ? PLUGIN_ENTRY_KEYS
      : kind === 'design-system'
        ? DESIGN_SYSTEM_ENTRY_KEYS
        : TEMPLATE_ENTRY_KEYS;
  const entryLabel = kind === 'plugin' ? 'skills/components/commands' : keys.slice(0, 3).join('/');
  // plugin 可用 package.json 的 contributes/df-plugin 声明兜底（规格 §2.3 探针口径）。
  const source = manifest ?? (kind === 'plugin' ? packageJson : null);
  if (source === null) return { applicable: true, ok: false, missing: ['清单文件'] };
  const missing: string[] = [];
  if (!hasAnyField(source, ['name'])) missing.push('name');
  if (!hasAnyField(source, keys)) missing.push(entryLabel);
  return { applicable: true, ok: missing.length === 0, missing };
}

/** 规范符合度评分。 */
export function scoreSpec(input: DwdAsset): DimensionResult {
  const { text, files } = input;
  // 判定语料：skill 用正文；无正文的类目回退 README（等价于「本资产的说明正文」）。
  const docText = text.body ?? text.readme;

  const frontmatter = text.frontmatter ?? {};
  const hasName = hasAnyField(frontmatter, ['name']);
  const descriptionValue = frontmatter.description;
  const description =
    typeof descriptionValue === 'string' && descriptionValue.trim() !== ''
      ? descriptionValue
      : null;
  const frontmatterValue =
    hasName && description !== null
      ? 'both'
      : hasName
        ? 'name-only'
        : description !== null
          ? 'description-only'
          : 'none';

  const manifestCheck = checkManifest(input.asset.kind, text.manifest, text.packageJson);
  const auxFound = hasAuxDir(files.entries);
  const bodyState =
    docText === null || docText.trim() === ''
      ? 'empty'
      : isPureLinkList(docText)
        ? 'link-list'
        : 'ok';

  const signals: SignalDetail[] = [
    {
      code: 'spec.frontmatter',
      value: frontmatterValue,
      weight: 0.25,
      score: (Number(hasName) + Number(description !== null)) / 2,
    },
    {
      code: 'spec.description-usage',
      value: description !== null && looksLikeWhenToUse(description),
      weight: 0.15,
      score: description !== null && looksLikeWhenToUse(description) ? 1 : 0,
    },
    {
      code: 'spec.workflow',
      value: docText === null ? 'no-text' : hasExplicitWorkflow(docText),
      weight: 0.2,
      score: docText === null ? null : hasExplicitWorkflow(docText) ? 1 : 0,
    },
    {
      code: 'spec.aux-dirs',
      value: auxFound ? true : files.truncated ? 'truncated' : false,
      weight: 0.1,
      score: auxFound ? 1 : files.truncated ? null : 0,
    },
    {
      code: 'spec.manifest',
      value: manifestCheck.applicable ? (manifestCheck.ok ? 'ok' : 'incomplete') : 'n/a',
      weight: 0.2,
      score: manifestCheck.applicable ? (manifestCheck.ok ? 1 : 0) : null,
    },
    {
      code: 'spec.body',
      value: bodyState,
      weight: 0.1,
      score: bodyState === 'ok' ? 1 : 0,
    },
  ];

  const byCode = new Map(signals.map((s) => [s.code, s]));

  /** 按信号当前子分记一笔扣分：delta = 归一化权重 × (1 − 子分)。 */
  const deduct = (signalCode: string, reasonCode: string, reason: string) => {
    const s = byCode.get(signalCode);
    if (s === undefined || s.score === null || s.score >= 1) return null;
    return makeDeduction(reasonCode, reason, normalizedWeight(signals, signalCode) * (1 - s.score));
  };

  const deductions = collectDeductions([
    // frontmatter 两个必有字段平分该信号权重（规格 §2.2「含非空 name 与 description」）。
    hasName
      ? null
      : makeDeduction('S0', REASON_TEXT.S0, normalizedWeight(signals, 'spec.frontmatter') * 0.5),
    description !== null
      ? null
      : makeDeduction('S1', REASON_TEXT.S1, normalizedWeight(signals, 'spec.frontmatter') * 0.5),
    description === null
      ? deduct('spec.description-usage', 'S2', `${REASON_TEXT.S2}（缺 description，无从判定）`)
      : deduct('spec.description-usage', 'S2', REASON_TEXT.S2),
    deduct('spec.workflow', 'S3', REASON_TEXT.S3),
    deduct('spec.aux-dirs', 'S4', REASON_TEXT.S4),
    manifestCheck.applicable && !manifestCheck.ok
      ? deduct('spec.manifest', 'S5', `${REASON_TEXT.S5}（缺 ${manifestCheck.missing.join('、')}）`)
      : null,
    bodyState === 'empty'
      ? deduct('spec.body', 'S6', '正文为空')
      : bodyState === 'link-list'
        ? deduct('spec.body', 'S6', `${REASON_TEXT.S6}（redirect 型）`)
        : null,
  ]);

  return { score: finalizeScore(weightedMean(signals)), signals, deductions };
}
