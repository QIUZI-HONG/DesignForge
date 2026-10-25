# 09: fe · 效果渲染接入绘制管线

**What to build:** 投影/内阴影/层模糊在画布真实渲染（数据模型已备，解除渲染层「P0 明确不画」子集声明）；效果绘制纳入渲染观测通道计数。对照 Figma 本体做 B 级视觉等价人工验收。

**Blocked by:** 04

**Status:** ready-for-agent

blockers: 04

- [ ] 带效果节点在画布正确渲染（对照 Figma 本体视觉等价通过）
- [ ] P0 子集声明更新（效果不再列入不画清单）
- [ ] 观测通道计入效果绘制；描边对齐与离屏合成的取舍显式登记

## 登记补录（2026-10 修复批）

- **观测计数口径变更**：`counters.nodes += 1` 移入 `if (opacity > 0)`——`nodes` 语义从
  「本帧访问的节点数」变为「**实际绘制节点数**」（opacity=0 不计，零绘制不算「画了」）。
  同步位置：`draw-scene.ts` 头注释与 `SceneDrawCounters.nodes` 字段注记、
  `docs/quality/perf-baseline-v1.json` M7 recordOnly 注记（nodesDrawn 分母收窄，跨期比对须同口径）、
  `verify-perf.mjs` `computeClipRate` 语义注释。
- **滤镜缓存容量上限补齐**：`blurMaskFilter` 的 MaskFilter 缓存原为无上限 `Map.set`
  （wasm 堆泄漏面），已与 `cachedFilter` 同构改造为 256 容量 + 淘汰时显式 `delete()`；
  对抗用例（单帧 >256 不同签名：计划结构正确 + 淘汰路径真触发）见 `effects.test.ts`
  「滤镜缓存淘汰」组。代码完成，测试待 dev 机执行（本机无 node）。
