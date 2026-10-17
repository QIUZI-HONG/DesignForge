/**
 * 违规夹具④（guard-vocab）：类型别名写死字面量联合——类型层词表同样会漂移，
 * 必须 exit 1 且点名 AssetKind。
 */
export type AssetKind = 'skill' | 'plugin' | 'design-system' | 'template';
