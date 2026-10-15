# 设置族路由（FE-09 已落地）

- 归属票：**FE-09**（设置 + 引导 + 冷启动，清单 E3/E4/E6）。
- 口径：`docs/spec/page-inventory-v1.md`（清单 E 区）+ `docs/spec/frontend-impl-spec-v1.md` §三；
  自设计页验收走《前端验收标准 v1》§6（令牌一致性 / 六态覆盖 / 风格同族）。
- 页面本体在 `apps/web/src/features/settings/**`（数据面 / 模型层 / 组件），路由只做薄装配：

| 路由 | 清单 | 说明 |
|---|---|---|
| `/settings` | E3 | 设置页：左分区导航 + 右表单（工作目录 / DeepSeek / ComfyUI / 埋点与数据）；保存态（保存中 → 已保存 → 失败重试） |
| `/settings/onboarding` | E4 | 四步引导：当前步高亮 / 已完成勾选 / 可跳过；与设置分区同源（同一批表单组件） |
| `/settings/welcome` | E6 | 空库冷启动：空态 → 一键示例（daemon 建文档）→ 进入编辑器（`/editor?doc=<id>`） |

- 门禁：`node scripts/verify-self-designed.mjs`（令牌一致性 + 六态挂点 + 风格同族人工登记；FE-11 复用）。
- 主题：浅色首页族（根布局默认 `data-theme="light"`，验收标准 §3 逐页对齐）。
