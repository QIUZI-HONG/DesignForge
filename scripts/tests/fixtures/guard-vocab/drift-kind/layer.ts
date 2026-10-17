/**
 * 违规夹具①（guard-vocab）：kind 词表在层内写死——还夹带近似拼写 `design-systems`，
 * 这正是层间漂移的典型形态，必须 exit 1 且点名 ASSET_KINDS。
 */
export const ASSET_KINDS = ['skill', 'plugin', 'design-systems', 'template'] as const;
