/**
 * SKILL.md frontmatter 解析（规格 §2.2 内容校验：frontmatter 可解析 + name/description 非空 + 正文非纯清单）。
 *
 * 为什么自写而不引 YAML 库：采集端「零重依赖」纪律 + 只需要 YAML 的描述性子集
 * （标量 / 折叠与字面块 / 行内与块式列表 / 一层嵌套）。**不支持的构造不让猜测**：
 * 记 `extraKeys`（仅键名）与诊断码，交由上层如实降级，而不是臆造字段值。
 */

export interface SkillFrontmatter {
  name: string | null;
  description: string | null;
  version: string | null;
  license: string | null;
  tags: string[];
  triggers: string[];
  allowedTools: string[];
  /** 出现但未被本解析器展开的顶层键（保持可审计）。 */
  extraKeys: string[];
}

export interface FrontmatterIssue {
  code: string;
  detail: string;
}

export interface FrontmatterParseResult {
  hasBlock: boolean;
  ok: boolean;
  data: SkillFrontmatter;
  issues: FrontmatterIssue[];
  /** frontmatter 之后的正文（Markdown）。 */
  body: string;
  bodyStats: {
    bytes: number;
    nonEmptyLines: number;
    /** 非空行中「几乎只有链接」的占比（判定 redirect 型清单，规格 §2.2）。 */
    linkRatio: number;
  };
}

const EMPTY: SkillFrontmatter = {
  name: null,
  description: null,
  version: null,
  license: null,
  tags: [],
  triggers: [],
  allowedTools: [],
  extraKeys: [],
};

/** 去 BOM、归一换行为 LF。 */
function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** 去掉未加引号标量的行尾注释。 */
function stripTrailingComment(value: string): string {
  const match = value.match(/^(.*?)\s+#\s.*$/);
  return match?.[1] !== undefined ? match[1].trim() : value;
}

/** 去引号（单/双），支持最小转义。 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** 行内列表 `[a, b]`（不做嵌套解析）。 */
function parseInlineList(raw: string): string[] | null {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner
    .split(',')
    .map((item) => unquote(stripTrailingComment(item.trim())))
    .filter((item) => item !== '');
}

/** 正文统计（bytes / 非空行 / 链接行占比）。 */
function bodyStats(body: string): FrontmatterParseResult['bodyStats'] {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  const linkLines = lines.filter((line) => {
    const trimmed = line.replace(/^[-*+]\s+/, '').trim();
    return /^\[[^\]]*\]\([^)]+\)/.test(trimmed) || /^https?:\/\/\S+$/.test(trimmed);
  });
  return {
    bytes: Buffer.byteLength(body, 'utf8'),
    nonEmptyLines: lines.length,
    linkRatio: lines.length === 0 ? 0 : Math.round((linkLines.length / lines.length) * 100) / 100,
  };
}

/**
 * 解析 SKILL.md：返回 frontmatter 字段 + 正文 + 统计 + 诊断。
 * 无 frontmatter 不是异常（规格 §2.2：7/537 无 frontmatter → 标记不合规样本），故 `ok=false` 但可入库。
 */
export function parseFrontmatter(rawText: string): FrontmatterParseResult {
  const text = normalize(rawText);
  const issues: FrontmatterIssue[] = [];
  const data: SkillFrontmatter = {
    ...EMPTY,
    tags: [],
    triggers: [],
    allowedTools: [],
    extraKeys: [],
  };

  if (!text.startsWith('---\n') && text !== '---') {
    return {
      hasBlock: false,
      ok: false,
      data,
      issues: [{ code: 'no-frontmatter', detail: '文件不以 --- 起始（无 frontmatter 块）' }],
      body: text,
      bodyStats: bodyStats(text),
    };
  }

  const lines = text.split('\n');
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    issues.push({ code: 'unterminated-block', detail: 'frontmatter 块未闭合（无收尾 ---）' });
    return {
      hasBlock: true,
      ok: false,
      data,
      issues,
      body: text,
      bodyStats: bodyStats(text),
    };
  }

  const block = lines.slice(1, closing);
  const body = lines.slice(closing + 1).join('\n');
  if (block.every((line) => line.trim() === '')) {
    issues.push({ code: 'empty-frontmatter', detail: 'frontmatter 块为空' });
    return { hasBlock: true, ok: true, data, issues, body, bodyStats: bodyStats(body) };
  }

  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const nested = new Set<string>();

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index] ?? '';
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent > 0) {
      // 嵌套块/续行由所属键处理；到此处说明是孤立的缩进行（不支持的结构）
      if (!content.startsWith('- ')) {
        issues.push({
          code: 'unsupported-line',
          detail: `第 ${index + 2} 行缩进结构未被解析：${content.slice(0, 40)}`,
        });
      }
      continue;
    }
    const sep = content.indexOf(':');
    if (sep < 0) {
      issues.push({
        code: 'unsupported-line',
        detail: `第 ${index + 2} 行不是 key: value 形式：${content.slice(0, 40)}`,
      });
      continue;
    }
    const key = content.slice(0, sep).trim();
    const rawValue = content.slice(sep + 1).trim();

    // 块式标量：`>`（折叠）/ `|`（字面）
    if (rawValue === '>' || rawValue === '|' || /^[>|][-+]?$/.test(rawValue)) {
      const collected: string[] = [];
      let cursor = index + 1;
      while (cursor < block.length) {
        const next = block[cursor] ?? '';
        if (next.trim() === '') {
          collected.push('');
          cursor += 1;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent === 0) break;
        collected.push(next.trim());
        cursor += 1;
      }
      index = cursor - 1;
      while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
      const joined = rawValue.startsWith('|') ? collected.join('\n') : collected.join(' ');
      scalars.set(key, joined);
      continue;
    }

    // 块式列表 / 一层嵌套
    if (rawValue === '') {
      const items: string[] = [];
      let sawNestedMap = false;
      let cursor = index + 1;
      while (cursor < block.length) {
        const next = block[cursor] ?? '';
        if (next.trim() === '') {
          cursor += 1;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent === 0) break;
        const item = next.trim();
        if (item.startsWith('- ')) items.push(unquote(stripTrailingComment(item.slice(2).trim())));
        else sawNestedMap = true;
        cursor += 1;
      }
      index = cursor - 1;
      if (items.length > 0) lists.set(key, items);
      if (sawNestedMap) nested.add(key);
      if (items.length === 0 && !sawNestedMap) scalars.set(key, '');
      continue;
    }

    const inline = parseInlineList(rawValue);
    if (inline !== null) lists.set(key, inline);
    else scalars.set(key, unquote(stripTrailingComment(rawValue)));
  }

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = scalars.get(key);
      if (value !== undefined && value !== '') return value;
      const list = lists.get(key);
      if (list !== undefined && list.length > 0) return list.join(', ');
    }
    return null;
  };

  data.name = pick('name');
  data.description = pick('description');
  data.version = pick('version');
  data.license = pick('license');
  data.tags = lists.get('tags') ?? [];
  data.triggers = lists.get('triggers') ?? [];
  data.allowedTools = lists.get('allowed-tools') ?? lists.get('allowedTools') ?? [];
  const consumed = new Set([
    'name',
    'description',
    'version',
    'license',
    'tags',
    'triggers',
    'allowed-tools',
    'allowedTools',
  ]);
  data.extraKeys = [...new Set([...scalars.keys(), ...lists.keys(), ...nested])]
    .filter((key) => !consumed.has(key))
    .sort();

  if (data.name === null || data.description === null) {
    issues.push({
      code: 'missing-required-field',
      detail: `frontmatter 缺 ${data.name === null ? 'name' : ''}${data.name === null && data.description === null ? ' 与 ' : ''}${data.description === null ? 'description' : ''}（规格 §2.2 必备）`,
    });
  }

  return {
    hasBlock: true,
    ok: !issues.some((issue) => issue.code !== 'empty-frontmatter'),
    data,
    issues,
    body,
    bodyStats: bodyStats(body),
  };
}
