/**
 * 令牌添加命令构造器测试（票 14）：面板只构造命令，施加归 CommandStack——
 * 断言走公开缝：构造出的 Command 施加到引擎命令栈后文档真值可观测（令牌入文档数据）。
 */
import { CommandStack, createDocument, createPage, type TokenSet, token } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { addTokenCommands } from './token-commands';

const tokens: TokenSet = {
  color: { brand: { primary: token('color', '#0D99FF') } },
};

describe('token-commands · 添加令牌命令（票 14）', () => {
  it('合法输入产出单条 document.setTokens 命令，施加后令牌入文档数据', () => {
    const commands = addTokenCommands(tokens, {
      name: 'color.brand.secondary',
      value: '#0069D1',
      $type: 'color',
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('document.setTokens');

    const stack = new CommandStack(
      createDocument({ id: 'doc-t', pages: [createPage({ id: 'p1' })], tokens }),
      { freeze: true },
    );
    stack.dispatch(commands, { label: '添加令牌' });
    const brand = stack.document.tokens.color as { brand?: Record<string, { $value: string }> };
    expect(brand.brand?.secondary?.$value).toBe('#0069D1');
  });

  it('非法名（重名）不产出命令：空列表由会话层跳过 dispatch', () => {
    expect(
      addTokenCommands(tokens, { name: 'color.brand.primary', value: '#FFF', $type: 'color' }),
    ).toEqual([]);
  });

  it('非法名（空白名）不产出命令', () => {
    expect(addTokenCommands(tokens, { name: '   ', value: '#FFF', $type: 'color' })).toEqual([]);
  });

  it('别名值原样写入：创建走解析层既有语义（求值/环检测不在此处）', () => {
    const commands = addTokenCommands(tokens, {
      name: 'color.brand.onPrimary',
      value: '{color.brand.primary}',
      $type: 'color',
    });
    const stack = new CommandStack(
      createDocument({ id: 'doc-t', pages: [createPage({ id: 'p1' })], tokens }),
    );
    stack.dispatch(commands, { label: '添加令牌' });
    const brand = (stack.document.tokens.color as { brand: Record<string, { $value: string }> })
      .brand;
    expect(brand.onPrimary?.$value).toBe('{color.brand.primary}');
  });
});
