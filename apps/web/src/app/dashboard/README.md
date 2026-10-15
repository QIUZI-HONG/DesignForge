# 数据看板路由（FE-11 · D6）

数据看板（自设计页，清单 D6）。归属票 **FE-11**；口径见《技能市场规格 v1》§6.2 与
架构 v1.1 §7.6（采集进度 / 四层状态 / 质量三看板）。

- 路由 `/dashboard`（浅色首页族）；取数走 daemon `/market/query`（`limit=200` 取尽量全的样本）。
- 指标算法在 `src/features/dashboard/metrics.ts`（纯函数 + 单测）：完整性 = 逐字段缺失率；
  一致性 = 重复 id / 重复 digest / 孤儿引用；时效性 = 按 `source.pushedAt` 的 30/90/365 天分档 + 索引年龄。
- **不猜纪律**：算不出的项（如批次 runId、ODS 水位——`/market/query` 不返回 `index.collector`）
  显式标「未上报」并给出原因，不填 0 冒充真值；判红绿阈值待 MK 定稿（规格 §9.11），此处只给数值。
- 门禁：`node scripts/verify-market.mjs`（daemon 无索引 → `exit 2` 阻塞）。
