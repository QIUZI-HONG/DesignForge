/**
 * 令牌层公开面：解析（别名链/环检测）、展平/展开、分组与类型筛选。
 */

export type { ResolvedToken, TokenProblem } from './tokens';
export {
  expandTokens,
  flattenTokens,
  groupTokenPaths,
  resolveAllTokens,
  resolveColorToken,
  resolveToken,
  tokenPathsByType,
  tokenReferences,
} from './tokens';
