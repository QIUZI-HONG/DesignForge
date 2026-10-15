/**
 * @dforge/ingest —— 采集线。
 *
 * 定位（术语表「采集线」）：GitHub 四类资产（Skill / Plugin / Design System / Template）
 * 采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 索引；首批独立可跑，不依赖编辑器。
 * 已落地：MK-01 采集器（`./collect/**`：候选发现 + 结构探针 + 内容校验 + 请求纪律 + ODS 落盘）。
 */

/** 服务标识（占位导出）。 */
export const INGEST_PACKAGE = '@dforge/ingest' as const;

/** 四层仓库名（占位导出，随采集票接入实现）。 */
export const INGEST_LAYERS = ['ods', 'dwd', 'dws', 'ads'] as const;

// MK-01 采集器公共 API（四层仓的后续层由 MK-02…MK-04 接管）。
export * from './collect/index.ts';
