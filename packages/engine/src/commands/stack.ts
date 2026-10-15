/**
 * 命令栈 —— **文档变更的唯一入口**（架构 v1.1 §4.1）。
 *
 * 不变式：
 * 1. 除本栈之外没有第二条路径能改变「当前文档」——`scene/mutate` 是纯函数，
 *    外部拿到的文档是只读快照（可选深冻结，任何就地写入都会抛错）；
 * 2. 事务原子：一组命令要么全部生效，要么文档完全不变（失败不留半成品）；
 * 3. 撤销/重做往返恒等：`undo` 后再 `redo` 得到逐字段相同的文档；
 * 4. 微任务结算：`enqueue` 收集的写入在微任务里合并为**一个**事务（拖拽期间的高频写入
 *    不会把历史栈打爆），`flush` 可显式结算。
 *
 * 与 React 的接法（文档状态不进 React state）：`getSnapshot()` + `subscribe()`
 * 直接喂给 `useSyncExternalStore`。
 */

import type { DesignDocument } from '../model/index';
import { DomainError, type DomainErrorCode, isDomainError } from '../scene/errors';
import { deepFreezeDocument } from '../scene/validate';
import { applyCommand } from './apply';
import type { Command, HistoryEntry, Transaction } from './types';

/** 命令/事务错误：包住领域错误并记录失败位置；**文档保持不变**。 */
export class CommandError extends Error {
  readonly code: DomainErrorCode | 'transaction-failed';
  /** 事务内失败命令的下标（-1 = 非命令阶段失败）。 */
  readonly commandIndex: number;
  override readonly cause: unknown;

  constructor(
    code: DomainErrorCode | 'transaction-failed',
    message: string,
    commandIndex: number,
    cause: unknown,
  ) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.commandIndex = commandIndex;
    this.cause = cause;
  }
}

/** 判别命令错误。 */
export function isCommandError(error: unknown): error is CommandError {
  return error instanceof CommandError;
}

/** 命令栈构造选项。 */
export interface CommandStackOptions {
  /** 深冻结每份产出的文档（开发/测试开；用于逮住绕过命令栈的就地写入）。 */
  freeze?: boolean;
  /** 历史栈上限（默认 200 条事务）。 */
  historyLimit?: number;
  /** 微任务结算失败时的回调（默认吞掉但记录到 `lastError`）。 */
  onError?: (error: unknown) => void;
}

/** 派发选项。 */
export interface DispatchOptions {
  /** 历史条目名（撤销菜单显示）。 */
  label?: string;
}

/** 历史栈快照（撤销菜单/调试用）。 */
export interface HistorySnapshot {
  undo: string[];
  redo: string[];
}

/** 命令栈。 */
export class CommandStack {
  #document: DesignDocument;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<(doc: DesignDocument) => void>();
  #pending: Command[] = [];
  #pendingLabel: string | undefined;
  #microtaskScheduled = false;
  #lastError: unknown = null;
  #freeze: boolean;
  #historyLimit: number;
  #onError: ((error: unknown) => void) | undefined;

  constructor(document: DesignDocument, options: CommandStackOptions = {}) {
    this.#freeze = options.freeze ?? false;
    this.#historyLimit = options.historyLimit ?? 200;
    this.#onError = options.onError;
    this.#document = this.#freeze ? deepFreezeDocument(document) : document;
  }

  /** 当前文档（只读语义：请勿就地修改）。 */
  get document(): DesignDocument {
    return this.#document;
  }

  /** `useSyncExternalStore` 的取快照函数。 */
  getSnapshot(): DesignDocument {
    return this.#document;
  }

  /** 订阅文档变更；返回退订函数。 */
  subscribe(listener: (doc: DesignDocument) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 同步结算一次事务（命门：写操作唯一入口）。 */
  dispatch(commands: Command | readonly Command[], options: DispatchOptions = {}): DesignDocument {
    const list = Array.isArray(commands)
      ? [...(commands as readonly Command[])]
      : [commands as Command];
    if (list.length === 0) return this.#document;

    let next = this.#document;
    const inverse: Command[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const command = list[index] as Command;
      try {
        const result = applyCommand(next, command);
        next = result.document;
        // 逆命令按「后进先出」累积：先撤销最后施加的命令
        inverse.unshift(...result.inverse);
      } catch (error) {
        // 事务原子性：失败即整体不生效（局部变量丢弃，文档保持不变）
        throw toCommandError(error, index, command);
      }
    }

    this.#document = this.#freeze ? deepFreezeDocument(next) : next;
    this.#pushHistory({ label: options.label ?? '编辑', commands: list, inverse });
    this.#emit();
    return this.#document;
  }

  /** 事务形式（与 `dispatch` 等价，语义更显式）。 */
  apply(transaction: Transaction): DesignDocument {
    const label = transaction.label;
    return this.dispatch(transaction.commands, label === undefined ? {} : { label });
  }

  /**
   * 微任务结算：把命令追加进待结算队列，并在**本微任务结束时**合并为一个事务提交。
   * 拖拽/连续输入场景用它避免每次 pointermove 都产生一条历史。
   */
  enqueue(commands: Command | readonly Command[], options: DispatchOptions = {}): void {
    const list = Array.isArray(commands) ? (commands as readonly Command[]) : [commands as Command];
    if (list.length === 0) return;
    for (const command of list) this.#pending.push(command);
    if (options.label !== undefined) this.#pendingLabel = options.label;
    if (this.#microtaskScheduled) return;
    this.#microtaskScheduled = true;
    queueMicrotask(() => {
      try {
        this.flush();
      } catch (error) {
        this.#lastError = error;
        this.#onError?.(error);
      }
    });
  }

  /** 立即结算待提交队列（错误上抛）。 */
  flush(): DesignDocument {
    if (this.#pending.length === 0) {
      this.#microtaskScheduled = false;
      return this.#document;
    }
    const pending = this.#pending;
    const label = this.#pendingLabel;
    this.#pending = [];
    this.#pendingLabel = undefined;
    this.#microtaskScheduled = false;
    return this.dispatch(pending, label === undefined ? {} : { label });
  }

  /** 待结算命令条数。 */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** 最近一次微任务结算的错误（无错误为 null）。 */
  get lastError(): unknown {
    return this.#lastError;
  }

  /** 是否可撤销。 */
  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  /** 是否可重做。 */
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** 撤销（无历史时返回 false 且文档不变）。 */
  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#document = this.#applyList(entry.inverse);
    this.#redo.push(entry);
    this.#emit();
    return true;
  }

  /** 重做。 */
  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#document = this.#applyList(entry.commands);
    this.#undo.push(entry);
    this.#emit();
    return true;
  }

  /** 历史栈概览（撤销/重做菜单用）。 */
  history(): HistorySnapshot {
    return {
      undo: this.#undo.map((entry) => entry.label),
      redo: this.#redo.map((entry) => entry.label),
    };
  }

  /** 清空历史（不改变文档）。 */
  clearHistory(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /** 施加一串命令（撤销/重做内部路径：不新增历史）。 */
  #applyList(commands: readonly Command[]): DesignDocument {
    let next = this.#document;
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index] as Command;
      try {
        next = applyCommand(next, command).document;
      } catch (error) {
        throw toCommandError(error, index, command);
      }
    }
    return this.#freeze ? deepFreezeDocument(next) : next;
  }

  #pushHistory(entry: HistoryEntry): void {
    this.#undo.push(entry);
    if (this.#undo.length > this.#historyLimit) this.#undo.shift();
    this.#redo = [];
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#document);
  }
}

/** 领域错误 → 命令错误（保留错误码，标注失败位置）。 */
function toCommandError(error: unknown, index: number, command: Command): CommandError {
  if (isCommandError(error)) return error;
  if (isDomainError(error)) {
    return new CommandError(
      error.code,
      `${error.message}（命令 #${index} ${command.type}）`,
      index,
      error,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CommandError(
    'transaction-failed',
    `${message}（命令 #${index} ${command.type}）`,
    index,
    error,
  );
}

/** 类型收窄辅助（测试与上层断言用）。 */
export function asDomainError(error: unknown): DomainError | null {
  return error instanceof DomainError ? error : null;
}
