/**
 * 命令面板数据模型测试（工单 08：分组 / 漫游 / 置灰；票 04：「最近使用」置顶分组）。
 * 期望值独立给出：空查询 = 按注册顺序分组的全量（有本地最近记录时置顶一个
 * 「最近使用」组——组内命令按最近序，只含仍注册的 id，无记录不撒谎出组）；
 * 有查询 = 相关性排序后按组归并（组的先后 = 组内最优命中首次出现的顺序，
 * 搜索态不掺最近分组）；置灰项可见但漫游跳过；Home/End 跳首/尾。
 */
import { describe, expect, it } from 'vitest';

import type { Command } from '../editor-shell';
import {
  buildPaletteGroups,
  firstEnabledIndex,
  flattenPaletteItems,
  lastEnabledIndex,
  nextEnabledIndex,
} from './palette-model';

/** 造命令。 */
function command(id: string, title: string, group: string, disabled = false): Command {
  return { id, title, group, enabled: () => !disabled, run: () => undefined };
}

const commands: Command[] = [
  command('tool.move', '移动工具', '工具'),
  command('tool.rect', '矩形工具', '工具'),
  command('view.zoomIn', '放大', '视图'),
  command('edit.undo', '撤销', '编辑', true),
];

describe('buildPaletteGroups', () => {
  it('空查询且无最近记录：全命令按分组归并（组序 = 注册顺序里首次出现的顺序），无「最近使用」组（不撒谎）', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    expect(groups.map((group) => group.id)).toEqual(['group:工具', 'group:视图', 'group:编辑']);
    expect(groups[0]?.items.map((item) => item.command.id)).toEqual(['tool.move', 'tool.rect']);
  });

  it('空查询且有最近记录：置顶「最近使用」组，组内按最近序、只含仍注册的命令', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '',
      recent: ['view.zoomIn', 'tool.rect', 'gone.command'],
      recentGroupLabel: '最近使用',
    });

    expect(groups[0]?.id).toBe('group:recent');
    expect(groups[0]?.label).toBe('最近使用');
    // gone.command 已不在注册表 → 不进组（面板不撒谎：只列能解释的条目）
    expect(groups[0]?.items.map((item) => item.command.id)).toEqual(['view.zoomIn', 'tool.rect']);
    // 最近组之后是常规分组（组序不变）
    expect(groups.slice(1).map((group) => group.id)).toEqual([
      'group:工具',
      'group:视图',
      'group:编辑',
    ]);
  });

  it('最近记录里的置灰命令照常展示并带 disabled 标记（与常规组同一口径）', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '',
      recent: ['edit.undo'],
      recentGroupLabel: '最近使用',
    });

    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.disabled).toBe(true);
  });

  it('有查询时不出现「最近使用」组（搜索态只按命中排序）', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '矩形',
      recent: ['tool.rect'],
      recentGroupLabel: '最近使用',
    });

    expect(groups.map((group) => group.id)).toEqual(['group:工具']);
  });

  it('空查询条目不带高亮区间', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    expect(flattenPaletteItems(groups).every((item) => item.ranges.length === 0)).toBe(true);
  });

  it('查询命中：只留命中命令，组的先后 = 最优命中首次出现的组序', () => {
    // "放大" 只命中视图组；查询 "工具" 命中工具组两条（标题包含）。
    const groups = buildPaletteGroups({
      commands,
      query: '工具',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    expect(groups.map((group) => group.id)).toEqual(['group:工具']);
    expect(groups[0]?.items.map((item) => item.command.id)).toEqual(['tool.move', 'tool.rect']);
  });

  it('查询命中条目带高亮区间（标题命中位置）', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '矩形',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    const items = flattenPaletteItems(groups);
    expect(items).toHaveLength(1);
    expect(items[0]?.command.id).toBe('tool.rect');
    expect(items[0]?.ranges).toEqual([[0, 2]]);
  });

  it('置灰条目仍展示（可解释为什么不能点），带 disabled 标记', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '撤销',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    const items = flattenPaletteItems(groups);
    expect(items).toHaveLength(1);
    expect(items[0]?.disabled).toBe(true);
  });

  it('无命中 → 空分组数组（视图据此渲染空态）', () => {
    expect(
      buildPaletteGroups({ commands, query: '不存在', recent: [], recentGroupLabel: '最近使用' }),
    ).toEqual([]);
  });

  it('分组兜底命中：搜「编辑」列出编辑组全部命令（含置灰）', () => {
    const groups = buildPaletteGroups({
      commands,
      query: '编辑',
      recent: [],
      recentGroupLabel: '最近使用',
    });
    expect(groups.map((group) => group.id)).toEqual(['group:编辑']);
    expect(groups[0]?.items.map((item) => item.command.id)).toEqual(['edit.undo']);
  });
});

describe('键盘漫游', () => {
  const flat = flattenPaletteItems(
    buildPaletteGroups({ commands, query: '', recent: [], recentGroupLabel: '最近使用' }),
  );
  // 注册顺序铺平：移动(0) 矩形(1) 放大(2) 撤销(3, 置灰)

  it('首个可运行条目是下标 0', () => {
    expect(firstEnabledIndex(flat)).toBe(0);
  });

  it('末个可运行条目跳过尾部置灰项（End 落点）', () => {
    expect(lastEnabledIndex(flat)).toBe(2);
  });

  it('向下漫游跳过置灰项并首尾回环', () => {
    expect(nextEnabledIndex(flat, 2, 1)).toBe(0);
    expect(nextEnabledIndex(flat, 0, 1)).toBe(1);
  });

  it('向上漫游回环时跳过置灰项', () => {
    expect(nextEnabledIndex(flat, 0, -1)).toBe(2);
  });

  it('全表皆置灰 → 漫游无落点（-1）', () => {
    const allDisabled = flattenPaletteItems(
      buildPaletteGroups({
        commands: [command('a', '标题', '分组', true)],
        query: '',
        recent: [],
        recentGroupLabel: '最近使用',
      }),
    );
    expect(nextEnabledIndex(allDisabled, -1, 1)).toBe(-1);
    expect(firstEnabledIndex(allDisabled)).toBe(-1);
    expect(lastEnabledIndex(allDisabled)).toBe(-1);
  });
});
