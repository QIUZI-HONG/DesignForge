/**
 * 最近执行命令的本地记录（票 04 · spec P0-4「最近使用」的数据层）——纯逻辑 + localStorage。
 *
 * 口径：
 * - **本地优先，不联网**：只写本机 localStorage（键 `dfg.editor-shell.recent-commands`），
 *   无任何网络路径；隐私模式/配额满等写入失败**静默**——记录是增强能力，
 *   不得阻塞命令执行本身（读写都兜 try/catch）；
 * - 最近序 = 数组首端；重复执行**去重并提到最前**；上限 {@link RECENT_COMMAND_LIMIT} 条，
 *   超出丢弃最旧；
 * - 损坏数据（非 JSON / 非 string 数组）按空处理，不让脏数据炸面板；
 * - 「记什么」由 `executeCommand` 决定（统一漏斗 + 面板开关命令排除，见 `./execute`），
 *   本模块只管「怎么存」。
 */

/** 本地记录的命令条数上限（最近 5 条）。 */
export const RECENT_COMMAND_LIMIT = 5;

/** localStorage 键（`dfg.` 前缀 + 域内语义，避免与宿主应用其它存储冲突）。 */
const STORAGE_KEY = 'dfg.editor-shell.recent-commands';

/**
 * 归并一次执行进最近记录（纯函数）。
 *
 * @param recent 既有记录（最近序）
 * @param id 本次执行的命令 id
 * @returns 新记录（去重 + 提前 + 截到上限）
 */
export function recordRecentCommand(recent: readonly string[], id: string): string[] {
  const next = [id, ...recent.filter((existing) => existing !== id)];
  return next.slice(0, RECENT_COMMAND_LIMIT);
}

/** 读最近记录（SSR / 无 localStorage / 损坏数据 → 空数组）。 */
export function loadRecentCommands(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** 写最近记录（失败静默——增强能力不阻塞）。 */
export function saveRecentCommands(recent: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // 隐私模式 / 配额满：放弃本次记录，命令执行不受影响
  }
}

/** 清空最近记录（测试隔离与用户语义上的「重置」；产品路径不调用）。 */
export function resetRecentCommands(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同写入口径：静默
  }
}
