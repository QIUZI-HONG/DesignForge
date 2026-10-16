# 技能市场路由（FE-11 已实现）

「技能市场」的 App Router 落点（自设计页，清单 D 区）。归属票 **FE-11**；
口径以《技能市场规格 v1》§6（逐页口径）与 §7（装载边界）为准，验收走《前端验收标准 v1》§6 三类检查。

## 路由与页面

| 路由 | 页面 | 主题 | 说明 |
|---|---|---|---|
| `/market` | **D1 + D3** 市场首页（发现/精选/分类 + 搜索筛选） | 浅色 | 卡片网格 + 筛选栏 + 悬停抬升 + 中英双语卡片；空态/加载/错误/部分失败齐 |
| `/market/[assetId]` | **D2** 资源详情 + **D4** 装载确认 | 浅色（确认框随上下文） | 左预览右信息 + 五维雷达 + 扣分原因 + 安装三态；装载走 dryRun → 一次性 token → 单事务写入 |
| `/market/panel` | **D5** 编辑器内市场面板 | 深色（UI3） | 面板列表 + 详情 + 试跑（dryRun 无副作用）+ 采纳本地计数 |
| `/dashboard` | **D6** 数据看板 | 浅色 | 采集进度 / 四层状态 / 质量三看板（完整性·一致性·时效性） |

- `assetId` 形如 `gh:owner/repo#path`，路由段用 `encodeURIComponent` 编码，页面**防御式解码**。
- **段级错误边界**：`error.tsx` 把 `/market` 段的渲染期未预期异常收敛为可见错误态
  （六态之一的 error 挂点 + 重试），不留白屏；数据面的坏形状另在解包点归一为带码失败
  （见 `features/market/api.ts` 的形状校验器）。
- **D5 挂点说明**：编辑器壳层（FE-03）未并入集成分支前，面板以独立深色路由完整呈现
  （进入时把 `document.documentElement.dataset.theme` 切到 `dark`，离开恢复）；壳层落地后
  由壳层持有主题并直接把 `MarketPanel` 挂进右栏。

## 数据口径

- 唯一取数入口 = daemon `/market`（`marketQuery` / `marketAsset` / `marketLoadPlan`）：
  客户端与 hook 在 `src/features/market/{api,use-market}.ts`。
- **索引缺失/损坏 → 空态**（给 `df market collect|score|index` 指引）——**绝不伪造数据**；
  无结果 → 空态（清空筛选）；daemon 不可达 → 错误态（重试）。
- 客户端补充过滤（许可档 / 来源仓库 / 已装载 / 精选）作用在**当前结果页**上，页面显式声明该口径。
- 本地装载记录（`localStorage`）与回流计数（试跑/采纳）是**本地真值**，页面标注「本地计数」。

## 门禁

- `node scripts/verify-market.mjs`：令牌一致性（`guard-tokens` 同源核心）→ 六态覆盖挂点
  （`state-coverage.json` 的 marker 逐字命中源码）→ daemon `/market` 可判定；
  **索引缺失/daemon 不可达 → `exit 2` 阻塞**（禁止假绿），风格同族按 B 级人工登记。
- 六态登记表：`src/features/market/state-coverage.json`（D1–D6 逐页 × 六态，
  基础件承担的态记 `delegatedTo` 并进人工复核清单，不登记为通过）。
