/**
 * @dforge/engine —— 编辑器内核（骨架占位，纯 TS、零 DOM）。
 *
 * 定位：场景图 / 命令栈 / 布局 / 组件 / Token / 命中；文档真值归 engine（不进 React state），
 * 写操作唯一入口 = 命令栈，微任务结算。接管票：FE-06（画布与编辑行为，13 类交互白名单）。
 * 硬约束：本包不得引入任何浏览器/DOM 依赖（引擎测试在包内跑，无浏览器依赖）。
 */

/** 包标识（占位导出）。 */
export const ENGINE_PACKAGE = '@dforge/engine' as const;
