/**
 * 命令模糊匹配测试（工�?08 · 中文模糊搜索的核心）�? *
 * 期望值独立给出（不是实现的反算）�? * - 「连续包含」比「子序列」靠前；子序列要�?*按序**�?命面" 命中「命令面板」，"面命" 不命中）�? * - 命中区段�?*标题上的半开区间**，视图据此高亮（连续命中一段、子序列多段）；
 * - id / 分组兜底命中（英文搜索词�?zoom 也能找到「放大」），但排在标题命中之后�? * - 同分保持注册顺序（排序必须稳定，不做实现外的抖动）�? */
import { describe, expect, it } from 'vitest';

import type { Command } from '../editor-shell';
import { matchCommand, searchCommands } from './match';

/** 造命令（enabled 缺省视为可运行——匹配层不关心置灰）�?*/
function command(id: string, title: string, group = '工具'): Command {
  return { id, title, group, run: () => undefined };
}

describe('matchCommand（单条）', () => {
  it('中文连续包含：命中并给出单段区间', () => {
    const hit = matchCommand(command('tool.move', '移动工具'), '工具');
    expect(hit).not.toBeNull();
    expect(hit?.ranges).toEqual([[2, 4]]);
  });

  it('中文子序列（按序不连续）：命中并给出多段区间', () => {
    const hit = matchCommand(command('view.palette', '命令面板'), '命面');
    expect(hit).not.toBeNull();
    expect(hit?.ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('子序列乱序不命中�?面命" 不是「命令面板」的子序列）', () => {
    expect(matchCommand(command('view.palette', '命令面板'), '面命')).toBeNull();
  });

  it('英文大小写不敏感（标题）', () => {
    const hit = matchCommand(command('market.open', 'Open Marketplace'), 'market');
    expect(hit).not.toBeNull();
    expect(hit?.ranges).toEqual([[5, 11]]);
  });

  it('id 兜底命中（无高亮区间——高亮只标在标题上）', () => {
    const hit = matchCommand(command('view.zoomIn', '放大'), 'zoom');
    expect(hit).not.toBeNull();
    expect(hit?.ranges).toEqual([]);
  });

  it('分组兜底命中（搜「视图」能找到视图组命令）', () => {
    const hit = matchCommand(command('view.zoomIn', '放大', '视图'), '视图');
    expect(hit).not.toBeNull();
    expect(hit?.ranges).toEqual([]);
  });

  it('无命�?�?null', () => {
    expect(matchCommand(command('tool.move', '移动工具'), '不存在的�?)).toBeNull();
  });

  it('空查询（含纯空白）→ null（空查询=全量，由 searchCommands 处理�?, () => {
    expect(matchCommand(command('tool.move', '移动工具'), '')).toBeNull();
    expect(matchCommand(command('tool.move', '移动工具'), '   ')).toBeNull();
  });
});

describe('searchCommands（排序与全量�?, () => {
  const commands: Command[] = [
    command('tool.move', '移动工具'),
    command('tool.rect', '矩形工具'),
    command('view.zoomIn', '放大', '视图'),
    command('view.zoomOut', '缩小', '视图'),
  ];

  it('空查询：全量返回（match=null，保持注册顺序）', () => {
    const hits = searchCommands(commands, '');
    expect(hits.map((hit) => hit.command.id)).toEqual([
      'tool.move',
      'tool.rect',
      'view.zoomIn',
      'view.zoomOut',
    ]);
    expect(hits.every((hit) => hit.match === null)).toBe(true);
  });

  it('连续包含排在子序列之�?, () => {
    const hits = searchCommands(
      [command('a.subseq', '移图动板'), command('b.contains', '移动')],
      '移动',
    );
    // a：移@0 动@2（非连续，子序列）；b：连续包�?�?b 在前
    expect(hits[0]?.command.id).toBe('b.contains');
    expect(hits[0]?.match?.ranges).toEqual([[0, 2]]);
  });

  it('标题命中排在 id 兜底之前', () => {
    const hits = searchCommands(
      [command('zoom.tool', '平移缩放'), command('view.zoomIn', '放大')],
      'zoom',
    );
    expect(hits[0]?.command.id).toBe('zoom.tool'); // 标题�?zoom
    expect(hits[1]?.command.id).toBe('view.zoomIn'); // �?id 命中
  });

  it('同分保持注册顺序（排序稳定，不抖动）', () => {
    const hits = searchCommands(
      [command('x.first', '放大一'), command('y.second', '放大�?)],
      '放大',
    );
    // 两者都是位�?0 的连续包含、标题等�?�?注册顺序
    expect(hits.map((hit) => hit.command.id)).toEqual(['x.first', 'y.second']);
  });

  it('命中位置越靠前分越高（前缀命中先出�?, () => {
    const hits = searchCommands(
      [command('x.late', '一键放�?), command('y.early', '放大画板')],
      '放大',
    );
    expect(hits[0]?.command.id).toBe('y.early');
  });
});
