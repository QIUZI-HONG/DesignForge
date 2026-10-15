# 设界 · DesignForge

毕业设计：类 Figma 设计工作台（本地优先）。

**三条支柱**：本地真值（`.dfg` 目录态、可 Git diff、离线完整可用）· 受控 AI（自然语言 → Design IR → 双重校验 → 逐项 diff 审批 → 单事务 → 审计回放）· 数据飞轮（GitHub 技能大数据市场：采集 → 四层仓库 → 五维评分 → 混合检索 → 采纳回流）。

**AI 边界**：文本上云（DeepSeek，用户自带 key，可脱敏、可关闭）＋ 图像本地（ComfyUI，零出机、零成本、可复现）。

**接入**：MCP 双端——ZCode 与 WorkBuddy 读写同一份设计真值。

## 状态

起步中（P0）。寻路地图见 Issues 的 `wayfinder:map`；当前一段的目的地 = 前端对标 Figma 本体可验收 + 技能市场首个实现跑通。

## 历史

前置实现（M0–M3：在线协同画布 + AI 生成，12 条浏览器验收门禁全绿）冻结于 [`DesignForge-legacy`](https://github.com/QIUZI-HONG/DesignForge-legacy)，仅作历史参照。本项目全新自研（clean-room：只借公开可观测的产品结构与交互范式，不取用第三方源码与资产）。
