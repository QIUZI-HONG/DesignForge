/**
 * 中英术语等价类与分词（MK-04 检索首版）——规格《技能市场规格 v1》§6.2 D3：
 * 「搜索框（名称/描述/标签/正文，首版 BM25 + 中英术语等价类，「PPT/幻灯片/deck」起步）」。
 *
 * 设计要点：
 * - **分词零依赖**：拉丁词小写化 + 尾部复数 -s 归并；中文按**重叠二元组**切分（bigram），
 *   不引入中文分词库（首版口径，词典随术语表维护）；
 * - **等价类对称展开**：索引侧与查询侧都走 `indexText`，命中任一成员即追加该类的 canonical
 *   （类首成员），于是「PPT / 幻灯片 / deck」互相可达；多词成员（design system）按
 *   **相邻 token 序列**匹配（中英两侧同一算法，含连字符写法——连字符即分隔符）；
 * - **表可扩展**：`TERM_EQUIVALENCE_CLASSES` 追加类/成员即可；表版本号进检索索引产物
 *   （`TERM_TABLE_VERSION`），便于索引重建判定。
 *
 * 边界（v1 明示）：复数归并只处理尾部 -s（"analysis" 类词会过度归并，域内罕见，暂不引入
 * 词形还原库）；中文二元组召回率高、精度靠 BM25 的 IDF 与字段权重兜底。
 */

/** 术语表版本（进检索索引产物溯源；表变更时 ≥1 递增）。 */
export const TERM_TABLE_VERSION = 1;

/**
 * 中英术语等价类（类首成员 = canonical；"PPT/幻灯片/deck" 起步，随规格 §6.2 扩表）。
 */
export const TERM_EQUIVALENCE_CLASSES: readonly (readonly string[])[] = [
  // 演示文稿（起步表的锚点）
  [
    'ppt',
    '幻灯片',
    'slide',
    'slides',
    'deck',
    'decks',
    'presentation',
    'presentations',
    'slideshow',
    '演示文稿',
    '汇报',
    '路演',
    'keynote',
  ],
  // 设计系统
  ['设计系统', 'design-system', 'design system', 'designsystem', '系统化设计'],
  // 设计令牌
  ['令牌', 'token', 'tokens', '设计令牌', '变量'],
  // 模板
  ['模板', 'template', 'templates', '样板', 'scaffold', 'starter'],
  // 图标
  ['图标', 'icon', 'icons', 'iconography', '图标集'],
  // 海报
  ['海报', 'poster', 'posters', '视觉海报'],
  // 原型
  ['原型', 'prototype', '原型图', 'wireframe', '线框图', 'mockup'],
  // 动效
  ['动效', 'animation', 'animations', 'motion', '动画', '过渡动画', '微交互'],
  // 图表与看板
  ['图表', 'chart', 'charts', 'dashboard', '仪表盘', '数据可视化', 'dataviz', '可视化'],
  // 配色
  ['配色', 'color', 'colors', 'colour', 'palette', '色板', '色彩', '颜色'],
  // 排版与字体
  ['排版', 'typography', '字体', 'font', 'fonts'],
  // 导出
  ['导出', 'export', 'exports', '导出器'],
  // 移动端
  ['移动端', 'mobile', 'app', 'apps', 'ios', 'android', '手机'],
  // 网页与网站
  ['网页', '网站', 'web', 'website', 'landing page', '落地页'],
  // 品牌
  ['品牌', 'brand', 'branding', 'vi'],
  // 无障碍
  ['无障碍', 'a11y', 'accessibility', '可访问性', '对比度'],
  // 组件
  ['组件', 'component', 'components', 'ui kit', 'uikit'],
];

/** CJK 码点（基本区 + 扩展 A + 兼容表意区；覆盖场景用字）。 */
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
/** 词字符（小写化后）：字母与数字。 */
const WORD_RE = /[a-z0-9]/;

/** 尾部复数归并（仅 -s；"ss" 结尾如 css/class 不动）。 */
function normalizeWord(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * 分词：拉丁词（小写 + 复数归并）与中文重叠二元组（单字成词时保留单字）。
 * 顺序保留（tf 与命中解释依赖词序）。
 */
export function tokenizeText(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i] as string;
    if (CJK_RE.test(ch)) {
      let end = i;
      while (end < lower.length && CJK_RE.test(lower[end] as string)) end += 1;
      const run = lower.slice(i, end);
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let k = 0; k + 1 < run.length; k += 1) tokens.push(run.slice(k, k + 2));
      }
      i = end;
      continue;
    }
    if (WORD_RE.test(ch)) {
      let end = i;
      while (end < lower.length) {
        const next = lower[end] as string;
        if (CJK_RE.test(next) || !WORD_RE.test(next)) break;
        end += 1;
      }
      tokens.push(normalizeWord(lower.slice(i, end)));
      i = end;
      continue;
    }
    i += 1;
  }
  return tokens;
}

interface PreparedClass {
  members: readonly string[];
  canonical: string;
  /** 单词成员（token 精确命中）。 */
  singleTokens: Set<string>;
  /** 多词成员（相邻 token 序列命中；中英同一算法）。 */
  phrases: string[][];
}

/** 词表在模块加载时预处理一次（分词的重复成本不进查询热路径）。 */
const PREPARED_CLASSES: PreparedClass[] = TERM_EQUIVALENCE_CLASSES.map((members) => {
  const canonical = members[0] as string;
  const singleTokens = new Set<string>();
  const phrases: string[][] = [];
  for (const member of members) {
    const tokens = tokenizeText(member);
    if (tokens.length === 0) continue;
    if (tokens.length === 1) singleTokens.add(tokens[0] as string);
    else phrases.push(tokens);
  }
  return { members, canonical, singleTokens, phrases };
});

/** 相邻 token 序列匹配（用于多词成员与中文二词组）。 */
function containsSequence(tokens: readonly string[], phrase: readonly string[]): boolean {
  const limit = tokens.length - phrase.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * 等价扩展：返回「原 token 序列 + 命中类的 canonical」。
 * 每个类最多追加一次 canonical；已存在的 canonical 不重复追加。
 */
export function expandEquivalents(tokens: readonly string[]): string[] {
  const expanded = [...tokens];
  for (const prepared of PREPARED_CLASSES) {
    let matched = false;
    for (const token of tokens) {
      if (prepared.singleTokens.has(token)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (const phrase of prepared.phrases) {
        if (containsSequence(tokens, phrase)) {
          matched = true;
          break;
        }
      }
    }
    if (matched && !expanded.includes(prepared.canonical)) {
      expanded.push(prepared.canonical);
    }
  }
  return expanded;
}

/** 索引与查询的**同一入口**（对称性保证中英互查；§6.2）。 */
export function indexText(text: string): string[] {
  return expandEquivalents(tokenizeText(text));
}

/** 可解释辅助：某词所属等价类成员表（无则 null）。支持多二词组的中文成员（按全词匹配）。 */
export function classOf(term: string): readonly string[] | null {
  const tokens = tokenizeText(term);
  if (tokens.length === 0) return null;
  const single = tokens[0] as string;
  if (tokens.length === 1) {
    for (const prepared of PREPARED_CLASSES) {
      if (prepared.singleTokens.has(single)) return prepared.members;
    }
  }
  for (const prepared of PREPARED_CLASSES) {
    for (const phrase of prepared.phrases) {
      if (phrase.length === tokens.length && containsSequence(tokens, phrase)) {
        return prepared.members;
      }
    }
  }
  return null;
}
