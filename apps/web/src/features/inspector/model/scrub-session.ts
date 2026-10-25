/**
 * scrubbing 交互会话（RW-10 ·「数值 scrubbing 全接入」的会话层）。
 *
 * 口径（工单 10 交付 b）：`onScrubStart/End` 接**引擎 interaction 会话语义**——
 * 与画布拖拽（`beginInteraction` → `updateInteraction` × N → `commitInteraction`）同构：
 * - **拖拽中不写文档**：数值只落在控件草稿（`useDraftCommit` 的 `setDraftLive`）；
 * - **松手单事务提交**：整段修改表达为一次 `CommandStack.dispatch`（一条历史条目，
 *   撤销一步回退——与画布拖拽的撤销粒度一致）。
 *
 * 为什么不直接复用引擎 reducer：interaction 状态机只建模画布几何拖拽
 * （move/resize/rotate/marquee/pan），间距/圆角/不透明度这类标量 scrub 没有对应交互态；
 * 本控制器承接同一条**会话纪律**，提交仍走命令栈唯一写入口（不绕过、不复制状态机）。
 *
 * 键入路径（键盘步进 / 300ms debounce / Enter / blur）不经过会话括约：
 * `commit` 在未开会话时等价于普通提交，面板无需分叉两条提交路径。
 */

import type { Command, CommandStack } from '@dforge/engine';

/** scrubbing 交互会话。 */
export interface ScrubSession {
  /** 开启会话（拖拽把手 pointerdown 时调用；未收口即重开是编程错误）。 */
  begin(): void;
  /**
   * 提交一次事务并闭会话（松手时调用）。
   * 会话开启中 = 单事务收口本段拖拽；未开会话 = 普通提交（键入路径）。
   * 空命令不写历史（引擎侧跳过，无「空编辑」条目）。
   */
  commit(commands: readonly Command[], label: string): void;
  /** 关会话（值未变化即松手 / Esc 取消）；零写入，幂等。 */
  end(): void;
  /** 会话是否开启（拖拽中）。 */
  readonly active: boolean;
}

/** 创建绑定命令栈的 scrubbing 会话。 */
export function createScrubSession(stack: CommandStack): ScrubSession {
  let isActive = false;

  return {
    begin() {
      if (isActive) {
        throw new Error('scrub 会话未收口即重开（onScrubStart/End 必须成对）');
      }
      isActive = true;
    },
    commit(commands, label) {
      isActive = false;
      if (commands.length === 0) return;
      stack.dispatch(commands, { label });
    },
    end() {
      isActive = false;
    },
    get active() {
      return isActive;
    },
  };
}
