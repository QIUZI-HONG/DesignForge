/**
 * 令牌添加命令构造器测试（票 14）：面板只构造命令，施加归 CommandStack——
 * 断言走公开缝：构造出的 Command 施加到引擎命令栈后文档真值可观测（令牌入文档数据）。
 */
import { CommandStack, createDocument, createPage, type TokenSet, token } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { addTokenCommands, deleteTokenCommands, updateTokenValueCommands } from './token-commands';

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

describe('token-commands · 删除令牌命令（票 14 管理入口）', () => {
  it('存在的路径产出单条 document.setTokens 命令，施加后令牌离开文档数据', () => {
    const commands = deleteTokenCommands(tokens, 'color.brand.primary');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('document.setTokens');

    const stack = new CommandStack(
      createDocument({ id: 'doc-del', pages: [createPage({ id: 'p1' })], tokens }),
      { freeze: true },
    );
    stack.dispatch(commands, { label: '删除令牌' });
    // 夹具只有这一个令牌：删空沿途组后整棵 color 树剪除
    expect(stack.document.tokens.color).toBeUndefined();
  });

  it('与添加同等级可撤销：撤销还原、重做复删', () => {
    const stack = new CommandStack(
      createDocument({ id: 'doc-del-undo', pages: [createPage({ id: 'p1' })], tokens }),
      { freeze: true },
    );
    stack.dispatch(deleteTokenCommands(tokens, 'color.brand.primary'), { label: '删除令牌' });
    expect(stack.document.tokens.color).toBeUndefined();
    expect(stack.undo()).toBe(true);
    expect(stack.document.tokens).toEqual(tokens);
    expect(stack.redo()).toBe(true);
    expect(stack.document.tokens.color).toBeUndefined();
  });

  it('路径不存在 → 空列表（会话层跳过 dispatch，不写文档）', () => {
    expect(deleteTokenCommands(tokens, 'color.brand.nope')).toEqual([]);
    expect(deleteTokenCommands(tokens, '   ')).toEqual([]);
  });
});

describe('token-commands · 修改令牌值命令（票 14 管理入口）', () => {
  it('存在的路径产出单条 document.setTokens 命令：$value 更新、$type 沿用既有', () => {
    const commands = updateTokenValueCommands(tokens, 'color.brand.primary', '#FFFFFF');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('document.setTokens');

    const stack = new CommandStack(
      createDocument({ id: 'doc-upd', pages: [createPage({ id: 'p1' })], tokens }),
      { freeze: true },
    );
    stack.dispatch(commands, { label: '修改令牌值' });
    const primary = (
      stack.document.tokens.color as {
        brand: Record<string, { $type: string; $value: string } | undefined>;
      }
    ).brand.primary;
    expect(primary?.$value).toBe('#FFFFFF');
    expect(primary?.$type).toBe('color');
  });

  it('可撤销：撤销回旧值、重做复新值', () => {
    const stack = new CommandStack(
      createDocument({ id: 'doc-upd-undo', pages: [createPage({ id: 'p1' })], tokens }),
      { freeze: true },
    );
    stack.dispatch(updateTokenValueCommands(tokens, 'color.brand.primary', '#FFFFFF'), {
      label: '修改令牌值',
    });
    expect(stack.undo()).toBe(true);
    expect(
      (stack.document.tokens.color as { brand: { primary: { $value: string } } }).brand.primary
        .$value,
    ).toBe('#0D99FF');
    expect(stack.redo()).toBe(true);
    expect(
      (stack.document.tokens.color as { brand: { primary: { $value: string } } }).brand.primary
        .$value,
    ).toBe('#FFFFFF');
  });

  it('路径不存在或新值为空 → 空列表（不写文档）', () => {
    expect(updateTokenValueCommands(tokens, 'color.brand.nope', '#FFF')).toEqual([]);
    expect(updateTokenValueCommands(tokens, 'color.brand.primary', '   ')).toEqual([]);
    expect(updateTokenValueCommands(tokens, '   ', '#FFF')).toEqual([]);
  });
});
