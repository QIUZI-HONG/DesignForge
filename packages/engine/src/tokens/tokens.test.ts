import { describe, expect, it } from 'vitest';

import { aliasToken, type TokenSet, token } from '../model/index';
import {
  expandTokens,
  flattenTokens,
  groupTokenPaths,
  resolveAllTokens,
  resolveColorToken,
  resolveToken,
  tokenPathsByType,
  tokenReferences,
} from './index';

const tokens: TokenSet = {
  color: {
    $type: 'color',
    brand: {
      primary: token('color', '#0D99FF'),
      secondary: aliasToken('color.brand.primary'),
    },
    canvas: aliasToken('color.brand.secondary'),
  },
  space: {
    small: token('dimension', '4px'),
    medium: token('dimension', '8px'),
  },
};

describe('tokens · 展平与展开', () => {
  it('展平点分路径并下沉组级 $type', () => {
    const flat = flattenTokens(tokens);
    expect(Object.keys(flat).sort()).toEqual([
      'color.brand.primary',
      'color.brand.secondary',
      'color.canvas',
      'space.medium',
      'space.small',
    ]);
    expect(flat['space.small']?.$type).toBe('dimension');
    expect(flat['color.brand.primary']?.$value).toBe('#0D99FF');
  });

  it('展开回嵌套结构（往返一致）', () => {
    const flat = flattenTokens(tokens);
    const nested = expandTokens(flat);
    expect(flattenTokens(nested)).toEqual(flat);
  });
});

describe('tokens · 解析（别名链）', () => {
  it('沿别名链解析到字面值，并给出链', () => {
    const resolved = resolveToken(tokens, 'color.canvas');
    expect(resolved.value).toBe('#0D99FF');
    expect(resolved.type).toBe('color');
    expect(resolved.chain).toEqual([
      'color.canvas',
      'color.brand.secondary',
      'color.brand.primary',
    ]);
  });

  it('字面值令牌的链只含自身', () => {
    const resolved = resolveToken(tokens, 'space.medium');
    expect(resolved.value).toBe('8px');
    expect(resolved.chain).toEqual(['space.medium']);
  });

  it('缺失引用抛错（token-error）', () => {
    expect(() => resolveToken({ a: aliasToken('b.c') }, 'a')).toThrow('令牌不存在');
  });

  it('环检测：直接环与间接环都抛错并给出链路', () => {
    const direct: TokenSet = { a: aliasToken('b'), b: aliasToken('a') };
    expect(() => resolveToken(direct, 'a')).toThrow('成环');
    const indirect: TokenSet = { a: aliasToken('b'), b: aliasToken('c'), c: aliasToken('a') };
    expect(() => resolveToken(indirect, 'b')).toThrow('成环');
  });

  it('批量解析：成功项与问题项分开返回（不中断）', () => {
    const mixed: TokenSet = {
      ok: token('color', '#FFFFFF'),
      broken: aliasToken('missing.token'),
      loopA: aliasToken('loopB'),
      loopB: aliasToken('loopA'),
    };
    const { resolved, problems } = resolveAllTokens(mixed);
    expect(resolved.ok?.value).toBe('#FFFFFF');
    expect(problems.map((problem) => problem.path).sort()).toEqual(['broken', 'loopA', 'loopB']);
    expect(problems.find((problem) => problem.path === 'loopA')?.code).toBe('cycle');
    expect(problems.find((problem) => problem.path === 'broken')?.code).toBe('missing');
  });

  it('类型继承：别名链上最近的显式类型生效', () => {
    const set: TokenSet = {
      a: aliasToken('b'),
      b: token('dimension', '12px'),
    };
    expect(resolveToken(set, 'a').type).toBe('dimension');
  });
});

describe('tokens · 资产面板辅助（C4）', () => {
  it('按类型筛选与分组', () => {
    expect(tokenPathsByType(tokens, 'color')).toEqual([
      'color.brand.primary',
      'color.brand.secondary',
      'color.canvas',
    ]);
    const groups = groupTokenPaths(['color.a', 'color.b', 'space.small', 'root']);
    expect(groups.color).toEqual(['color.a', 'color.b']);
    expect(groups['(根)']).toEqual(['root']);
  });

  it('引用图（源 → 目标）稳定排序', () => {
    expect(tokenReferences(tokens)).toEqual([
      { from: 'color.brand.secondary', to: 'color.brand.primary' },
      { from: 'color.canvas', to: 'color.brand.secondary' },
    ]);
  });

  it('解析颜色令牌；非颜色返回 null', () => {
    expect(resolveColorToken(tokens, 'color.canvas')).toBe('#0D99FF');
    expect(resolveColorToken(tokens, 'space.small')).toBeNull();
  });
});
