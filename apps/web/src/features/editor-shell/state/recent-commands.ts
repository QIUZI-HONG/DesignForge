/**
 * 最近使用命令（E7 命令面板：localStorage 记忆）。
 *
 * 口径：只记**命令 id**（不回放参数），最多 `MAX_RECENT` 条，最新在前；
 * 同一命令再次执行时前移而不是新增。读取失败一律当作「没有记录」——
 * SSR（无 localStorage）、隐私模式、配额满、手改坏值都不该让面板崩。
 */

/** 存储键（带版本号：结构变更时换键，旧值自然失效）。 */
export const RECENT_COMMANDS_STORAGE_KEY = 'dfg-editor-recent-commands.v1';

/** 记忆条数上限（面板「最近使用」分组）。 */
export const MAX_RECENT = 5;

/** 读取最近使用（最新在前；不可用/损坏 → 空数组）。 */
export function readRecentCommandIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT);
  } catch {
    // 存储不可用（隐私模式/配额/坏值）：面板退回「无最近使用」，不打断使用
    return [];
  }
}

/**
 * 记一条命令为「最近使用」（前移去重；返回新列表）。
 *
 * @param id 命令 id
 * @param current 当前列表（不传则从存储读取）
 */
export function pushRecentCommandId(id: string, current?: string[]): string[] {
  const base = current ?? readRecentCommandIds();
  const next = [id, ...base.filter((item) => item !== id)].slice(0, MAX_RECENT);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 写失败（配额/隐私模式）不影响本次会话内的面板行为
    }
  }
  return next;
}

/** 清空最近使用（设置类入口与测试隔离）。 */
export function clearRecentCommandIds(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_COMMANDS_STORAGE_KEY);
  } catch {
    // 同上：存储不可用时无需处理
  }
}
