/**
 * 快捷键说明表的数据模型（E8）——从命令注册表派生，纯函数。
 *
 * 口径：**只列带 `shortcut` 的命令**（没快捷键的命令在说明表里没有意义）；
 * 分组沿用命令自身的 `group`（首次出现顺序）——与命令面板同一份分组词，
 * 因此「面板里叫工具组、说明表里叫别的」这种漂移不可能发生。
 *
 * 附加键位（`shortcutAliases`，票 04）随主键位并列进行：别名也是真实生效的键位，
 * 说明表缺了它就是与实际键位不一致（「说明表 = 实际键位」的同步规则）。
 */
import type { Command } from '../commands/registry';

/** 说明表的一行（命令标题 + 快捷键；`aliases` 为附加键位，无则空数组）。 */
export interface ShortcutRow {
  command: Command;
  shortcut: string;
  aliases: readonly string[];
}

/** 说明表的一节（分组）。 */
export interface ShortcutGroup {
  id: string;
  label: string;
  rows: ShortcutRow[];
}

/** 从命令快照建模：按分组归并带快捷键的命令。 */
export function buildShortcutGroups(commands: Command[]): ShortcutGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ShortcutRow[]>();
  for (const command of commands) {
    if (command.shortcut === undefined) continue;
    const row: ShortcutRow = {
      command,
      shortcut: command.shortcut,
      aliases: command.shortcutAliases ?? [],
    };
    const bucket = buckets.get(command.group);
    if (bucket === undefined) {
      buckets.set(command.group, [row]);
      order.push(command.group);
    } else {
      bucket.push(row);
    }
  }
  return order.map((label) => ({ id: `group:${label}`, label, rows: buckets.get(label) ?? [] }));
}

/** 说明表总行数（空态判定）。 */
export function countShortcutRows(groups: ShortcutGroup[]): number {
  return groups.reduce((total, group) => total + group.rows.length, 0);
}
