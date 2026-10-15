/**
 * DTCG token 文件解析（规格 §2.4：形态校验 + 强制反例丢弃）。
 *
 * 三种形态判定（顺序即优先级）：
 *   1. **路径反例**：路径含 `i18n`/`lang`/`langs`/`locale`/`locales` → 直接丢弃
 *      （研究 #4 §3.4 实测：tokens-studio 的 8 个 tokens.json 全是 i18n 词表）；
 *   2. **DTCG 形态**：JSON 内出现 `$value`/`$type` 键 → 数 token、收类型；
 *   3. **CSS 主题形态**：`tokens.css` / `tailwind-v4.css` 的 `--*` 变量或 `@theme` 块。
 * 其余（纯字符串映射 = 词表形态、普通 JSON、非 JSON 文本）一律丢弃并给出诊断码——
 * 宁可少认，不可把词表当设计系统（规格 §2.4 明示「必须实现」）。
 */

export interface TokensIssue {
  code: string;
  detail: string;
}

export interface TokensParseResult {
  isDtcg: boolean;
  isCssTheme: boolean;
  isWordlist: boolean;
  /** 路径反例（i18n/langs/locale）→ 直接丢弃。 */
  discardedByPath: boolean;
  /** DTCG token 数（`$value` 节点数）或 CSS 自定义属性数。 */
  tokenCount: number;
  /** 出现的 `$type` 值（去重，稳定排序）。 */
  types: string[];
  issues: TokensIssue[];
}

const I18N_PATH_RE = /(^|\/)(i18n|lang|langs|locale|locales|translations?)(\/|$)/i;

/** 深度上限：防御异常深嵌套的畸形 JSON。 */
const MAX_DEPTH = 32;

interface DtcgScan {
  tokenCount: number;
  types: Set<string>;
  leafValues: unknown[];
}

function scanDtcg(value: unknown, depth: number, scan: DtcgScan): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) scanDtcg(item, depth + 1, scan);
    return;
  }
  if (value === null || typeof value !== 'object') {
    scan.leafValues.push(value);
    return;
  }
  const record = value as Record<string, unknown>;
  if ('$value' in record) scan.tokenCount += 1;
  const type = record.$type;
  if (typeof type === 'string' && type !== '') scan.types.add(type);
  if (Object.keys(record).length === 0) scan.leafValues.push(undefined);
  for (const item of Object.values(record)) scanDtcg(item, depth + 1, scan);
}

/** 词表形态：所有叶子都是字符串（无 $value/$type 结构）。 */
function isWordlistShape(scan: DtcgScan): boolean {
  return scan.leafValues.length > 0 && scan.leafValues.every((value) => typeof value === 'string');
}

/** 解析 token 文档（按路径与内容双判）。 */
export function parseTokensDocument(path: string, text: string): TokensParseResult {
  const issues: TokensIssue[] = [];
  const discardedByPath = I18N_PATH_RE.test(path);
  const result: TokensParseResult = {
    isDtcg: false,
    isCssTheme: false,
    isWordlist: false,
    discardedByPath,
    tokenCount: 0,
    types: [],
    issues,
  };
  if (discardedByPath) {
    issues.push({
      code: 'i18n-path-discarded',
      detail: '路径含 i18n/langs/locale 的 token 文件直接丢弃（规格 §2.4 反例，研究 #4 §3.4 实测）',
    });
  }

  if (/\.css$/i.test(path)) {
    const properties = new Set<string>();
    for (const match of text.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) {
      if (match[1] !== undefined) properties.add(match[1]);
    }
    const hasThemeBlock = /@theme\b/.test(text);
    result.isCssTheme = properties.size > 0 || hasThemeBlock;
    result.tokenCount = properties.size;
    if (!result.isCssTheme) {
      issues.push({ code: 'unknown-shape', detail: 'CSS 文件未见自定义属性或 @theme 块' });
    }
    return result;
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    issues.push({ code: 'unknown-shape', detail: '既非 JSON 也非 CSS，无法判定 token 形态' });
    return result;
  }

  const scan: DtcgScan = { tokenCount: 0, types: new Set(), leafValues: [] };
  scanDtcg(json, 0, scan);
  result.types = [...scan.types].sort();
  result.tokenCount = scan.tokenCount;
  result.isDtcg = scan.tokenCount > 0 || scan.types.size > 0;
  if (result.isDtcg) return result;

  result.isWordlist = isWordlistShape(scan);
  if (result.isWordlist) {
    issues.push({
      code: 'wordlist-shape-discarded',
      detail: 'JSON 无 $value/$type 且值为纯字符串映射（词表形态）→ 丢弃（规格 §2.4）',
    });
  } else {
    issues.push({ code: 'unknown-shape', detail: 'JSON 既无 DTCG 形态也无词表形态' });
  }
  return result;
}
