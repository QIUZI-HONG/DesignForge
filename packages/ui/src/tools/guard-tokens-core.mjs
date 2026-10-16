/**
 * guard-tokens 核心（禁裸值守卫的纯逻辑，CLI 与自测共用）。
 *
 * 为什么核心用 `.mjs` 而不是 TS：`scripts/guard-tokens.mjs` 是 **node 直接跑**的根脚本
 * （不参与任何包的构建），因此核心不能是 TS 源码；放在本包 `src/tools/` 下是为了
 * 让 vitest 能就近做自测（见 `guard-tokens-core.test.ts`），JSDoc 提供类型。
 *
 * 规则（扫描 `apps/web/src` 与 `packages/ui/src`）：
 * - R1 颜色裸值：`#hex` / `rgb(` / `rgba(` / `hsl(` / `hsla(` —— 一律走 `--dfg-color-*`；
 * - R2 长度裸值：`12px` / `1.5rem` / `2em`（`0` 与 `0px` 视为合法：零值无需单位）；
 * - R3 样式对象裸数字：`marginTop: 8` 这类**间距族属性**赋裸数字（应为 `var(--dfg-space-*)`）。
 *
 * 白名单（文件级 + 行内级）：
 * - 令牌定义文件（tokens.ts / tokens.css）——颜色与间距的唯一定义处；
 * - 测试文件——断言期望值本就需要写出具体色值/尺寸，且不进产物；
 * - 守卫自测夹具——需要构造违规样例；
 * - 行内豁免：注释里写 `guard-tokens:allow <理由>`（理由必填），仅豁免本行。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 扫描的扩展名。 */
export const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css'];

/** 默认扫描根（相对仓库根）。 */
export const DEFAULT_ROOTS = ['apps/web/src', 'packages/ui/src'];

/** 跳过的目录名。 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'out', 'coverage']);

/** 文件级白名单（路径一律用 `/` 分隔的相对仓库根路径）。 */
export const ALLOWLIST = [
  {
    pattern: /^packages\/ui\/src\/tokens\.ts$/,
    reason: '令牌定义文件：颜色/间距/圆角的唯一真源',
  },
  {
    pattern: /^packages\/ui\/src\/tokens\.css$/,
    reason: '令牌定义文件：CSS 变量落盘（与 tokens.ts 逐项一致，由 tokens.test.ts 断言）',
  },
  {
    pattern: /\.test\.[cm]?[jt]sx?$/,
    reason: '测试文件：断言规格硬值需要写出具体色值/尺寸，且不进产物',
  },
  {
    pattern: /^packages\/ui\/src\/tools\/guard-tokens/,
    reason: '守卫自测夹具与实现：需要构造违规样例',
  },
];

/** 行内豁免标记（同行的注释里，或紧邻上一行）。 */
export const INLINE_ALLOW_MARKER = 'guard-tokens:allow';

/** 规则表（供文档、CLI 输出与测试列举）。 */
export const RULES = [
  {
    id: 'R1',
    title: '颜色裸值',
    hint: '颜色一律取 --dfg-color-* 令牌（或 flatten 后的 tokens 定义文件）',
  },
  {
    id: 'R2',
    title: '长度裸值',
    hint: '长度一律取 --dfg-space-* / --dfg-radius-* / --dfg-font-size-* 等令牌',
  },
  { id: 'R3', title: '样式对象裸数字', hint: '间距族属性一律 var(--dfg-*) 字符串，不写裸数字' },
];

/** R3 关注的间距族属性名。 */
const SPACING_STYLE_KEYS = [
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginBlock',
  'marginInline',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingBlock',
  'paddingInline',
  'gap',
  'rowGap',
  'columnGap',
  'inset',
  'borderRadius',
  'fontSize',
  'lineHeight',
  'borderWidth',
];

/** 颜色裸值模式。 */
const COLOR_PATTERNS = [
  {
    id: 'R1',
    label: 'hex 颜色',
    pattern: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g,
  },
  { id: 'R1', label: 'rgb()/rgba()', pattern: /\brgba?\(/g },
  { id: 'R1', label: 'hsl()/hsla()', pattern: /\bhsla?\(/g },
];

/** 长度裸值模式（`0` / `0px` 放行）。 */
const LENGTH_PATTERN = /(?<![\w.-])(\d+(?:\.\d+)?)(px|rem|em)\b/g;

/** R3：间距族属性直接赋数字字面量。 */
const BARE_NUMBER_PATTERN = new RegExp(
  `\\b(?:${SPACING_STYLE_KEYS.join('|')})\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b(?!\\s*(?:px|rem|em|%|vh|vw))`,
  'g',
);

/**
 * 路径是否在白名单（相对仓库根、`/` 分隔）。
 *
 * @param {string} relPath
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function allowlistFor(relPath) {
  const normalized = relPath.split(sep).join('/');
  const hit = ALLOWLIST.find((entry) => entry.pattern.test(normalized));
  return hit === undefined ? { allowed: false } : { allowed: true, reason: hit.reason };
}

/** 行内豁免：本行或上一行出现标记，且标记后带非空理由。 */
function inlineAllowReason(lines, index) {
  const candidates = [lines[index] ?? '', index > 0 ? (lines[index - 1] ?? '') : ''];
  for (const line of candidates) {
    const at = line.indexOf(INLINE_ALLOW_MARKER);
    if (at < 0) continue;
    const reason = line.slice(at + INLINE_ALLOW_MARKER.length).trim();
    if (reason.length > 0) return reason;
  }
  return null;
}

/**
 * 注释内容是否属「样式语法文本」（示例/说明，而非取值）。
 *
 * 判据：带 `{` 的样例对象、`rgb(` / `hsl(` 取色写法、或**令牌引用示例**（`var(--dfg-…)`）。
 * 只写「#hex」或「12px」的注释**照抓**——那通常是规范泄漏的现场记录，正是 R1/R2 的靶子。
 */
function isStyleSyntaxComment(content) {
  return (
    content.includes('{') || /\b(?:rgba?|hsla?)\(/.test(content) || content.includes('var(--dfg-')
  );
}

/** 字符串内容是否为样式语法文本：`{`（样式对象/CSS 块文本）或令牌引用示例；裸 `marginTop: 8` 仍照抓。 */
function isStyleSyntaxString(content) {
  return content.includes('{') || content.includes('var(--dfg-');
}

/**
 * 把「不属于取值」的文本区段替换为空格（保持列号稳定），供规则逐行匹配：
 * - 行注释 `//` 与块注释 `/* … *​/`：仅当内容属样式语法文本时屏蔽（跨行块注释整体屏蔽）；
 * - 字符串：单/双引号不跨行；反引号模板串跨行时也把整行内容视作串内文本（不误报行尾）。
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function maskNonCodeText(lines) {
  const chars = lines.map((line) => line.split(''));
  const blank = (index, from, to) => {
    const row = chars[index];
    if (row === undefined) return;
    for (let at = Math.max(0, from); at < Math.min(row.length, to); at += 1) row[at] = ' ';
  };
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    let at = 0;
    while (at < line.length) {
      const char = line[at];
      if (!inBlockComment && char === '/' && line[at + 1] === '/') {
        const content = line.slice(at + 2);
        if (isStyleSyntaxComment(content)) blank(index, at, line.length);
        break;
      }
      if (!inBlockComment && char === '/' && line[at + 1] === '*') {
        const end = line.indexOf('*/', at + 2);
        const content = line.slice(at + 2, end < 0 ? line.length : end);
        if (isStyleSyntaxComment(content)) blank(index, at, end < 0 ? line.length : end + 2);
        if (end < 0) {
          inBlockComment = true;
          break;
        }
        at = end + 2;
        continue;
      }
      if (inBlockComment) {
        const end = line.indexOf('*/', at);
        const content = line.slice(at, end < 0 ? line.length : end);
        if (isStyleSyntaxComment(content)) blank(index, at, end < 0 ? line.length : end + 2);
        if (end < 0) break;
        inBlockComment = false;
        at = end + 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        const close = line.indexOf(char, at + 1);
        const content = line.slice(at + 1, close < 0 ? line.length : close);
        if (isStyleSyntaxString(content)) blank(index, at, close < 0 ? line.length : close + 1);
        if (close < 0) break; // 跨行模板串：按单行收束，后续行不再当串内处理
        at = close + 1;
        continue;
      }
      at += 1;
    }
  }
  return chars.map((row) => row.join(''));
}

/**
 * 扫描单文件文本。
 *
 * @param {string} file 相对仓库根路径（用于报告与白名单判定）
 * @param {string} text 文件内容
 * @returns {Array<{file: string, line: number, column: number, rule: string, ruleTitle: string, text: string, hint: string}>}
 */
export function scanText(file, text) {
  const allowed = allowlistFor(file);
  if (allowed.allowed) return [];

  const lines = text.split('\n');
  // 规则在「屏蔽掉注释与样式语法字符串」的文本上跑；行内豁免标记仍按原文判断
  const scanned = maskNonCodeText(lines);
  /** @type {Array<{file: string, line: number, column: number, rule: string, ruleTitle: string, text: string, hint: string}>} */
  const violations = [];
  const push = (ruleId, lineIndex, column, snippet) => {
    const rule = RULES.find((entry) => entry.id === ruleId);
    if (rule === undefined) return;
    violations.push({
      file,
      line: lineIndex + 1,
      column,
      rule: rule.id,
      ruleTitle: rule.title,
      text: snippet.trim(),
      hint: rule.hint,
    });
  };

  scanned.forEach((line, index) => {
    if (inlineAllowReason(lines, index) !== null) return;
    // 注释里写死色值同样是口径泄漏的源头：除行内豁免与「样式语法文本」外照抓
    for (const { id, pattern } of COLOR_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        push(id, index, (match.index ?? 0) + 1, match[0]);
      }
    }
    for (const match of line.matchAll(LENGTH_PATTERN)) {
      if (match[1] === '0') continue;
      push('R2', index, (match.index ?? 0) + 1, match[0]);
    }
    for (const match of line.matchAll(BARE_NUMBER_PATTERN)) {
      if (match[1] === '0' || match[1] === '-0') continue;
      push('R3', index, (match.index ?? 0) + 1, match[0]);
    }
  });

  return violations;
}

/**
 * 递归收集扫描目标（跳过 node_modules 等）。
 *
 * @param {string} absRoot 绝对路径根
 * @returns {string[]} 绝对路径文件列表
 */
export function collectSourceFiles(absRoot) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      out.push(join(dir, entry.name));
    }
  };
  if (statSync(absRoot).isDirectory()) walk(absRoot);
  return out.sort();
}

/**
 * 扫描仓库根下的若干目录。
 *
 * @param {string} repoRoot 仓库根绝对路径
 * @param {string[]} roots 相对仓库根的目录
 * @returns {{ skipped: Array<{file: string, reason: string}>, violations: ReturnType<typeof scanText> }}
 */
export function scanRoots(repoRoot, roots) {
  /** @type {Array<{file: string, reason: string}>} */
  const skipped = [];
  /** @type {ReturnType<typeof scanText>} */
  const violations = [];
  for (const root of roots) {
    for (const absFile of collectSourceFiles(join(repoRoot, root))) {
      const relPath = relative(repoRoot, absFile);
      const allowed = allowlistFor(relPath);
      if (allowed.allowed) {
        skipped.push({ file: relPath, reason: allowed.reason ?? '' });
        continue;
      }
      violations.push(...scanText(relPath, readFileSync(absFile, 'utf8')));
    }
  }
  return { skipped, violations };
}
