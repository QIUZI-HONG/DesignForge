/**
 * 首批真实批次的示例查询集（判据链第 5 环口径：《市场首实现》§4）。
 *
 * 口径：**≥10 条**逐条执行——每条 ≥1 结果、**≥5 条查询给出 ≥3 结果**；
 * 排序 = 质量分 × 相关度（可解释，`matchedTerms` 回填）。
 *
 * 与 MK-04 夹具查询集（`services/ingest/src/index/query-set.ts`，针对自造 DWS 夹具）的关系：
 * 本表是**真实批次版**（MK-04 头注释已预告「MK-03/MK-05 落地后换成真实批次时，本表随批次更新」），
 * 期望值只写「命中数下限」与「至少命中某个来源仓」——不写死资产 id（真实批次的资产集随采集变动）。
 */

export interface MarketExampleQuery {
  id: string;
  /** 查询串（中英术语等价类会把「PPT/幻灯片/deck」归一，规格 §6.2 D3）。 */
  q: string;
  /** 命中数下限（硬口径）。 */
  minHits: number;
  /** 命中结果中至少出现其一的来源仓（语义正确性；空 = 不校验）。 */
  expectAnyRepo?: readonly string[];
  note?: string;
}

export const MARKET_EXAMPLE_QUERIES: readonly MarketExampleQuery[] = [
  {
    id: 'skill-en',
    q: 'skill',
    minHits: 5,
    note: '四类主干词：技能类资产应大量命中',
  },
  {
    id: 'ppt-en',
    q: 'ppt',
    minHits: 8,
    expectAnyRepo: ['lewislulu/html-ppt-skill', 'zarazhangrui/beautiful-html-templates'],
    note: 'PPT/幻灯片/deck 等价类（规格 §6.2 D3 起步表）',
  },
  {
    id: 'slides-zh',
    q: '幻灯片',
    minHits: 3,
    note: '中文查询经等价类命中英文内容',
  },
  {
    id: 'deck-en',
    q: 'deck',
    minHits: 5,
  },
  {
    id: 'template-zh',
    q: '模板',
    minHits: 8,
    note: '模板 = 可复用任务起点（研究 #3 §4.2）',
  },
  {
    id: 'design-system-zh',
    q: '设计系统',
    minHits: 5,
    expectAnyRepo: ['nexu-io/open-design'],
  },
  {
    id: 'tokens-zh',
    q: '令牌',
    minHits: 3,
    note: '设计令牌：token/tokens 与中文等价',
  },
  {
    id: 'mcp-en',
    q: 'mcp',
    minHits: 3,
    note: '连接器（MCP）证据词',
  },
  {
    id: 'plugin-en',
    q: 'plugin',
    minHits: 3,
  },
  {
    id: 'icon-zh',
    q: '图标',
    minHits: 2,
  },
  {
    id: 'poster-zh',
    q: '海报',
    minHits: 2,
  },
  {
    id: 'animation-zh',
    q: '动效',
    minHits: 2,
  },
  {
    id: 'color-zh',
    q: '配色',
    minHits: 2,
  },
  {
    id: 'html-en',
    q: 'html',
    minHits: 5,
  },
  {
    id: 'figma-en',
    q: 'figma',
    minHits: 2,
    note: '设计工具生态词（含候选里的 figma-plugin 类）',
  },
];

/** 判据硬口径（规格《市场首实现》§4 第 5 环）。 */
export const QUERY_SET_MIN_TOTAL = 10;
export const QUERY_SET_MIN_QUERIES_WITH_3 = 5;
