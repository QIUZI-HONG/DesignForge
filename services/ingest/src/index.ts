/**
 * @dforge/ingest —— 采集线。
 *
 * 定位（术语表「采集线」）：GitHub 四类资产（Skill / Plugin / Design System / Template）
 * 采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 索引；首批独立可跑，不依赖编辑器。
 * 已落地：MK-01 采集器（`./collect/**`）· MK-02 规范化（`./transform/**`）· MK-04 索引与检索（`./index/**`）。
 */

/** 服务标识（占位导出）。 */
export const INGEST_PACKAGE = '@dforge/ingest' as const;

/** 四层仓库名（占位导出，随采集票接入实现）。 */
export const INGEST_LAYERS = ['ods', 'dwd', 'dws', 'ads'] as const;

// 采集线与索引公共 API（daemon/FE-11/MK-05 复用）。
export * from './collect/index.ts';
export * from './transform/index.ts';
export * from './index/index.ts';
