/**
 * 清单 JSON 解析（规格 §2.3 plugin / §2.4 design-system / §2.5 template）。
 *
 * 为什么按「文件名 + 内容身份字段」双判：`manifest.json` 是设计系统与模板的共用名
 * （规格 §2.4/§2.5 明示由内容校验分流），只按文件名会把模板认成设计系统；
 * `tokens.json`（i18n 词表）与普通 `package.json` 必须落到 unknown（反例防误报）。
 */

export type ManifestKind =
  | 'plugin'
  | 'marketplace'
  | 'design-system'
  | 'template'
  | 'package-json'
  | 'unknown';

export interface ManifestEntryCount {
  field: string;
  count: number;
}

export interface ManifestIssue {
  code: string;
  detail: string;
}

export interface ManifestParseResult {
  ok: boolean;
  kind: ManifestKind;
  json: unknown | null;
  name: string | null;
  slug: string | null;
  description: string | null;
  version: string | null;
  license: string | null;
  entries: ManifestEntryCount[];
  declaredFields: string[];
  issues: ManifestIssue[];
}

/** 各类清单的条目字段（数组按长度计；对象按成员数计）。 */
const ENTRY_FIELDS: Record<ManifestKind, string[]> = {
  plugin: ['skills', 'components', 'commands', 'agents', 'hooks', 'mcpServers'],
  marketplace: ['plugins', 'items', 'entries'],
  'design-system': ['components', 'themes', 'presets', 'exports', 'foundations'],
  template: ['items', 'pages', 'slides', 'templates', 'files', 'examples', 'preview', 'sections'],
  'package-json': [],
  unknown: [],
};

/** 身份字段：证明「这是该类资产」的内容证据（规格 §2.4 硬门槛 / §2.5 模板身份）。 */
const IDENTITY_FIELDS: Record<'design-system' | 'template' | 'plugin', string[]> = {
  'design-system': ['tokens', 'components', 'themes', 'presets', 'foundations', 'exports'],
  template: [
    'slug',
    'tagline',
    'mood',
    'tone',
    'occasion',
    'formality',
    'density',
    'palette',
    'sections',
  ],
  plugin: ['contributes', 'df-plugin', 'dfPlugin', 'skills', 'commands', 'agents'],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** 统计条目字段：数组计长度，对象计成员数（排除描述性元键）。 */
function countEntries(json: Record<string, unknown>, kind: ManifestKind): ManifestEntryCount[] {
  const metaKeys = new Set(['description', '$description', 'note', 'notes', 'comment', 'title']);
  const out: ManifestEntryCount[] = [];
  for (const field of ENTRY_FIELDS[kind]) {
    const value = json[field];
    if (Array.isArray(value)) out.push({ field, count: value.length });
    else if (isObject(value)) {
      const count = Object.keys(value).filter((key) => !metaKeys.has(key)).length;
      out.push({ field, count });
    }
  }
  return out;
}

/** `package.json` 的 `contributes` 容器：其子字段才是条目（如 `contributes.commands`）。 */
function contributesEntries(json: Record<string, unknown>): ManifestEntryCount[] {
  const contributes = json.contributes;
  if (!isObject(contributes)) return [];
  const out: ManifestEntryCount[] = [];
  for (const [field, value] of Object.entries(contributes)) {
    if (Array.isArray(value)) out.push({ field, count: value.length });
    else if (isObject(value)) out.push({ field, count: Object.keys(value).length });
  }
  return out.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}

/** 模板的 `palette`（对象成员数）计为条目证据，与模板身份字段并列。 */
function paletteEntry(json: Record<string, unknown>): ManifestEntryCount | null {
  const palette = json.palette;
  if (!isObject(palette)) return null;
  const count = Object.keys(palette).filter(
    (key) => !['description', '$description', 'note', 'notes'].includes(key),
  ).length;
  return count > 0 ? { field: 'palette', count } : null;
}

/** 解析清单 JSON 并按文件名 + 身份字段分类。 */
export function parseManifest(text: string, hint: { path: string }): ManifestParseResult {
  const base = hint.path.split('/').pop() ?? hint.path;
  const empty: ManifestParseResult = {
    ok: false,
    kind: 'unknown',
    json: null,
    name: null,
    slug: null,
    description: null,
    version: null,
    license: null,
    entries: [],
    declaredFields: [],
    issues: [],
  };

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ...empty,
      issues: [{ code: 'json-parse', detail: `清单 JSON 解析失败：${(error as Error).message}` }],
    };
  }
  if (!isObject(json)) {
    return {
      ...empty,
      issues: [{ code: 'json-parse', detail: '清单 JSON 的顶层不是对象' }],
    };
  }

  const declaredFields = Object.keys(json).sort();
  const hasAny = (fields: string[]) => fields.some((field) => field in json);
  let kind: ManifestKind = 'unknown';
  let withEntryCounting = true;

  if (base === 'plugin.json') kind = 'plugin';
  else if (base === 'marketplace.json') kind = 'marketplace';
  else if (base === 'template.json') {
    kind = hasAny(IDENTITY_FIELDS.template) ? 'template' : 'unknown';
  } else if (base === 'package.json') {
    kind = hasAny(['contributes', 'df-plugin', 'dfPlugin']) ? 'plugin' : 'unknown';
    withEntryCounting = kind === 'plugin';
  } else if (base === 'manifest.json' || base === 'design-system.json') {
    kind = hasAny(IDENTITY_FIELDS['design-system']) ? 'design-system' : 'unknown';
  } else if (base === 'components.manifest.json') {
    kind = 'design-system';
  }

  const issues: ManifestIssue[] = [];
  if (kind === 'unknown') {
    const knownManifestName =
      base === 'template.json' ||
      base === 'manifest.json' ||
      base === 'design-system.json' ||
      base === 'package.json';
    if (knownManifestName) {
      issues.push({
        code: 'missing-entries',
        detail: '清单无可识别条目字段，也无资产身份字段（不硬凑分类）',
      });
    } else {
      issues.push({
        code: 'not-a-manifest',
        detail: `${base} 不是清单文件名（词表/数据文件不参与清单分类）`,
      });
    }
  }

  const entries = withEntryCounting ? countEntries(json, kind) : [];
  if (kind === 'plugin' && base === 'package.json') {
    entries.push(...contributesEntries(json));
  }
  if (kind === 'template') {
    const palette = paletteEntry(json);
    if (palette !== null) entries.push(palette);
    if (entries.every((entry) => entry.count === 0)) {
      issues.push({ code: 'missing-entries', detail: '模板清单条目为 0（不认定）' });
    }
  }
  if (kind === 'design-system') {
    const anyEntry = entries.some((entry) => entry.count > 0);
    const tokenEntry = typeof json.tokens === 'string' && json.tokens.trim() !== '';
    if (!anyEntry && !tokenEntry) {
      issues.push({ code: 'missing-entries', detail: '设计系统清单无 token 入口也无组件条目' });
    }
  }

  const metadata = isObject(json.metadata) ? json.metadata : null;
  return {
    ok: true,
    kind,
    json,
    name: asString(json.name),
    slug: asString(json.slug),
    description: asString(json.description) ?? (metadata ? asString(metadata.description) : null),
    version: asString(json.version),
    license: asString(json.license),
    entries,
    declaredFields,
    issues,
  };
}
