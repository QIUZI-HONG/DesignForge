/**
 * 令牌添加的命令构造器（票 14）—— 面板语义 → 引擎命令。
 *
 * 纪律同 `layer-commands.ts`：面板**只构造命令**，由 `CommandStack.dispatch` 施加；
 * 这里不做任何文档写入。创建走既有写路径 `document.setTokens`（一条命令 = 一次事务，
 * 逆命令由施加器按当前文档计算，与图层操作同等级可撤销）。
 *
 * 无操作口径：命名非法（引擎 `validateTokenName` 分因：empty / too-long / illegal-char /
 * duplicate）→ 空列表，会话层跳过 dispatch——错误分因提示由调用方先经校验给出。
 */

import type { Command } from '@dforge/engine';
import {
  type DesignToken,
  flattenTokens,
  removeToken,
  type TokenSet,
  type TokenType,
  upsertToken,
  validateTokenName,
} from '@dforge/engine';

/** 添加令牌的表单输入（值按用户输入的字符串原样落档，别名 `{a.b}` 交解析层求值）。 */
export interface AddTokenInput {
  /** 令牌名（点分路径；提交前 trim）。 */
  name: string;
  /** 令牌值（提交前 trim）。 */
  value: string;
  /** 令牌类型（DTCG `$type`）。 */
  $type: TokenType;
}

/** 构造「添加单个令牌」的命令列表（命名非法 → 空列表）。 */
export function addTokenCommands(tokens: TokenSet, input: AddTokenInput): Command[] {
  const name = input.name.trim();
  if (validateTokenName(tokens, name) !== null) return [];
  const designToken: DesignToken = { $type: input.$type, $value: input.value.trim() };
  return [{ type: 'document.setTokens', tokens: upsertToken(tokens, name, designToken) }];
}

/**
 * 构造「删除单个令牌」的命令列表（票 14 管理入口）：路径不存在 → 空列表（会话层跳过
 * dispatch），存在 → 单条 `document.setTokens`（一次事务，逆命令由施加器按当前文档
 * 计算——与添加同等级可撤销）。
 */
export function deleteTokenCommands(tokens: TokenSet, path: string): Command[] {
  const name = path.trim();
  if (name.length === 0) return [];
  if (flattenTokens(tokens)[name] === undefined) return [];
  return [{ type: 'document.setTokens', tokens: removeToken(tokens, name) }];
}

/**
 * 构造「修改单个令牌值」的命令列表（票 14 管理入口）：只改 `$value`，`$type` 沿用既有
 * 令牌（改类型不在本票）；路径不存在或新值为空 → 空列表（不写文档）。改名不做（票面
 * 未点名）——名字不变则无需再过 `validateTokenName` 分因。
 */
export function updateTokenValueCommands(tokens: TokenSet, path: string, value: string): Command[] {
  const name = path.trim();
  const nextValue = value.trim();
  if (name.length === 0 || nextValue.length === 0) return [];
  const existing = flattenTokens(tokens)[name];
  if (existing === undefined) return [];
  // 展开既有令牌再覆 $value：$type（DTCG 允许组级继承，可为缺省）原样保留
  const designToken: DesignToken = { ...existing, $value: nextValue };
  return [{ type: 'document.setTokens', tokens: upsertToken(tokens, name, designToken) }];
}
