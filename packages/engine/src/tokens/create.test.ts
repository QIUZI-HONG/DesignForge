import { describe, expect, it } from 'vitest';

import { CommandStack } from '../commands/index';
import {
  aliasToken,
  createDocument,
  type DesignDocument,
  type TokenSet,
  token,
} from '../model/index';
import { parseDocument, serializeDocument, stableStringify } from '../serialize/index';
import { upsertToken, validateTokenName } from './create';
import { flattenTokens, resolveAllTokens, resolveToken } from './index';

/** 既有令牌（与 tokens.test.ts 同一夹具族：组级 $type + 别名）。 */
const tokens: TokenSet = {
  color: {
    $type: 'color',
    brand: {
      primary: token('color', '#0D99FF'),
      secondary: aliasToken('color.brand.primary'),
    },
  },
  space: { small: token('dimension', '4px') },
};

describe('tokens · 命名校验（票 14：分因给 UI 做 i18n）', () => {
  it('合法名返回 null：根级、点分嵌套、连字符/下划线/数字', () => {
    expect(validateTokenName(tokens, 'color.brand.primary2')).toBeNull();
    expect(validateTokenName(tokens, 'elevation-high')).toBeNull();
    expect(validateTokenName(tokens, 'radius_lg')).toBeNull();
  });

  it('空名与纯空白 → empty', () => {
    expect(validateTokenName(tokens, '')).toBe('empty');
    expect(validateTokenName(tokens, '   ')).toBe('empty');
  });

  it('超过 64 字符 → too-long；64 字符恰好合法', () => {
    expect(validateTokenName(tokens, 'a'.repeat(65))).toBe('too-long');
    expect(validateTokenName(tokens, 'a'.repeat(64))).toBeNull();
  });

  it('非法字符 → illegal-char：空白、花括号、空点分段、首尾点', () => {
    expect(validateTokenName(tokens, 'my token')).toBe('illegal-char');
    expect(validateTokenName(tokens, '{alias}')).toBe('illegal-char');
    expect(validateTokenName(tokens, 'color..primary')).toBe('illegal-char');
    expect(validateTokenName(tokens, '.lead')).toBe('illegal-char');
    expect(validateTokenName(tokens, 'trail.')).toBe('illegal-char');
  });

  it('与既有令牌重名 → duplicate', () => {
    expect(validateTokenName(tokens, 'color.brand.primary')).toBe('duplicate');
    expect(validateTokenName(tokens, 'space.small')).toBe('duplicate');
  });

  it('与既有分组/路径冲突也按重名处理：新名会占用既有分组槽或落在既有令牌之下', () => {
    // 新名是既有令牌的祖先（color.brand 下已有 primary）
    expect(validateTokenName(tokens, 'color.brand')).toBe('duplicate');
    expect(validateTokenName(tokens, 'color')).toBe('duplicate');
    // 新名的中间段是既有令牌（把 space.small 变成组会吞掉令牌）
    expect(validateTokenName(tokens, 'space.small.lg')).toBe('duplicate');
  });
});

describe('tokens · 创建（票 14：upsertToken 不可变写入）', () => {
  it('点分路径写入嵌套结构，展平后可取回', () => {
    const next = upsertToken(tokens, 'color.brand.tertiary', token('color', '#0069D1'));
    expect(flattenTokens(next)['color.brand.tertiary']?.$value).toBe('#0069D1');
  });

  it('不修改输入（不可变约定：写路径返回新文档，输入永不被改）', () => {
    const before = JSON.stringify(tokens);
    upsertToken(tokens, 'color.brand.tertiary', token('color', '#0069D1'));
    expect(JSON.stringify(tokens)).toBe(before);
  });

  it('根级路径（无点分）直接落根', () => {
    const next = upsertToken(tokens, 'primary', token('color', '#0D99FF'));
    expect(flattenTokens(next).primary?.$value).toBe('#0D99FF');
  });

  it('同路径覆盖（upsert 语义）：替换后组内只留一份', () => {
    const next = upsertToken(tokens, 'color.brand.primary', token('color', '#FFFFFF'));
    expect(flattenTokens(next)['color.brand.primary']?.$value).toBe('#FFFFFF');
    expect(Object.keys(flattenTokens(next))).toHaveLength(3);
  });
});

describe('tokens · 创建与既有解析兼容（票 14 验收：别名/环检测）', () => {
  it('创建的字面令牌可被解析，别名令牌指向创建结果可求值', () => {
    let created: TokenSet = upsertToken({}, 'color.brand.primary', token('color', '#0D99FF'));
    created = upsertToken(created, 'color.brand.onPrimary', aliasToken('color.brand.primary'));
    const resolved = resolveToken(created, 'color.brand.onPrimary');
    expect(resolved.value).toBe('#0D99FF');
    expect(resolved.type).toBe('color');
    expect(resolved.chain).toEqual(['color.brand.onPrimary', 'color.brand.primary']);
  });

  it('创建出的别名环被既有环检测识别（不静默通过）', () => {
    let created: TokenSet = upsertToken({}, 'a.first', aliasToken('b.second'));
    created = upsertToken(created, 'b.second', aliasToken('a.first'));
    const { problems } = resolveAllTokens(created);
    expect(problems.map((problem) => problem.code)).toEqual(['cycle', 'cycle']);
  });

  it('指向不存在路径的别名报 missing（与既有解析同一分类）', () => {
    const created = upsertToken({}, 'alias.lone', aliasToken('no.such.token'));
    const { problems } = resolveAllTokens(created);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('missing');
  });
});

describe('tokens · 创建结果入文档并序列化往返（票 14 验收：随保存持久）', () => {
  /** 最小文档：创建前后的载体。 */
  function docWithTokens(tokens: TokenSet): DesignDocument {
    return createDocument({ id: 'doc-token', tokens });
  }

  it('创建的令牌随文档序列化，往返后逐字段一致；再序列化逐字节相同（幂等）', () => {
    const created = upsertToken(tokens, 'color.brand.tertiary', token('color', '#0069D1'));
    const doc = docWithTokens(created);
    const json = serializeDocument(doc);
    const parsed = parseDocument(json);
    expect(parsed.document.tokens).toEqual(created);

    const secondPass = serializeDocument(parsed.document);
    expect(secondPass).toBe(json);
  });

  it('键序稳定：同一令牌集无论写入顺序，序列化结果逐字节相同', () => {
    const orderA = upsertToken(
      upsertToken({}, 'a.alpha', token('color', '#111111')),
      'b.beta',
      token('dimension', '8px'),
    );
    const orderB = upsertToken(
      upsertToken({}, 'b.beta', token('dimension', '8px')),
      'a.alpha',
      token('color', '#111111'),
    );
    expect(stableStringify(orderA)).toBe(stableStringify(orderB));
  });

  it('命令栈：document.setTokens 一条事务入栈，撤销还原整集、重做复得', () => {
    const doc = docWithTokens(tokens);
    const stack = new CommandStack(doc, { freeze: true });
    const next = upsertToken(tokens, 'color.brand.tertiary', token('color', '#0069D1'));
    stack.dispatch({ type: 'document.setTokens', tokens: next }, { label: '添加令牌' });
    expect(flattenTokens(stack.document.tokens)['color.brand.tertiary']?.$value).toBe('#0069D1');

    expect(stack.undo()).toBe(true);
    expect(stack.document.tokens).toEqual(tokens);
    expect(stack.redo()).toBe(true);
    expect(flattenTokens(stack.document.tokens)['color.brand.tertiary']?.$value).toBe('#0069D1');
  });
});
