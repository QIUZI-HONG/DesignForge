/**
 * @dforge/ingest —— 采集线。
 *
 * 定位（术语表「采集线」）：GitHub 四类资产（Skill / Plugin / Design System / Template）
 * 采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 索引；首批独立可跑，不依赖编辑器。
 * 已落地：MK-01 采集器（`./collect/**`）· MK-02 规范化（`./transform/**`）·
 * MK-03 五维评分（`./score/**`）· MK-04 索引与检索（`./index/**`）。
 *
 * **导出面约定**（集成期裁决）：四层各自维护自己的公共 API，层与层之间存在同名符号
 * （`AssetKind` / `LicenseGate` / `Evidence*` / `sha256Hex` / `RawEvent` 等，六票并行落地期的
 * 词表镜像），故根入口以**命名空间**导出四层，消费方写 `score.aggregateBatch(...)`、
 * `ads.validateMarketplaceIndex(...)`；层内相对导入不受影响。
 *
 * 集成债（登记在案，归 MK-05 收口）：层间重复词表应下沉到共享模块（或并入 `@dforge/contracts`），
 * 届时根入口可退化为直出（`export * from './<层>/index.ts'`）。
 */

/** 服务标识。 */
export const INGEST_PACKAGE = '@dforge/ingest' as const;

/** 四层仓库名（ODS → DWD → DWS → ADS）。 */
export const INGEST_LAYERS = ['ods', 'dwd', 'dws', 'ads'] as const;

// ODS 层：采集器（候选发现 / 结构探针 / 内容校验 / 请求纪律 / ODS 落盘）
export * as collect from './collect/index.ts';
// ADS 层：索引与检索（`df.marketplace.index/v1` 产出与查询）
export * as ads from './index/index.ts';

// DWS 层：五维评分与可解释输出
export * as score from './score/index.ts';
// DWD 层：规范化与四层仓落盘（ODS → DWD）
export * as transform from './transform/index.ts';
