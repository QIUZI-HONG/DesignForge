/**
 * 令牌解析：DTCG 子集的别名链求值（拓扑序 + 环检测）。
 *
 * 解析规则：
 * - `$value` 为字面值 → 直接返回；
 * - `$value` 形如 `"{a.b.c}"` → 沿别名链求值，链上的类型按 DTCG 规则继承（最近的显式 `$type`）；
 * - 环 → 抛 `DomainError('token-error')`；批处理 API 则把错误收集进结果（不中断其他令牌）。
 */

import type { DesignToken, TokenSet, TokenType, TokenValue } from '../model/index';
import { isDesignToken, parseAliasReference } from '../model/index';
import { domainError } from '../scene/errors';

/** 解析结果。 */
export interface ResolvedToken {
  /** 令牌路径（点分）。 */
  path: string;
  type: TokenType | null;
  /** 最终字面值。 */
  value: TokenValue;
  /** 别名链（含自身，按求值顺序）。 */
  chain: string[];
  $description?: string | undefined;
}

/** 令牌错误。 */
export interface TokenProblem {
  path: string;
  code: 'cycle' | 'missing' | 'invalid';
  message: string;
}

/** 展平嵌套令牌集 → 点分路径表。 */
export function flattenTokens(tokens: TokenSet, prefix = ''): Record<string, DesignToken> {
  const out: Record<string, DesignToken> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (isDesignToken(value)) {
      out[path] = value;
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const nested = flattenTokens(value as TokenSet, path);
      // 组级 `$type` 下沉给子令牌（DTCG 语义）
      const groupType = (value as { $type?: TokenType }).$type;
      for (const [nestedPath, token] of Object.entries(nested)) {
        if (token.$type === undefined && groupType !== undefined) {
          out[nestedPath] = { ...token, $type: groupType };
        } else {
          out[nestedPath] = token;
        }
      }
    }
  }
  return out;
}

/** 展开（重建）嵌套令牌集：点分路径 → 嵌套结构（导入/导出用）。 */
export function expandTokens(flat: Record<string, DesignToken>): TokenSet {
  const root: TokenSet = {};
  for (const [path, token] of Object.entries(flat)) {
    const segments = path.split('.');
    let cursor: Record<string, unknown> = root as Record<string, unknown>;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] as string;
      const next = cursor[segment];
      if (typeof next !== 'object' || next === null) {
        const created: Record<string, unknown> = {};
        cursor[segment] = created;
        cursor = created;
      } else {
        cursor = next as Record<string, unknown>;
      }
    }
    cursor[segments[segments.length - 1] as string] = token;
  }
  return root;
}

/**
 * 解析单个令牌（沿别名链求值）。环或缺失时抛领域错误。
 */
export function resolveToken(tokens: TokenSet, path: string): ResolvedToken {
  const flat = flattenTokens(tokens);
  const chain: string[] = [];
  const resolved = resolvePath(flat, path, chain, new Set());
  return resolved;
}

function resolvePath(
  flat: Record<string, DesignToken>,
  path: string,
  chain: string[],
  visiting: Set<string>,
): ResolvedToken {
  const token = flat[path];
  if (!token) {
    throw domainError('token-error', `令牌不存在：${path}`);
  }
  if (visiting.has(path)) {
    throw domainError('token-error', `令牌别名成环：${[...chain, path].join(' → ')}`);
  }
  visiting.add(path);
  chain.push(path);

  const reference = parseAliasReference(token.$value);
  if (reference === null) {
    const result: ResolvedToken = {
      path,
      type: token.$type ?? null,
      value: token.$value,
      chain: [...chain],
    };
    if (token.$description !== undefined) result.$description = token.$description;
    chain.pop();
    visiting.delete(path);
    return result;
  }

  const target = resolvePath(flat, reference, chain, visiting);
  chain.pop();
  visiting.delete(path);
  const result: ResolvedToken = {
    path,
    type: token.$type ?? target.type,
    value: target.value,
    chain: [...chain, path, ...target.chain.slice(chain.length + 1)],
  };
  // 链表达：自身 → … → 终点
  result.chain = uniqueChain([path, ...target.chain]);
  if (token.$description !== undefined) result.$description = token.$description;
  return result;
}

function uniqueChain(chain: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of chain) if (!out.includes(item)) out.push(item);
  return out;
}

/** 批量解析：返回解析成功的令牌与失败清单（不抛错，便于资产面板展示问题项）。 */
export function resolveAllTokens(tokens: TokenSet): {
  resolved: Record<string, ResolvedToken>;
  problems: TokenProblem[];
} {
  const flat = flattenTokens(tokens);
  const resolved: Record<string, ResolvedToken> = {};
  const problems: TokenProblem[] = [];
  for (const path of Object.keys(flat).sort()) {
    try {
      resolved[path] = resolveToken(tokens, path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push({
        path,
        code: message.includes('成环') ? 'cycle' : 'missing',
        message,
      });
    }
  }
  return { resolved, problems };
}

/** 别名引用图（源 → 目标），供资产面板画依赖。 */
export function tokenReferences(tokens: TokenSet): Array<{ from: string; to: string }> {
  const flat = flattenTokens(tokens);
  const out: Array<{ from: string; to: string }> = [];
  for (const [path, token] of Object.entries(flat)) {
    const reference = parseAliasReference(token.$value);
    if (reference !== null) out.push({ from: path, to: reference });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** 按类型筛选令牌路径（C4 资产面板分段展示）。 */
export function tokenPathsByType(tokens: TokenSet, type: TokenType): string[] {
  const flat = flattenTokens(tokens);
  return Object.entries(flat)
    .filter(([, token]) => token.$type === type)
    .map(([path]) => path)
    .sort();
}

/** 令牌路径前缀分组（资产面板分组）。 */
export function groupTokenPaths(paths: readonly string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const path of paths) {
    const segments = path.split('.');
    const group = segments.length > 1 ? (segments[0] as string) : '(根)';
    const bucket = groups[group];
    if (bucket) {
      bucket.push(path);
    } else {
      groups[group] = [path];
    }
  }
  return groups;
}

/** 解析成具体的颜色字面值（渲染层用）；非 color 令牌返回 null。 */
export function resolveColorToken(tokens: TokenSet, path: string): string | null {
  const resolved = resolveToken(tokens, path);
  if (resolved.type !== null && resolved.type !== 'color') return null;
  return typeof resolved.value === 'string' ? resolved.value : null;
}
