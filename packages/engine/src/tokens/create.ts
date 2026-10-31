/**
 * 令牌创建（票 14 · 资产面板 Token 添加入口的引擎侧）。
 *
 * 分工：`tokens/tokens.ts` 管**解析**（别名链求值、拓扑排序、环检测），本模块管**创建**——
 * 命名校验（分因：empty / too-long / illegal-char / duplicate，UI 按因给 i18n 提示）
 * 与令牌集的不可变写入（与 `scene/mutate.ts` 同一不可变约定：写路径返回新集合，输入永不改）。
 *
 * 创建出的数据必须与既有解析兼容：路径就是点分路径（`color.brand.primary`），
 * 写入即 `flattenTokens` 展平结构中的一员；别名值照常写 `{a.b}` 形态，由解析层求值与检环。
 *
 * 命名规则（非法字符的判据与理由）：
 * - 点号 `.` 是组分隔符（展平/展开按它切分），空分段（`a..b`、首尾点）会让路径表出现空洞 → 非法；
 * - 空白与花括号 `{}` 禁入名内：空白破坏路径的原子性，花括号与 DTCG 别名语法撞形；
 * - 其余字符（含中文、连字符、下划线、数字）一律放行——令牌名是文档数据，不是 CSS 标识符
 *   （导出侧 `tokens-bridge` 自己负责变量名映射），不替用户预判审美。
 * - 长度上限 64 字符：与图层重命名的钳制同一条（spec P2「名称长度钳制到与新建一致的 64 字符」）。
 */

import type { DesignToken, TokenSet } from '../model/index';
import { isDesignToken } from '../model/index';

/** 令牌名长度上限（与图层名称钳制同一条）。 */
export const TOKEN_NAME_MAX_LENGTH = 64;

/** 令牌名问题码（UI 按 code 分因映射 i18n 文案）。 */
export type TokenNameProblemCode = 'empty' | 'too-long' | 'illegal-char' | 'duplicate';

/**
 * 校验令牌名：合法返回 null；非法返回问题码（分因给 UI）。
 *
 * 「重名」的口径：新路径与既有展平路径**占用同一槽位或互相吞并**都算——
 * ① 与既有令牌同路径；② 新路径是既有令牌的祖先（把令牌变分组）；
 * ③ 新路径落在既有令牌之下（既有令牌变分组）。三种都会破坏嵌套结构的一对一性。
 */
export function validateTokenName(tokens: TokenSet, name: string): TokenNameProblemCode | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > TOKEN_NAME_MAX_LENGTH) return 'too-long';
  if (!isWellFormedPath(trimmed)) return 'illegal-char';

  const flat = flattenPaths(tokens);
  if (flat.has(trimmed)) return 'duplicate';
  for (const path of flat) {
    // ② 新名是既有令牌的祖先（前缀且其后紧跟点分）；③ 新名落在既有令牌之下
    if (path.startsWith(`${trimmed}.`) || trimmed.startsWith(`${path}.`)) return 'duplicate';
  }
  return null;
}

/** 路径是否良构：点分分段全非空，且段内无空白、无花括号（见模块头规则）。 */
function isWellFormedPath(path: string): boolean {
  const segments = path.split('.');
  if (segments.some((segment) => segment.length === 0)) return false;
  return segments.every((segment) => !/[\s{}]/.test(segment));
}

/** 收集既有令牌路径（校验用；展平但不复制令牌，轻于 `flattenTokens`）。 */
function flattenPaths(tokens: TokenSet, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(tokens)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (isDesignToken(value)) {
      out.add(path);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      for (const nested of flattenPaths(value as TokenSet, path)) out.add(nested);
    }
  }
  return out;
}

/**
 * 写入（新增/覆盖）单个令牌：点分路径 → 嵌套结构，沿途缺的组按空组补建。
 * 不可变：返回新集合，输入集合（含沿途对象）不被修改——与引擎写路径同一约定，
 * 命令栈的深冻结（freeze）才不会误伤「顺手复用旧引用」的调用方。
 */
export function upsertToken(tokens: TokenSet, path: string, token: DesignToken): TokenSet {
  const segments = path.split('.');
  if (segments.length === 0 || path.trim().length === 0) {
    throw new Error(`令牌路径非法：${path}`);
  }
  return writePath(tokens, segments, token);
}

function writePath(level: TokenSet, segments: readonly string[], token: DesignToken): TokenSet {
  const [head, ...rest] = segments;
  if (head === undefined || head.length === 0) {
    throw new Error(`令牌路径非法：空分段（${segments.join('.')}）`);
  }
  if (rest.length === 0) {
    // 叶子：覆盖该槽位（upsert 语义）；同 key 其余条目原样浅拷保序
    return { ...level, [head]: token };
  }
  const child = level[head];
  // 中间段已被令牌占用时按覆盖推进（校验先行时不会走到；防御性保持全路径可达）
  const nested =
    isDesignToken(child) || typeof child !== 'object' || child === null
      ? ({} as TokenSet)
      : (child as TokenSet);
  return { ...level, [head]: writePath(nested, rest, token) };
}
