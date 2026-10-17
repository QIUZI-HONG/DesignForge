/**
 * 混合夹具（guard-vocab）：**违规 + 未判定并存**——初始化表达式是函数调用，静态判不出根
 * （记「未判定」）。与同目录 `violation.ts` 一起运行时：退出码取 1（违规优先），
 * 但日志必须把本文件的「未判定」明细一并列出。
 */
declare function loadKindsFromEnv(): readonly string[];

export const KINDS = loadKindsFromEnv();
