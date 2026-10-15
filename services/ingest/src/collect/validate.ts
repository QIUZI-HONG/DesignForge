/**
 * 内容校验（规格 §2：结构探针之后的第二级，防纯文件名误报）。
 *
 * 覆盖四类资产的「描述性文本」校验：
 *  - Skill：YAML frontmatter（name/description）+ 正文非空非纯链接清单；
 *  - tokens：DTCG 形态（$value/$type）或 CSS 变量/主题块；i18n 词表与旧格式直接否掉；
 *  - Plugin：清单 JSON 可解析且含 name，且在条目字段或同目录 Skill 佐证下成立；
 *  - Design System：设计系统 manifest 分流（与 Figma 插件 manifest 区分）+ 品牌复刻信号；
 *  - Template：显式条目清单或身份型清单（后者需同根渲染产物佐证，由识别层合并）。
 *
 * 原则：**只读描述性文本**（frontmatter/清单/少量正文），不下二进制、不克隆仓库（规格 §8.1）。
 */

/** 解析结果（最小 YAML 子集：够用即止，不求全量 YAML 兼容）。 */
export interface FrontmatterResult {
  parsed: boolean;
  data: Record<string, unknown>;
  body: string;
  bodyBytes: number;
  reasons: string[];
}

const FM_KEY_RE = /^([A-Za-z0-9_$.-]+)\s*:\s*(.*)$/;

/** 去掉 YAML 标量的引号/注释，识别布尔与 null。 */
function scalar(value: string): unknown {
  let s = value.trim();
  if (s === '') return '';
  const quoted = s.startsWith('"') || s.startsWith("'");
  if (!quoted) {
    // 只在「空格 + #」处截注释，避免破坏 `#0F1B3D` 这类色值。
    const comment = /\s#/.exec(s);
    if (comment) s = s.slice(0, comment.index).trim();
  }
  if (s.length >= 2) {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  return s;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * 最小 YAML 子集解析：
 *  - 顶层 `key: scalar`；引号、注释、布尔/null；
 *  - `key:` 后接缩进块 → 对象（一层）或列表（`- item`）；
 *  - `key: |` / `key: >` 块标量（保留/折叠换行）。
 * 覆盖 SKILL.md frontmatter 的真实形态（open-design 种子协议字段实测）。
 */
function parseYamlSubset(lines: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }
    if (indentOf(raw) !== 0) {
      i += 1;
      continue;
    }
    const match = FM_KEY_RE.exec(trimmed);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1] ?? '';
    const rest = (match[2] ?? '').trim();

    if (rest !== '' && rest !== '|' && rest !== '>' && rest !== '|-' && rest !== '>-') {
      root[key] = scalar(rest);
      i += 1;
      continue;
    }

    // 收集后续更深缩进行（含空行）。
    const collected: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j] ?? '';
      if (line.trim() === '') {
        collected.push('');
        j += 1;
        continue;
      }
      if (indentOf(line) <= indentOf(raw)) break;
      collected.push(line);
      j += 1;
    }

    if (rest !== '') {
      // 块标量
      const nonBlank = collected.filter((l) => l.trim() !== '');
      const minIndent = nonBlank.length === 0 ? 0 : Math.min(...nonBlank.map(indentOf));
      const texts = collected.map((l) => (l.trim() === '' ? '' : l.slice(minIndent)));
      const joined = texts.join('\n').trim();
      root[key] = rest.startsWith('>') ? joined.replace(/\s*\n\s*/g, ' ').trim() : joined;
    } else {
      const items = collected.filter((l) => indentOf(l) >= 0 && l.trim() !== '');
      const isList = items.length > 0 && items.every((l) => /^\s*-\s+/.test(l));
      if (isList) {
        root[key] = items.map((l) => scalar(l.trim().replace(/^-\s+/, '')));
      } else {
        const nested: Record<string, unknown> = {};
        for (const l of items) {
          const nm = FM_KEY_RE.exec(l.trim());
          if (nm) nested[nm[1] ?? ''] = scalar(nm[2] ?? '');
        }
        root[key] = nested;
      }
    }
    i = j;
  }
  return root;
}

/** 解析 YAML frontmatter（`---` 起止）；未闭合/缺失时 `parsed=false`，正文为全文。 */
export function parseFrontmatter(text: string): FrontmatterResult {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') {
    return {
      parsed: false,
      data: {},
      body: normalized,
      bodyBytes: Buffer.byteLength(normalized, 'utf8'),
      reasons: ['无 frontmatter 起始标记'],
    };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      parsed: false,
      data: {},
      body: normalized,
      bodyBytes: Buffer.byteLength(normalized, 'utf8'),
      reasons: ['frontmatter 未闭合'],
    };
  }
  const body = lines.slice(end + 1).join('\n');
  return {
    parsed: true,
    data: parseYamlSubset(lines.slice(1, end)),
    body,
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    reasons: [],
  };
}

/** 纯链接清单（redirect 型）：≥80% 非空行为纯 markdown 链接/链接列表项。 */
export function isPureLinkList(body: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return false;
  const linkLine = /^(?:[-*+]\s+)?\[[^\]]+\]\([^)]+\)$/;
  const linked = lines.filter((l) => linkLine.test(l)).length;
  return linked / lines.length >= 0.8;
}

/** 规格 §2.2：无 frontmatter 且正文 <144 字节（种子实测最小值）→ suspect。 */
const SUSPECT_BODY_BYTES = 144;

export interface SkillDocVerdict {
  /** ok 全过；non-compliant 可入库但不计规范分；suspect/rejected 不进资产表（进 rejected 记录）。 */
  compliance: 'ok' | 'non-compliant' | 'suspect' | 'rejected';
  name: string | null;
  description: string | null;
  declaredLicense: string | null;
  bodyBytes: number;
  reasons: string[];
}

/** Skill 内容校验（规格 §2.2）。 */
export function validateSkillDoc(text: string): SkillDocVerdict {
  const fm = parseFrontmatter(text);
  const name = typeof fm.data.name === 'string' && fm.data.name.trim() !== '' ? fm.data.name : null;
  const description =
    typeof fm.data.description === 'string' && fm.data.description.trim() !== ''
      ? fm.data.description
      : null;
  const declaredLicense =
    typeof fm.data.license === 'string' && fm.data.license.trim() !== '' ? fm.data.license : null;

  const reasons: string[] = [...fm.reasons];
  const base = {
    name,
    description,
    declaredLicense,
    bodyBytes: fm.bodyBytes,
  };

  if (fm.body.trim() === '') {
    return { ...base, compliance: 'rejected', reasons: [...reasons, '正文为空'] };
  }
  if (isPureLinkList(fm.body)) {
    return {
      ...base,
      compliance: 'rejected',
      reasons: [...reasons, '正文为纯链接清单（redirect 型，规格 §2.2 ③）'],
    };
  }
  if (!fm.parsed) {
    if (fm.bodyBytes < SUSPECT_BODY_BYTES) {
      return {
        ...base,
        compliance: 'suspect',
        reasons: [...reasons, `无 frontmatter 且正文 ${fm.bodyBytes} 字节 < 144（suspect）`],
      };
    }
    return {
      ...base,
      compliance: 'non-compliant',
      reasons: [...reasons, '无 frontmatter：不合规样本（可入库，不计规范分）'],
    };
  }
  if (name === null || description === null) {
    return {
      ...base,
      compliance: 'non-compliant',
      reasons: [...reasons, `frontmatter 缺 ${name === null ? 'name' : 'description'}`],
    };
  }
  return { ...base, compliance: 'ok', reasons };
}

/** tokens 文件路径是否 i18n 词表（规格 §2.4 反例：i18n/langs/locale 直接丢弃）。 */
const I18N_SEGMENTS = ['i18n', 'langs', 'locale'];

export function isI18nPath(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  return segments.some((seg) => I18N_SEGMENTS.includes(seg));
}

export interface TokensJsonVerdict {
  shape: 'dtcg' | 'wordlist' | 'legacy-studio' | 'unknown-json' | 'invalid';
  ok: boolean;
  reasons: string[];
}

/** 递归查找 DTCG 键（`$value`/`$type`）。 */
function hasDtcgKeys(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasDtcgKeys(v, depth + 1));
  const record = value as Record<string, unknown>;
  if ('$value' in record || '$type' in record) return true;
  return Object.values(record).some((v) => hasDtcgKeys(v, depth + 1));
}

/** 递归查找非 $ 前缀的 value/type 组合（Tokens Studio 旧格式）。 */
function hasLegacyKeys(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasLegacyKeys(v, depth + 1));
  const record = value as Record<string, unknown>;
  if ('value' in record && ('type' in record || 'description' in record)) return true;
  return Object.values(record).some((v) => hasLegacyKeys(v, depth + 1));
}

/** 纯字符串映射（i18n 词表形态）。 */
function isFlatStringMap(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const values = Object.values(value as Record<string, unknown>);
  return values.length > 0 && values.every((v) => typeof v === 'string');
}

/** tokens JSON 形态判定：只认 DTCG（$value/$type）。 */
export function inspectTokensJson(text: string): TokensJsonVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { shape: 'invalid', ok: false, reasons: ['JSON 不可解析'] };
  }
  if (hasDtcgKeys(parsed)) {
    return { shape: 'dtcg', ok: true, reasons: ['检出 DTCG 形态（$value/$type）'] };
  }
  if (isFlatStringMap(parsed)) {
    return { shape: 'wordlist', ok: false, reasons: ['纯字符串映射（词表形态），非令牌'] };
  }
  if (hasLegacyKeys(parsed)) {
    return {
      shape: 'legacy-studio',
      ok: false,
      reasons: ['Tokens Studio 旧格式（value/type 无 $ 前缀），不按 DTCG 通过'],
    };
  }
  return { shape: 'unknown-json', ok: false, reasons: ['未检出令牌形态'] };
}

export interface TokensCssVerdict {
  ok: boolean;
  reasons: string[];
}

/** tokens.css / tailwind-v4.css：需见 CSS 变量声明或 `@theme` 主题块（规格 §2.4）。 */
export function inspectTokensCss(text: string): TokensCssVerdict {
  const hasCustomProperty = /--[A-Za-z][\w-]*\s*:/.test(text);
  const hasThemeBlock = /@theme\b/.test(text);
  if (hasCustomProperty || hasThemeBlock) {
    return {
      ok: true,
      reasons: [hasThemeBlock ? '检出 @theme 主题块' : '检出 CSS 变量声明'],
    };
  }
  return { ok: false, reasons: ['未见 CSS 变量或主题块'] };
}

export interface PluginManifestVerdict {
  ok: boolean;
  name: string | null;
  declares: string[];
  reasons: string[];
}

const PLUGIN_ENTRY_KEYS = ['skills', 'components', 'commands', 'agents'];
const PLUGIN_DECLARATION_KEYS = ['contributes', 'df-plugin', 'dfPlugin'];

/** 插件清单校验（规格 §2.3）：JSON 可解析、含 name；条目字段或声明字段至少其一。 */
export function validatePluginManifest(text: string, path: string): PluginManifestVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, name: null, declares: [], reasons: [`${path}：JSON 不可解析`] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, name: null, declares: [], reasons: [`${path}：清单不是对象`] };
  }
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name : null;
  const declares = [
    ...PLUGIN_ENTRY_KEYS.filter((key) => key in record),
    ...PLUGIN_DECLARATION_KEYS.filter((key) => key in record),
  ];
  if (name === null) {
    return { ok: false, name: null, declares, reasons: [`${path}：缺 name`] };
  }
  if (declares.length === 0) {
    return {
      ok: false,
      name,
      declares,
      reasons: [`${path}：未声明 skills/components/commands 等条目字段`],
    };
  }
  return { ok: true, name, declares, reasons: [] };
}

export interface MarketplaceVerdict {
  ok: boolean;
  entries: number;
  selfReferencing: number;
  reasons: string[];
}

/** 市场清单校验（规格 §2.3）：条目 `source` 指向本仓才算本仓的插件认定。 */
export function validateMarketplaceManifest(
  text: string,
  repoFullName: string,
): MarketplaceVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      entries: 0,
      selfReferencing: 0,
      reasons: ['marketplace.json：JSON 不可解析'],
    };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, entries: 0, selfReferencing: 0, reasons: ['marketplace.json：非对象'] };
  }
  const plugins = (parsed as Record<string, unknown>).plugins;
  if (!Array.isArray(plugins)) {
    return {
      ok: false,
      entries: 0,
      selfReferencing: 0,
      reasons: ['marketplace.json：无 plugins 数组'],
    };
  }
  let selfReferencing = 0;
  for (const entry of plugins) {
    if (entry === null || typeof entry !== 'object') continue;
    const source = (entry as Record<string, unknown>).source;
    const sourceText = typeof source === 'string' ? source : '';
    if (sourceText.startsWith('./') || sourceText === '.' || sourceText === '') {
      selfReferencing += 1;
      continue;
    }
    if (sourceText.startsWith('github:')) {
      const rest = sourceText.slice('github:'.length);
      const repoPart = rest.split('@')[0]?.split('/').slice(0, 2).join('/') ?? '';
      if (repoPart.toLowerCase() === repoFullName.toLowerCase()) selfReferencing += 1;
    }
  }
  return {
    ok: selfReferencing > 0,
    entries: plugins.length,
    selfReferencing,
    reasons:
      selfReferencing > 0 ? [] : [`marketplace.json：${plugins.length} 条条目无 source 指向本仓`],
  };
}

export interface DesignSystemManifestVerdict {
  ok: boolean;
  name: string | null;
  /** `source.type`（如 `bundled` → 品牌复刻风险信号，规格 §2.4）。 */
  sourceType: string | null;
  reasons: string[];
}

/**
 * `manifest.json` 是否为**设计系统清单**（规格 §2.4）。
 * 判据：含 `source`/`files`/`importMode`/`schemaVersion` 一类设计系统工程字段；
 * Figma 插件 manifest（api/main/editorType/networkAccess）不算。
 */
export function validateDesignSystemManifest(text: string): DesignSystemManifestVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, name: null, sourceType: null, reasons: ['manifest.json：JSON 不可解析'] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, name: null, sourceType: null, reasons: ['manifest.json：非对象'] };
  }
  const record = parsed as Record<string, unknown>;
  const hasDsFields =
    typeof record.source === 'object' ||
    typeof record.files === 'object' ||
    'importMode' in record ||
    typeof record.schemaVersion === 'string';
  if (!hasDsFields) {
    return {
      ok: false,
      name: null,
      sourceType: null,
      reasons: ['manifest.json：无设计系统工程字段（source/files/importMode/schemaVersion）'],
    };
  }
  const name = typeof record.name === 'string' ? record.name : null;
  const source = record.source;
  const sourceType =
    source !== null &&
    typeof source === 'object' &&
    typeof (source as Record<string, unknown>).type === 'string'
      ? ((source as Record<string, unknown>).type as string)
      : null;
  return { ok: true, name, sourceType, reasons: [] };
}

export interface TemplateManifestVerdict {
  ok: boolean;
  /** `entries` 显式列出条目文件；`identity` 身份型清单（需同根渲染产物佐证）。 */
  kind: 'entries' | 'identity' | 'none';
  name: string | null;
  entryPaths: string[];
  reasons: string[];
}

const TEMPLATE_ENTRY_KEYS = ['templates', 'entries', 'files', 'items', 'slides'];
const TEMPLATE_IDENTITY_KEYS = ['slug', 'tagline', 'palette', 'typography', 'mood', 'occasion'];

/** 模板清单校验（规格 §2.5）。 */
export function validateTemplateManifest(text: string): TemplateManifestVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      kind: 'none',
      name: null,
      entryPaths: [],
      reasons: ['template.json：JSON 不可解析'],
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      kind: 'none',
      name: null,
      entryPaths: [],
      reasons: ['template.json：非对象'],
    };
  }
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : null;

  for (const key of TEMPLATE_ENTRY_KEYS) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) {
      const entryPaths = value
        .map((v) => (typeof v === 'string' ? v : null))
        .filter((v): v is string => v !== null);
      if (entryPaths.length > 0) {
        return { ok: true, kind: 'entries', name, entryPaths, reasons: [] };
      }
    }
  }

  const identityHits = TEMPLATE_IDENTITY_KEYS.filter((key) => key in record);
  if (identityHits.length >= 2) {
    return {
      ok: true,
      kind: 'identity',
      name,
      entryPaths: [],
      reasons: [`身份型模板清单（${identityHits.join('/')}）`],
    };
  }
  return {
    ok: false,
    kind: 'none',
    name,
    entryPaths: [],
    reasons: ['template.json：既无条目字段也无模板身份字段'],
  };
}
