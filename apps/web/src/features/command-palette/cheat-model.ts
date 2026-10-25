/**
 * 快捷键速查卡数据模型（工单 08 · 长按修饰键的上下文键位）——纯函数。
 *
 * 口径：
 * - 上下文三档（验收：随画布 / 文本编辑 / 面板切换键位）：
 *   - `palette`：命令面板或快捷键说明开着 → 面板此刻占着键盘（全局派发让路），
 *     速查卡显示面板自己的导航键位（调用方给的固定卡，模型不产文案）；
 *   - `text`：焦点在可编辑区 → 只展示**带修饰键**的快捷键——单键工具键（V/R/T…）在
 *     输入区不派发（`isEditableTarget` 同一条规则，全局派发如此，速查卡照实展示），
 *     「卡上有的键按了真生效」；
 *   - `canvas`：默认 → 全部带快捷键的命令按分组归并；
 * - 画布/文本编辑档的键位 **100% 从命令注册表派生**（带 `shortcut` 的命令）——与命令
 *   面板、快捷键说明同一真源；修饰键判定复用 editor-shell 的 `parseShortcut`/`hasModifier`，
 *   不另写一套解析。
 */
import {
  type Command,
  hasModifier,
  isEditableTarget,
  parseShortcut,
} from '../editor-shell';

/** 速查卡上下文。 */
export type CheatContext = 'palette' | 'text' | 'canvas';

/** 一行键位卡（名称 + 展示快捷键）。 */
export interface CheatRow {
  label: string;
  shortcut: string;
}

/** 一组键位卡。 */
export interface CheatGroup {
  id: string;
  label: string;
  rows: CheatRow[];
}

/** 上下文判定入参。 */
export interface CheatContextInput {
  /** 命令面板是否打开。 */
  paletteOpen: boolean;
  /** 快捷键说明是否打开。 */
  shortcutsOpen: boolean;
  /** 当前焦点元素（`document.activeElement`；可为 null）。 */
  activeElement: EventTarget | null;
}

/** 判定速查卡上下文（面板 > 文本编辑 > 画布）。 */
export function resolveCheatContext({
  paletteOpen,
  shortcutsOpen,
  activeElement,
}: CheatContextInput): CheatContext {
  if (paletteOpen || shortcutsOpen) return 'palette';
  if (isEditableTarget(activeElement)) return 'text';
  return 'canvas';
}

/** 建模入参。 */
export interface CheatModelOptions {
  /** 命令快照（`useCommandList()`）。 */
  commands: Command[];
  context: CheatContext;
  /** 面板上下文的固定键位卡（组件层用 i18n 组装；模型不产文案）。 */
  paletteGroup: { label: string; rows: CheatRow[] };
}

/** 建模：得到速查卡的分组结构。 */
export function buildCheatGroups({
  commands,
  context,
  paletteGroup,
}: CheatModelOptions): CheatGroup[] {
  if (context === 'palette') {
    return [{ id: 'group:palette', label: paletteGroup.label, rows: [...paletteGroup.rows] }];
  }

  // 画布/文本编辑：从命令注册表派生；文本编辑档只留带修饰键的快捷键
  const order: string[] = [];
  const buckets = new Map<string, CheatRow[]>();
  for (const command of commands) {
    if (command.shortcut === undefined) continue;
    if (context === 'text') {
      const parsed = parseShortcut(command.shortcut);
      // 解析失败的串不派发也不展示（与全局派发同判据）；无修饰键在输入区不生效
      if (parsed === null || !hasModifier(parsed)) continue;
    }
    const bucket = buckets.get(command.group);
    const row: CheatRow = { label: command.title, shortcut: command.shortcut };
    if (bucket === undefined) {
      buckets.set(command.group, [row]);
      order.push(command.group);
    } else {
      bucket.push(row);
    }
  }
  return order.map((label) => ({ id: `group:${label}`, label, rows: buckets.get(label) ?? [] }));
}
