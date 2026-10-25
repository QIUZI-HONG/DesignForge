// @vitest-environment jsdom
/**
 * 快捷键速查卡数据模型测试（工单 08 · 长按修饰键的上下文键位）�? *
 * 口径（期望值独立给出）�? * - 上下文三档：面板开着 �?面板（面板自己的导航键位，全局派发此刻让路）；
 *   焦点在可编辑�?�?文本编辑�?*单键工具键在输入区不派发**——与全局派发同一条规则，
 *   速查卡只展示「现在按了真会生效」的键位）；否则 �?画布（全部键位）�? * - 画布/文本编辑档的键位 **100% 从命令注册表派生**（带 shortcut 的命令）——与命令面板�? *   快捷键说明同一真源，漂移在结构上不可能�? * - 面板档的固定键位由调用方给（模型不产文案）�? */
import { describe, expect, it } from 'vitest';

import type { Command } from '../editor-shell';
import { buildCheatGroups, resolveCheatContext } from './cheat-model';

/** 造命令�?*/
function command(id: string, title: string, group: string, shortcut?: string): Command {
  return { id, title, group, ...(shortcut === undefined ? {} : { shortcut }), run: () => undefined };
}

const commands: Command[] = [
  command('tool.move', '移动工具', '工具', 'V'),
  command('tool.rect', '矩形工具', '工具', 'R'),
  command('edit.undo', '撤销', '编辑', '⌘Z'),
  command('view.palette', '命令面板', '视图'), // 无快捷键：速查卡不�?];

const paletteGroup = {
  label: '命令面板',
  rows: [
    { label: '选择命令', shortcut: '↑↓' },
    { label: '执行命令', shortcut: '�? },
    { label: '关闭面板', shortcut: 'Esc' },
  ],
};

describe('resolveCheatContext', () => {
  it('面板开着 �?面板上下文（命令面板或快捷键说明任一打开�?, () => {
    expect(resolveCheatContext({ paletteOpen: true, shortcutsOpen: false, activeElement: null })).toBe(
      'palette',
    );
    expect(resolveCheatContext({ paletteOpen: false, shortcutsOpen: true, activeElement: null })).toBe(
      'palette',
    );
  });

  it('焦点在输入框 �?文本编辑上下�?, () => {
    const input = document.createElement('input');
    expect(resolveCheatContext({ paletteOpen: false, shortcutsOpen: false, activeElement: input })).toBe(
      'text',
    );
  });

  it('焦点在画布（非可编辑）→ 画布上下�?, () => {
    const div = document.createElement('div');
    expect(resolveCheatContext({ paletteOpen: false, shortcutsOpen: false, activeElement: div })).toBe(
      'canvas',
    );
    expect(resolveCheatContext({ paletteOpen: false, shortcutsOpen: false, activeElement: null })).toBe(
      'canvas',
    );
  });
});

describe('buildCheatGroups', () => {
  it('画布上下文：全部带快捷键的命令按分组归并（无快捷键不收）', () => {
    const groups = buildCheatGroups({ commands, context: 'canvas', paletteGroup });
    expect(groups.map((group) => group.id)).toEqual(['group:工具', 'group:编辑']);
    expect(groups[0]?.rows).toEqual([
      { label: '移动工具', shortcut: 'V' },
      { label: '矩形工具', shortcut: 'R' },
    ]);
    expect(groups[1]?.rows).toEqual([{ label: '撤销', shortcut: '⌘Z' }]);
  });

  it('文本编辑上下文：只收带修饰键的快捷键（单键工具键在输入区不派发，故不展示�?, () => {
    const groups = buildCheatGroups({ commands, context: 'text', paletteGroup });
    const labels = groups.flatMap((group) => group.rows.map((row) => row.label));
    expect(labels).toEqual(['撤销']); // V/R 不在；⌘Z �?  });

  it('面板上下文：调用方给的固定键位卡（单组）', () => {
    const groups = buildCheatGroups({ commands, context: 'palette', paletteGroup });
    expect(groups).toEqual([{ id: 'group:palette', label: '命令面板', rows: paletteGroup.rows }]);
  });
});
