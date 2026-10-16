/**
 * 命令面板的数据模型（E7：搜索 + 分组 + 最近使用）——纯函数，视图只管交互。
 *
 * 口径：
 * - 搜索：标题大小写不敏感子串匹配（zh-CN 无大小写概念，英文命令名仍按此规则）；
 * - 分组：**最近使用**（仅在未输入查询时出现，只保留仍在命令表里的 id）+ 命令自身的 `group`；
 *   最近项同时保留在其原分组里（与 Figma/VS Code 的「最近 + 全量」一致）；
 * - 置灰：`enabled()` 判否的条目仍然展示（可解释「为什么不能点」），但**不可运行**
 *   且键盘漫游跳过（见 `nextEnabledIndex`）。
 */
import type { Command } from '../commands/registry';

/** 面板条目。 */
export interface PaletteItem {
  command: Command;
  disabled: boolean;
}

/** 面板分组。 */
export interface PaletteGroup {
  id: string;
  label: string;
  items: PaletteItem[];
}

/** 建模入参。 */
export interface PaletteModelOptions {
  /** 命令快照（`useCommandList()`）。 */
  commands: Command[];
  /** 最近使用的命令 id（最新在前）。 */
  recentIds: string[];
  /** 搜索词（空串 = 未搜索）。 */
  query: string;
  /** 「最近使用」分组标题（i18n 由调用方给）。 */
  recentLabel: string;
}

/** 包装成条目（在建模时求值一次 `enabled()`，避免渲染期多次调用有副作用的判定）。 */
function toItem(command: Command): PaletteItem {
  return { command, disabled: command.enabled?.() === false };
}

/** 建模：得到面板的分组结构。 */
export function buildPaletteGroups({
  commands,
  recentIds,
  query,
  recentLabel,
}: PaletteModelOptions): PaletteGroup[] {
  const needle = query.trim().toLowerCase();
  const matches = (command: Command): boolean =>
    needle === '' || command.title.toLowerCase().includes(needle);

  const groups: PaletteGroup[] = [];

  // 最近使用：只在未搜索时出现；命令已注销（或从未注册）的 id 静默丢弃
  if (needle === '') {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((command): command is Command => command !== undefined);
    if (recent.length > 0) {
      groups.push({ id: 'recent', label: recentLabel, items: recent.map(toItem) });
    }
  }

  // 命令自身的分组（顺序 = 注册顺序里首次出现的顺序）
  const order: string[] = [];
  const buckets = new Map<string, PaletteItem[]>();
  for (const command of commands) {
    if (!matches(command)) continue;
    const bucket = buckets.get(command.group);
    if (bucket === undefined) {
      buckets.set(command.group, [toItem(command)]);
      order.push(command.group);
    } else {
      bucket.push(toItem(command));
    }
  }
  for (const label of order) {
    groups.push({ id: `group:${label}`, label, items: buckets.get(label) ?? [] });
  }

  return groups;
}

/** 逐项铺平（键盘漫游的下标空间；含置灰项，便于 aria-activedescendant 对齐 DOM 顺序）。 */
export function flattenPaletteItems(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * 在铺平序列上找下一个**可运行**条目下标（跳过置灰项，首尾回环）。
 *
 * @returns 目标下标；全表皆置灰 → `-1`
 */
export function nextEnabledIndex(items: PaletteItem[], from: number, step: number): number {
  if (items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (((from + step * offset) % items.length) + items.length) % items.length;
    if (items[index]?.disabled === false) return index;
  }
  return -1;
}

/** 首个可运行条目下标（打开面板时的默认高亮）。 */
export function firstEnabledIndex(items: PaletteItem[]): number {
  return items.findIndex((item) => !item.disabled);
}
