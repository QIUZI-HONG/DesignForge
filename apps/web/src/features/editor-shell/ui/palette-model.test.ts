/**
 * 命令面板数据模型测试（搜索 / 分组 / 最近使用 / 置灰漫游）。
 *
 * 期望值按 Figma 命令面板口径独立给出（不是实现的反算）：
 * 空查询时「最近使用」在最前；输入查询后最近分组消失；置灰项可见但不可选。
 */
import { describe, expect, it } from 'vitest';

import type { Command } from '../commands/registry';
import {
  buildPaletteGroups,
  firstEnabledIndex,
  flattenPaletteItems,
  nextEnabledIndex,
} from './palette-model';

/** 造命令。 */
function command(id: string, title: string, group: string, disabled = false): Command {
  return {
    id,
    title,
    group,
    enabled: () => !disabled,
    run: () => undefined,
  };
}

const commands: Command[] = [
  command('tool.move', '移动工具', '工具'),
  command('tool.rect', '矩形工具', '工具'),
  command('view.zoomIn', '放大', '视图'),
  command('edit.undo', '撤销', '编辑', true),
];

describe('buildPaletteGroups', () => {
  it('空查询：最近使用在最前（只留仍在表内的 id），其后是按 group 归并的全量', () => {
    const groups = buildPaletteGroups({
      commands,
      recentIds: ['view.zoomIn', 'ghost.command', 'tool.rect'],
      query: '',
      recentLabel: '最近使用',
    });
    expect(groups.map((group) => group.id)).toEqual([
      'recent',
      'group:工具',
      'group:视图',
      'group:编辑',
    ]);
    expect(groups[0]?.items.map((item) => item.command.id)).toEqual(['view.zoomIn', 'tool.rect']);
    expect(groups[1]?.items.map((item) => item.command.id)).toEqual(['tool.move', 'tool.rect']);
  });

  it('输入查询：只保留命中标题的分组，最近分组消失', () => {
    const groups = buildPaletteGroups({
      commands,
      recentIds: ['tool.move'],
      query: '放大',
      recentLabel: '最近使用',
    });
    expect(groups.map((group) => group.id)).toEqual(['group:视图']);
    expect(groups[0]?.items[0]?.command.id).toBe('view.zoomIn');
  });

  it('英文标题大小写不敏感', () => {
    const groups = buildPaletteGroups({
      commands: [command('market.open', 'Open Marketplace', '市场')],
      recentIds: [],
      query: 'MARKETplace',
      recentLabel: '最近使用',
    });
    expect(flattenPaletteItems(groups).map((item) => item.command.id)).toEqual(['market.open']);
  });

  it('中文查询命中', () => {
    const groups = buildPaletteGroups({
      commands,
      recentIds: [],
      query: '矩形',
      recentLabel: '最近使用',
    });
    expect(flattenPaletteItems(groups).map((item) => item.command.id)).toEqual(['tool.rect']);
  });

  it('无命中 → 空分组数组（视图据此渲染空态）', () => {
    const groups = buildPaletteGroups({
      commands,
      recentIds: [],
      query: '不存在',
      recentLabel: '最近使用',
    });
    expect(groups).toEqual([]);
  });

  it('置灰条目仍展示（可解释为什么不能点），并带 disabled 标记', () => {
    const groups = buildPaletteGroups({
      commands,
      recentIds: [],
      query: '撤销',
      recentLabel: '最近使用',
    });
    const items = flattenPaletteItems(groups);
    expect(items).toHaveLength(1);
    expect(items[0]?.disabled).toBe(true);
  });
});

describe('键盘漫游', () => {
  const items = buildPaletteGroups({
    commands,
    recentIds: [],
    query: '',
    recentLabel: '最近使用',
  });
  const flat = flattenPaletteItems(items);
  // 顺序：移动/矩形/放大/撤销（置灰）
  const disabledIndex = flat.findIndex((item) => item.disabled);

  it('首个可运行条目是下标 0', () => {
    expect(firstEnabledIndex(flat)).toBe(0);
  });

  it('向下漫游跳过置灰项', () => {
    expect(nextEnabledIndex(flat, 2, 1)).toBe(0);
  });

  it('向上漫游从 0 回环时跳过置灰项', () => {
    expect(nextEnabledIndex(flat, 0, -1)).toBe(2);
    expect(disabledIndex).toBe(3);
  });

  it('全表皆置灰 → -1（不可运行）', () => {
    expect(nextEnabledIndex([{ command: commands[3] as Command, disabled: true }], -1, 1)).toBe(-1);
  });
});
