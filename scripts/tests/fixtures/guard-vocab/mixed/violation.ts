/**
 * 混合夹具（guard-vocab）：**违规 + 未判定并存**——kind 词表写死字面量（违规）。
 * 用途：钉住「exit 1 优先于 2，但两类问题在日志里必须同时列出」的口径（阻塞信息不得被吞）。
 */
export const ASSET_KINDS = ['skill', 'plugin', 'design-system', 'template'] as const;
