/**
 * @dforge/ingest —— 采集线（骨架占位）。
 *
 * 定位（术语表「采集线」）：GitHub 四类资产（Skill / Plugin / Design System / Template）
 * 采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 索引；首批独立可跑，不依赖编辑器。
 * 接管票：《技能市场规格 v1》对应实现票。
 */

/** 服务标识（占位导出）。 */
export const INGEST_PACKAGE = '@dforge/ingest' as const;

/** 四层仓库名（占位导出，随采集票接入实现）。 */
export const INGEST_LAYERS = ['ods', 'dwd', 'dws', 'ads'] as const;
