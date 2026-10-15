/**
 * 设计令牌（W3C DTCG 子集）——设计资产的类型形状。
 *
 * 形状归 model（属 Design IR，随文档保存）；**解析**（别名链求值、拓扑排序、环检测）归 `tokens/`。
 * 令牌是设计资产，节点属性里存的是**最终字面值**；渲染层用 `tokens/` 把字面值反查回令牌名
 * （C4 资产面板 → Inspector 显示令牌引用）。
 */

/** 令牌类型（DTCG `$type`）。 */
export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'number'
  | 'string'
  | 'shadow'
  | 'typography';

/** 令牌值：字面值，或 DTCG 别名（形如 `{color.brand.primary}` 的字符串）。 */
export type TokenValue = string | number | boolean | readonly unknown[] | Record<string, unknown>;

/** 单个令牌。 */
export interface DesignToken {
  /** 缺省时按令牌组 `$type` 或解析后的目标类型推断。 */
  $type?: TokenType;
  $value: TokenValue;
  $description?: string;
}

/** 令牌组（嵌套）或令牌。 */
export type TokenGroup = {
  $type?: TokenType;
  $description?: string;
  [key: string]: DesignToken | TokenGroup | TokenType | string | undefined;
};

/** 令牌集（DTCG 文档形状，嵌套）。 */
export type TokenSet = Record<string, DesignToken | TokenGroup>;

/** 空令牌集。 */
export function emptyTokenSet(): TokenSet {
  return {};
}

/** 构造令牌。 */
export function token($type: TokenType, $value: TokenValue, $description?: string): DesignToken {
  return $description === undefined ? { $type, $value } : { $type, $value, $description };
}

/** 构造别名令牌。 */
export function aliasToken(path: string, $description?: string): DesignToken {
  return $description === undefined
    ? { $value: `{${path}}` }
    : { $value: `{${path}}`, $description };
}

/** 判定一项是否为令牌（而非令牌组）。 */
export function isDesignToken(value: unknown): value is DesignToken {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, '$value');
}

/** 解析 DTCG 别名语法：`"{a.b}"` → `"a.b"`；非别名返回 null。 */
export function parseAliasReference(value: TokenValue): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\{([^}]+)\}$/.exec(value);
  return match?.[1]?.trim() ?? null;
}
