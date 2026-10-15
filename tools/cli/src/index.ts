/**
 * @dforge/cli —— CLI `df`（骨架占位）。
 *
 * 首批子命令（《技能市场规格 v1》口径）：df market collect | score | index | search。
 * 可执行入口见 bin/df.mjs；本文件承载命令表与参数解析，随采集票落地。
 */

/** CLI 名（占位导出）。 */
export const CLI_BIN_NAME = 'df' as const;

/** 首批子命令（占位导出，随实现票接入）。 */
export const CLI_MARKET_SUBCOMMANDS = ['collect', 'score', 'index', 'search'] as const;
