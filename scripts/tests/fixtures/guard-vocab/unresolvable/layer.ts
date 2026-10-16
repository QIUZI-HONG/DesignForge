/**
 * 阻塞夹具（guard-vocab）：初始化表达式是函数调用，静态判不出根在哪——按门禁纪律
 * 记「阻塞」（exit 2），既不放行也不误报违规。
 */
declare function loadKindsFromEnv(): readonly string[];

export const KINDS = loadKindsFromEnv();
