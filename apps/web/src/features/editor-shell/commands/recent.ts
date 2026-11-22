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
 *
 * 读写机制收编 lib `createLocalStore`（票 D）：validate 谓词 = 逐项 string（本册形状差异）；
 * 后端每次调用时经 {@link browserBackend} 解析——隐私模式下访问 localStorage 本身会抛错，
 * 模块加载期不得触发（与旧实现同口径：抛错由调用方的 try/catch 兜成「无记录」）。
 */

import { browserBackend, createLocalStore, type LocalStore } from '@/lib/local-store';

/** 本地记录的命令条数上限（最近 5 条）。 */
export const RECENT_COMMAND_LIMIT = 5;

/** localStorage 键（`dfg.` 前缀 + 域内语义，避免与宿主应用其它存储冲突）。 */
const STORAGE_KEY = 'dfg.editor-shell.recent-commands';

/** 最近记录册引擎（lib 收编；写入失败缺省吞——增强能力静默降级，口径同旧实现）。 */
function recentStore(): LocalStore<string> {
  return createLocalStore<string>({
    key: STORAGE_KEY,
    backend: browserBackend(),
    validate: (item): item is string => typeof item === 'string',
  });
}

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
  try {
    return recentStore().load();
  } catch {
    return [];
  }
}

/** 写最近记录（失败静默——增强能力不阻塞）。 */
export function saveRecentCommands(recent: readonly string[]): void {
  try {
    recentStore().save(recent);
  } catch {
    // 隐私模式 / 配额满：放弃本次记录，命令执行不受影响
    // （lib save 本身吞写错；这里兜的是后端解析阶段——访问 localStorage 抛错）
  }
}

/** 清空最近记录（测试隔离与用户语义上的「重置」；产品路径不调用）。 */
export function resetRecentCommands(): void {
  try {
    browserBackend()?.removeItem(STORAGE_KEY);
  } catch {
    // 同写入口径：静默
  }
}
