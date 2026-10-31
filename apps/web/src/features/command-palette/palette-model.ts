/**
 * 命令面板数据模型（工单 08 建模；票 04 增「最近使用」置顶分组）：搜索 → 分组 → 铺平
 * → 漫游——纯函数，视图只管交互。
 *
 * 口径：
 * - **命令源唯一**：全部条目来自命令注册表快照（`useCommandList()`），面板不自持清单；
 * - 空查询 = 全命令按分组归并（组序 = 注册顺序里首次出现的顺序）；有本地最近记录
 *   （`recent`，最近序）时**置顶一个「最近使用」组**——组内只含仍注册的命令
 *   （id 失效的不解释，不撒谎），记录为空不出组；
 * - 有查询 = `searchCommands` 的相关性排序结果按组归并：组的先后 = 组内最优命中
 *   首次出现的顺序，组内保持排序序；搜索态**不掺**最近分组（最近组是空查询的默认态）；
 * - 置灰：`enabled()` 判否的条目仍然展示（可解释「为什么不能点」），但**不可运行**
 *   且键盘漫游跳过（`nextEnabledIndex`）——置灰判定在建模时求值一次，避免渲染期多次调用；
 *   最近组与常规组同一口径（最近执行过、此刻置灰的命令照常展示）。
 */
import type { Command } from '../editor-shell';

import { searchCommands } from './match';

/** 面板条目。 */
export interface PaletteItem {
  command: Command;
  disabled: boolean;
  /** 标题命中区段（空查询全量时为空数组——视图据此决定是否渲染高亮）。 */
  ranges: ReadonlyArray<readonly [number, number]>;
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
  /** 搜索词（空串 = 未搜索）。 */
  query: string;
  /** 最近执行的命令 id（最近序；本地记录，见 `editor-shell` 的 `loadRecentCommands`）。 */
  recent: readonly string[];
  /** 「最近使用」组的展示名（组件层经 i18n 组装；模型不产文案）。 */
  recentGroupLabel: string;
}

/** 「最近使用」组的稳定 id（与 `group:<分组名>` 命名空间区分开）。 */
const RECENT_GROUP_ID = 'group:recent';

/** 建模：得到面板的分组结构（空查询=全量分组 + 最近置顶组；无命中=空数组）。 */
export function buildPaletteGroups({
  commands,
  query,
  recent,
  recentGroupLabel,
}: PaletteModelOptions): PaletteGroup[] {
  const hits = searchCommands(commands, query);

  const order: string[] = [];
  const buckets = new Map<string, PaletteItem[]>();
  for (const { command, match } of hits) {
    const bucket = buckets.get(command.group);
    const item: PaletteItem = {
      command,
      disabled: command.enabled?.() === false,
      ranges: match?.ranges ?? [],
    };
    if (bucket === undefined) {
      buckets.set(command.group, [item]);
      order.push(command.group);
    } else {
      bucket.push(item);
    }
  }
  const groups: PaletteGroup[] = order.map((label) => ({
    id: `group:${label}`,
    label,
    items: buckets.get(label) ?? [],
  }));

  // 空查询默认态置顶「最近使用」：按最近序取仍注册的命令；无有效条目不出组（不撒谎）
  if (query.trim() === '' && recent.length > 0) {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const items: PaletteItem[] = [];
    for (const id of recent) {
      const command = byId.get(id);
      if (command === undefined) continue;
      items.push({ command, disabled: command.enabled?.() === false, ranges: [] });
    }
    if (items.length > 0) groups.unshift({ id: RECENT_GROUP_ID, label: recentGroupLabel, items });
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

/** 首个可运行条目下标（打开面板时的默认高亮；全表置灰 → -1）。 */
export function firstEnabledIndex(items: PaletteItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

/** 末个可运行条目下标（End 落点；从尾部回找，跳过置灰；全表置灰 → -1）。 */
export function lastEnabledIndex(items: PaletteItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.disabled === false) return index;
  }
  return -1;
}
