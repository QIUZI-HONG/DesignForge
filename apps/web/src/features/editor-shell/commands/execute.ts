/**
 * 命令执行的统一入口（命令面板与全局快捷键共用）。
 *
 * 为什么统一：命令是**跨票代码**（FE-06/07/08 各自注册），执行失败不能只靠 `console`——
 * 面板要就地显示失败态（验收标准 §5 的 error 态挂点），全局快捷键路径没有 UI 宿主，
 * 只能落控制台。两条路径在这里收口，语义一致：**失败不冒泡到 React 渲染树**。
 */
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

/**
 * 执行命令并收口错误。
 *
 * @param id 命令 id
 * @returns 结局（`unavailable` 与 `failed` 区分：前者是灰化态，后者要报错）
 */
export async function executeCommand(id: string): Promise<CommandRunResult> {
  try {
    const ran = await runCommand(id);
    return ran ? { status: 'ran' } : { status: 'unavailable' };
  } catch (error) {
    console.error(`[editor-shell] 命令执行失败：${id}`, error);
    return { status: 'failed', error };
  }
}
