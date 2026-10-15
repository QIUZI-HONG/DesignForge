/**
 * 自设计页六态覆盖登记表（《前端验收标准 v1》§5/§6）。
 *
 * 真源是 `state-coverage.json`（纯数据，供 node 门禁 `scripts/verify-market.mjs` 直读，
 * 免得门禁解析 TS）；本模块只做类型化包装与查询。**纪律**：
 * - `marker` 必须是能在源码里逐字找到的字面量（门禁与单测双向断言，不允许「大概有」）；
 * - 由 `@dforge/ui` 基础件承担的态写 `delegatedTo`（附理由），**不得记成通过**；
 * - 缺任何一态即门禁失败（缺项 = 缺陷，验收标准 §5）。
 */

import coverage from './state-coverage.json';

/** 六态词表（与验收标准 §5 同序）。 */
export type CoverageState = 'hover' | 'active' | 'disabled' | 'loading' | 'empty' | 'error';

/** 单态登记。 */
export interface StateCoverageEntry {
  state: CoverageState;
  /** 可在源码中逐字断言的字面量（缺省表示由基础件承担/不适用）。 */
  marker?: string;
  /** 由谁承担（基础件）或不适用原因。 */
  delegatedTo?: string;
  /** 复现方式（截图门禁与人工复核用）。 */
  how: string;
}

/** 单页登记。 */
export interface PageCoverage {
  page: string;
  route: string;
  theme: 'light' | 'dark' | 'context';
  sourceFiles: string[];
  states: Record<CoverageState, StateCoverageEntry>;
}

/** 六态词表先声明（下面的归一化要用）。 */
export const COVERAGE_STATES = coverage.states as CoverageState[];

/**
 * 登记表（页序 = 清单 D 区）。
 * JSON 里 state 是**键**（避免同一份信息写两遍）；这里归一化成带 `state` 字段的条目，
 * 供调用方直接遍历（结构与 `StateCoverageEntry` 一致）。
 */
export const MARKET_STATE_COVERAGE: PageCoverage[] = coverage.pages.map((page) => ({
  page: page.page,
  route: page.route,
  theme: page.theme as PageCoverage['theme'],
  sourceFiles: page.sourceFiles,
  states: Object.fromEntries(
    COVERAGE_STATES.map((state) => {
      // 表由 JSON 提供，逐态宽松读取：缺条目时给「未登记」的保守默认（结构校验在测试与门禁里做）
      const entry = (
        page.states as Record<string, { marker?: string; delegatedTo?: string; how: string }>
      )[state] ?? { how: '未登记' };
      return [
        state,
        {
          state,
          ...(entry.marker === undefined ? {} : { marker: entry.marker }),
          ...(entry.delegatedTo === undefined ? {} : { delegatedTo: entry.delegatedTo }),
          how: entry.how,
        },
      ];
    }),
  ) as Record<CoverageState, StateCoverageEntry>,
}));

/** 取某页登记（不存在返回 null）。 */
export function coverageOf(page: string): PageCoverage | null {
  return MARKET_STATE_COVERAGE.find((entry) => entry.page === page) ?? null;
}

/** 未被基础件承担、需要源码字面量断言的态（门禁断言清单）。 */
export function declaredMarkers(): {
  page: string;
  state: CoverageState;
  marker: string;
  sourceFiles: string[];
}[] {
  const out: { page: string; state: CoverageState; marker: string; sourceFiles: string[] }[] = [];
  for (const page of MARKET_STATE_COVERAGE) {
    for (const state of COVERAGE_STATES) {
      const entry = page.states[state];
      if (entry.marker === undefined) continue;
      out.push({ page: page.page, state, marker: entry.marker, sourceFiles: page.sourceFiles });
    }
  }
  return out;
}
