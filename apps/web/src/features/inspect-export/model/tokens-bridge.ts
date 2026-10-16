/**
 * Token → CSS 变量桥（F6「Token → CSS 变量说明」的数据面）。
 *
 * 口径：节点属性里存的是**最终字面值**（Design IR 不引用令牌），令牌是设计资产；
 * 因此这里是**反查**：把字面值对回 `@dforge/engine` 解析后的令牌表（别名链求值），
 * 命中的输出 `var(--dfg-design-…)` 并附原始值回退，未命中就输出原始值 + 回退提示。
 *
 * 变量命名：`--dfg-design-<路径>`——与 `@dforge/ui` 的界面令牌（`--dfg-color-*`）
 * 明确分家：文档令牌是设计资产，界面令牌是产品皮肤，同名会互相污染。
 */

import { resolveAllTokens, type TokenSet } from '@dforge/engine';

/** 文档令牌的 CSS 变量前缀（设计资产命名空间）。 */
export const DESIGN_TOKEN_VAR_PREFIX = '--dfg-design';

/** 令牌路径 → CSS 变量名（`color.brand` → `--dfg-design-color-brand`）。 */
export function designTokenCssVar(path: string): string {
  return `${DESIGN_TOKEN_VAR_PREFIX}-${path.split('.').join('-')}`;
}

/** 值 → 令牌绑定结果。 */
export interface TokenBinding {
  /** 命中的令牌路径（未命中为 null）。 */
  tokenPath: string | null;
  /** 生成的 CSS 变量（未命中为 null）。 */
  cssVar: string | null;
  /** 原始字面值（回退值）。 */
  raw: string;
  /** 输出表达式：命中 = `var(--x, raw)`；未命中 = `raw`。 */
  expression: string;
}

/** 去掉长度单位（`8px` → `8`）；非纯数值原样返回。 guard-tokens:allow 正则样例（长度单位剥离规则），非界面取值 */
function stripLengthUnit(value: string): string {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match?.[1] ?? value;
}

/** 值的比较键：小写 + 去掉 px 单位（`#0D99FF` ↔ `#0d99ff`、`8px` ↔ `8`）。 guard-tokens:allow 注释样例（大小写/单位归一化），非界面取值 */
function comparisonKey(value: string): string {
  return stripLengthUnit(value.trim()).toLowerCase();
}

/**
 * 反查令牌：命中返回 var() 表达式。
 *
 * 规则（确定性）：
 * - 比较键 = 小写 + 去 px（尺寸令牌与 CSS 字面值的单位差异在这里消化）；
 * - **同值多令牌取字典序最小路径**——别名链（`color.brandAlias` → `color.brand`）
 *   不改变结果，同一节点两次生成必然得到同一变量。
 */
export function bindTokenValue(tokens: TokenSet, raw: string): TokenBinding {
  const key = comparisonKey(raw);
  const { resolved } = resolveAllTokens(tokens);
  const candidates = Object.keys(resolved)
    .filter((path) => {
      const value = resolved[path]?.value;
      return value !== undefined && comparisonKey(String(value)) === key;
    })
    .sort();
  const tokenPath = candidates[0] ?? null;
  if (tokenPath === null) {
    return { tokenPath: null, cssVar: null, raw, expression: raw };
  }
  const cssVar = designTokenCssVar(tokenPath);
  return { tokenPath, cssVar, raw, expression: `var(${cssVar}, ${raw})` };
}
