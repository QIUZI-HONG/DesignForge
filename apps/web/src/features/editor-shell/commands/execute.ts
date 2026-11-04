/**
 * 命令执行的统一入口（命令面板与全局快捷键共用）。
 *
 * 为什么统一：命令是**跨票代码**（FE-06/07/08 各自注册），执行失败不能只靠 `console`——
 * 面板要就地显示失败态（验收标准 §5 的 error 态挂点），全局快捷键路径没有 UI 宿主，
 * 只能落控制台。两条路径在这里收口，语义一致：**失败不冒泡到 React 渲染树**。
 */
import { loadRecentCommands, recordRecentCommand, saveRecentCommands } from './recent';
import { runCommand } from './registry';

/** 一次执行的结局。 */
export type CommandRunStatus =
  /** 执行完成（含异步结算）。 */
  | 'ran'
  /** 未注册或 `enabled()` 判否——不是错误，是「此刻不可用」。 */
  | 'unavailable'
  /** 执行体抛错。 */
  | 'failed';

/** 执行结果。 */
export interface CommandRunResult {
  status: CommandRunStatus;
  /** 失败原因（`status === 'failed'` 时给出）。 */
  error?: unknown;
}

/** 面板开关命令 id（呼出面板是「容器」交互，不进最近记录）。 */
const PALETTE_TOGGLE_ID = 'view.commandPalette';

/**
 * 执行命令并收口错误。
 *
 * 执行成功（`ran`）即记入「最近执行」本地记录（票 04 · spec P0-4「最近使用」的数据层，
 * 见 `./recent`）：全部执行路径（面板 / 全局快捷键 / 菜单 / 工具条）都经本函数，
 * 记录口径只有这一份。记录失败不影响执行结果本身。
 *
 * @param id 命令 id
 * @returns 结局（`unavailable` 与 `failed` 区分：前者是灰化态，后者要报错）
 */
export async function executeCommand(id: string): Promise<CommandRunResult> {
  try {
    const ran = await runCommand(id);
    if (!ran) return { status: 'unavailable' };
    if (id !== PALETTE_TOGGLE_ID) {
      // 面板开关本身不记（每次 ⌘K 都会把「命令面板」顶到最近序，纯噪声）
      saveRecentCommands(recordRecentCommand(loadRecentCommands(), id));
    }
    return { status: 'ran' };
  } catch (error) {
    console.error(`[editor-shell] 命令执行失败：${id}`, error);
    return { status: 'failed', error };
  }
}
