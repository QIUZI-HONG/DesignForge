/**
 * @dforge/ingest —— 采集线。
 *
 * 定位（术语表「采集线」）：GitHub 四类资产（Skill / Plugin / Design System / Template）
 * 采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 索引；首批独立可跑，不依赖编辑器。
 * 已落地：MK-03 五维评分（`./score/**`：五维信号 + 扣分原因码 + DWS 层产物 + 证据 JSON）。
 * 已落地：MK-04 索引与检索（`./index/**`：ADS 产物 + schema 校验器 + BM25 检索）。
 */

/** 服务标识（占位导出）。 */
export const INGEST_PACKAGE = '@dforge/ingest' as const;

/** 四层仓库名（占位导出，随采集票接入实现）。 */
export const INGEST_LAYERS = ['ods', 'dwd', 'dws', 'ads'] as const;

// MK-03 评分公共 API（DWD 输入契约、五维评分、DWS 产物与 ADS `quality` 投影）。
export * from './score/index.ts';

// MK-04 索引与检索公共 API（daemon/FE-11/MK-05 复用：`validateMarketplaceIndex` 等）。
export * from './index/index.ts';
