/**
 * 示例查询集（MK-04 判据链第 5 环：《市场首实现》§4）。
 *
 * 口径：**≥10 条**逐条执行——每条 ≥1 结果、**≥5 条查询给出 ≥3 结果**；
 * 断言分三层（快照另记排序全貌）：
 * - `minHits`：命中数下限（判据硬口径）；
 * - `mustInclude`：语义正确性——该查询「应当命中」的资产 id（人写的期望，非实现回推）；
 * - `topWithin`：Top-1 必须落在候选集合内（排序合理性，容忍质量分接近的并列）。
 *
 * 资产 id 取自自造 DWS 夹具（`__fixtures__/dws-assets.sample.json`）；MK-03/MK-05 落地后
 * 换成真实批次时，本表随批次更新（评审入口：改期望值 = 改口径，需在报告声明）。
 */

/** 与 `MarketQueryParams`（contracts）同族的过滤面。 */
export interface ExampleQueryFilters {
  kinds?: readonly string[];
  category?: string;
  lane?: string;
  scene?: string;
  tags?: readonly string[];
  loadableOnly?: boolean;
}

/** 一条示例查询。 */
export interface ExampleQuery {
  id: string;
  q: string;
  filters?: ExampleQueryFilters;
  /** 命中数下限（≥1）。 */
  minHits: number;
  /** 必须命中的资产 id。 */
  mustInclude?: readonly string[];
  /** Top-1 必须属于该集合。 */
  topWithin?: readonly string[];
}

const DECK_MODERN = 'gh:zarazhangrui/beautiful-html-templates#templates/deck-modern';
const DECK_STARTUP = 'gh:zarazhangrui/beautiful-html-templates#templates/deck-startup';
const HTML_PPT = 'gh:lewislulu/html-ppt-skill#';
const PPTX = 'gh:anthropics/skills#skills/pptx';
const PDF = 'gh:anthropics/skills#skills/pdf';
const LUMEN = 'gh:nexu-io/open-design#design-system/lumen';
const CORE_TOKENS = 'gh:acme-ui/tokens-starter#tokens/core';
const SEMI_TOKENS = 'gh:semi-design-group/semi-design-tokens#packages/tokens';
const ICON_FORGE = 'gh:MiniMax-AI/skills#skills/icon-forge';
const ANIM = 'gh:greensock/gsap-skills#skills/gsap-animate';
const CHART = 'gh:acme-labs/df-plugin-charts#';
const TASTE = 'gh:Leonxlnx/taste-skill#';
const A11Y = 'gh:veniceai/skills#skills/a11y-check';
const POSTER = 'gh:nexu-io/html-anything#templates/poster-launch';
const MOBILE = 'gh:fal-ai-community/skills#templates/mobile-app-kit';

/** 示例查询表（15 条；其中 ≥7 条预期 ≥3 命中）。 */
export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  {
    id: 'ppt-en',
    q: 'ppt',
    minHits: 3,
    mustInclude: [PPTX, HTML_PPT, DECK_MODERN],
    topWithin: [PPTX, HTML_PPT, DECK_MODERN],
  },
  {
    id: 'slides-zh',
    q: '幻灯片模板',
    minHits: 3,
    mustInclude: [DECK_MODERN, DECK_STARTUP],
    topWithin: [DECK_MODERN, DECK_STARTUP],
  },
  {
    id: 'deck-en',
    q: 'deck',
    minHits: 3,
    mustInclude: [DECK_MODERN, DECK_STARTUP],
    topWithin: [DECK_MODERN, DECK_STARTUP, HTML_PPT],
  },
  {
    id: 'design-system-zh',
    q: '设计系统',
    minHits: 2,
    mustInclude: [LUMEN, CORE_TOKENS],
    topWithin: [LUMEN, CORE_TOKENS],
  },
  {
    id: 'design-system-en',
    q: 'design system',
    minHits: 2,
    mustInclude: [LUMEN],
    topWithin: [LUMEN, CORE_TOKENS, SEMI_TOKENS],
  },
  {
    id: 'icon-zh',
    q: '图标',
    minHits: 2,
    mustInclude: [ICON_FORGE],
    topWithin: [ICON_FORGE, LUMEN],
  },
  {
    id: 'pdf',
    q: 'pdf',
    minHits: 1,
    mustInclude: [PDF],
    topWithin: [PDF],
  },
  {
    id: 'export-zh',
    q: '导出一份 PDF',
    minHits: 2,
    mustInclude: [PDF],
    topWithin: [PDF],
  },
  {
    id: 'motion-zh',
    q: '动效',
    minHits: 2,
    mustInclude: [ANIM],
    topWithin: [ANIM],
  },
  {
    id: 'chart-en',
    q: 'chart',
    minHits: 2,
    mustInclude: [CHART],
    topWithin: [CHART, SEMI_TOKENS],
  },
  {
    id: 'palette-zh',
    q: '配色',
    minHits: 2,
    mustInclude: [TASTE, CORE_TOKENS],
    topWithin: [TASTE, CORE_TOKENS, LUMEN],
  },
  {
    id: 'prototype-zh',
    q: '原型',
    minHits: 1,
    mustInclude: [MOBILE],
    topWithin: [MOBILE],
  },
  {
    id: 'template-zh',
    q: '模板',
    minHits: 3,
    mustInclude: [DECK_MODERN, POSTER, MOBILE],
    topWithin: [DECK_MODERN, POSTER, DECK_STARTUP],
  },
  {
    id: 'mobile-zh',
    q: '移动端',
    minHits: 1,
    mustInclude: [MOBILE],
    topWithin: [MOBILE],
  },
  {
    id: 'a11y-zh',
    q: '无障碍',
    minHits: 1,
    mustInclude: [A11Y],
    topWithin: [A11Y],
  },
];
