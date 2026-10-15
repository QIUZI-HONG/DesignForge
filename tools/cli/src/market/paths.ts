/**
 * 市场 CLI 数据面路径口径（`data/` 四层仓，规格《技能市场规格 v1》§4.1）。
 *
 * 目录布局：
 * ```
 * <data>/ods  raw_events/ · raw_snapshots/ · blobs/      # MK-01 + MK-02 规整
 * <data>/dwd  repo/asset/asset_file/license.parquet      # 规格 §4.2 Parquet
 * <data>/dws  asset_quality.jsonl · asset_facet.jsonl    # 评分与分类面（MK-03 + 本票 facets）
 * <data>/ads  df.marketplace.index.v1.json · market_search_index.v1.json
 * <data>/evidence/<runId>.json                            # 各命令证据 JSON
 * ```
 */

import { join } from 'node:path';

export interface DataPaths {
  root: string;
  ods: string;
  dwd: string;
  dws: string;
  ads: string;
  evidence: string;
  /** 命令证据 JSON 路径（`<data>/evidence/<runId>.json`）。 */
  evidenceFile: (runId: string) => string;
  /** DWS 质量行（JSONL）。 */
  qualityFile: string;
  /** DWS 分类面行（JSONL，本票产出）。 */
  facetFile: string;
  /** DWS 批次清单（计数与哈希）。 */
  dwsManifest: string;
}

/** 解析数据面根目录（缺省 `data`，相对当前工作目录）。 */
export function resolveDataPaths(root: string): DataPaths {
  return {
    root,
    ods: join(root, 'ods'),
    dwd: join(root, 'dwd'),
    dws: join(root, 'dws'),
    ads: join(root, 'ads'),
    evidence: join(root, 'evidence'),
    evidenceFile: (runId) => join(root, 'evidence', `${runId}.json`),
    qualityFile: join(root, 'dws', 'asset_quality.jsonl'),
    facetFile: join(root, 'dws', 'asset_facet.jsonl'),
    dwsManifest: join(root, 'dws', '_dws_manifest.json'),
  };
}
