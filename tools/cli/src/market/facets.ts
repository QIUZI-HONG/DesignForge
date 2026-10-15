/**
 * 分类面（DWS `asset_facet`，规格《技能市场规格 v1》§1.4/§4.4）的确定性推导。
 *
 * 集成裁决（写进跑通报告）：MK-01…MK-04 均未产出 facet 行（四票范围里无人认领），
 * 本票作为链尾集成票在 CLI 侧落成——**同输入同输出**（纯关键词映射，无时钟/无随机），
 * 口径全部可复核：
 * - `category`：规格 §1.4 九值词表，按 kind 与名称/摘要/标签/话题的关键词命中；
 * - `lane`：`deliver`（导出/交付类信号）> `refine`（设计系统/令牌）> `create`（默认）；
 * - `mode`：由 kind + 探针证据（tokens/DESIGN.md）推导；
 * - `tags`：资产自声明 `tags`（frontmatter）优先 + 仓级 topics 校准，去重截 10；
 * - `scenes`：v1 留空（场景 id 的最终命名是规格 §9.10 未决项，不臆造 id）。
 */

import type { ads } from '@dforge/ingest';
import type { JoinedAsset } from './dwd-map.ts';

/** 分类面形状（ADS 输入契约 `DwsFacets`，与规格 §1.4 同集）。 */
export type DwsFacets = ads.DwsFacets;

/** category 词表（规格 §1.4，与 contracts 的枚举同集）。 */
export const FACET_CATEGORIES = [
  '网站设计',
  '移动端App',
  '设计系统',
  'Web App',
  'PPT设计',
  '交互原型',
  '品牌设计',
  '图标&插画',
  '视觉海报',
  '其他',
] as const;

type CategoryRule = { category: (typeof FACET_CATEGORIES)[number]; pattern: RegExp };

/** 关键词规则（**有序**，首个命中即取；拉丁词加词界，中文直接包含）。 */
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'PPT设计',
    pattern:
      /(?:\b(?:ppt|pptx|slide|slides|deck|decks|presentation|keynote)\b|幻灯片|演示文稿|汇报|路演)/i,
  },
  { category: '移动端App', pattern: /(?:\b(?:mobile|ios|android|app-kit|appkit)\b|移动端)/i },
  {
    category: '图标&插画',
    pattern: /(?:\b(?:icon|icons|iconography|illustration|illustrations)\b|图标|插画)/i,
  },
  { category: '视觉海报', pattern: /(?:\b(?:poster|posters)\b|海报)/i },
  { category: '品牌设计', pattern: /(?:\b(?:brand|branding)\b|品牌)/i },
  {
    category: '交互原型',
    pattern: /(?:\b(?:prototype|prototyping|wireframe|mockup)\b|原型|线框)/i,
  },
  {
    category: 'Web App',
    pattern: /(?:\b(?:dashboard|admin|webapp|web-app|backoffice)\b|后台|看板)/i,
  },
  {
    category: '网站设计',
    pattern: /(?:\b(?:website|web|landing|html|page|site)\b|网页|网站|落地页)/i,
  },
];

/** 交付类信号（lane=deliver）。 */
const DELIVER_PATTERN = /(?:\b(?:export|exports|exporter|deliver|print)\b|导出|交付|打印)/i;
/** 改造类信号（lane=refine，非设计系统也适用）。 */
const REFINE_PATTERN = /(?:\b(?:theme|themeing|refactor|tokens?)\b|主题|改造|令牌|变量)/i;

/** 关键词推导 category（无命中 → 其他；design-system 类目直接归 设计系统）。 */
export function deriveCategory(kind: string, haystack: string): (typeof FACET_CATEGORIES)[number] {
  if (kind === 'design-system') return '设计系统';
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return '其他';
}

/** lane 推导（deliver > refine > create）。 */
export function deriveLane(kind: string, haystack: string): 'create' | 'refine' | 'deliver' {
  if (DELIVER_PATTERN.test(haystack)) return 'deliver';
  if (kind === 'design-system' || REFINE_PATTERN.test(haystack)) return 'refine';
  return 'create';
}

/** mode 推导（kind + 探针证据）。 */
export function deriveMode(joined: JoinedAsset): DwsFacets['mode'] {
  const { asset } = joined;
  const pieces = new Set((asset.probes ?? []).map((probe) => probe.piece));
  switch (asset.kind) {
    case 'design-system':
      return pieces.has('design-md') || pieces.has('manifest-json') ? 'design-system' : 'tokens';
    case 'template':
      return pieces.has('preview-dir') || pieces.has('examples-dir') ? 'prototype' : 'template';
    case 'plugin':
      return 'components';
    case 'skill':
      return pieces.has('components-manifest') ? 'components' : 'utility';
    default:
      return 'other';
  }
}

/** 标签规范化（小写、空白转连字符、去噪）。 */
function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff._-]/g, '');
  if (tag.length < 2 || tag.length > 40) return null;
  return tag;
}

/** 分类面推导（纯函数，同输入同输出）。 */
export function deriveFacets(joined: JoinedAsset): DwsFacets {
  const { asset, repo } = joined;
  const rawTexts = asset as unknown as Record<string, unknown>;
  const frontmatter =
    rawTexts.text_frontmatter !== null && typeof rawTexts.text_frontmatter === 'object'
      ? (rawTexts.text_frontmatter as Record<string, unknown>)
      : null;
  const declaredTags = Array.isArray(frontmatter?.tags)
    ? (frontmatter.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : [];
  const topics = repo?.topics ?? [];
  const haystack = `${asset.name} ${asset.root} ${asset.description ?? ''} ${topics.join(' ')} ${declaredTags.join(' ')}`;

  const tags: string[] = [];
  for (const raw of [...declaredTags, ...topics]) {
    const tag = normalizeTag(raw);
    if (tag === null || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= 10) break;
  }

  return {
    category: deriveCategory(asset.kind, haystack),
    lane: deriveLane(asset.kind, haystack),
    mode: deriveMode(joined),
    tags,
    // 未决（规格 §9.10：9 个场景 id 的最终命名待与术语对照表校准）——不臆造 id，留空数组。
    scenes: [],
  };
}
