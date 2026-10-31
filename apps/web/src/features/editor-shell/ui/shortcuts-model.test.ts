/**
 * 快捷键说明表数据模型测试（E8；票 04：附加键位随主键位并列展示）。
 *
 * seam：`buildShortcutGroups` 纯函数——断言「说明表 = 实际键位」的同步规则：
 * 带 `shortcutAliases` 的命令，别名必须出现在行上（编辑器内别名键也是真实生效的键位，
 * 说明表缺了它就是撒谎）；无别名的命令行不受影响。
 */
import { describe, expect, it } from 'vitest';

import type { Command } from '../commands/registry';
import { buildShortcutGroups, countShortcutRows } from './shortcuts-model';

/** 造一条命令（只填建模需要的字段；run 缺省 no-op）。 */
function command(
  overrides: Omit<Partial<Command>, 'run'> & Pick<Command, 'id' | 'title' | 'group'>,
): Command {
  return { run: () => undefined, ...overrides };
}

describe('buildShortcutGroups（票 04 附加键位同步）', () => {
  it('带 shortcutAliases 的命令：主键位与别名都进说明表行', () => {
    const groups = buildShortcutGroups([
      command({
        id: 'view.commandPalette',
        title: '命令面板',
        group: '视图',
        shortcut: '⌘K',
        shortcutAliases: ['⌘/'],
      }),
    ]);

    expect(countShortcutRows(groups)).toBe(1);
    const row = groups[0]?.rows[0];
    expect(row?.shortcut).toBe('⌘K');
    expect(row?.aliases).toEqual(['⌘/']);
  });

  it('无别名的命令：aliases 为空数组，行为与既有口径一致', () => {
    const groups = buildShortcutGroups([
      command({ id: 'tool.move', title: '移动工具', group: '工具', shortcut: 'V' }),
    ]);

    const row = groups[0]?.rows[0];
    expect(row?.shortcut).toBe('V');
    expect(row?.aliases).toEqual([]);
  });

  it('不带快捷键的命令不进说明表（口径不变）', () => {
    const groups = buildShortcutGroups([
      command({ id: 'file.new', title: '新建', group: '文件' }),
      command({ id: 'tool.move', title: '移动工具', group: '工具', shortcut: 'V' }),
    ]);

    expect(countShortcutRows(groups)).toBe(1);
    expect(groups[0]?.label).toBe('工具');
  });
});
