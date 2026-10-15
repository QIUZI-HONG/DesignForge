// @vitest-environment node
/**
 * 六态覆盖登记表测试（接缝：`state-coverage` 与真实源码文件的一致性）。
 *
 * 这一层保证「挂点不是写在登记表里的空话」：每个声明的 marker 必须**逐字出现在**其声明的
 * 源文件里（读真实文件，不 mock）。门禁脚本 `scripts/verify-market.mjs` 对同一份 JSON 再断言一次
 * （双保险：单测跑实现，门禁跑仓库面）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_STATES,
  coverageOf,
  declaredMarkers,
  MARKET_STATE_COVERAGE,
} from './state-coverage';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('六态覆盖登记表 · 结构', () => {
  it('D1–D6 逐页登记，且每页六态齐备（缺项即缺陷，验收 §5）', () => {
    expect(MARKET_STATE_COVERAGE.map((page) => page.page)).toEqual([
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
      'D6',
    ]);
    for (const page of MARKET_STATE_COVERAGE) {
      for (const state of COVERAGE_STATES) {
        const entry = page.states[state];
        expect(entry, `${page.page} 缺态：${state}`).toBeTruthy();
        expect(entry.state).toBe(state);
        expect(entry.how.length).toBeGreaterThan(0);
      }
      expect(page.sourceFiles.length).toBeGreaterThan(0);
    }
  });

  it('每态要么有 marker，要么写明 delegatedTo 理由（不得两者皆空）', () => {
    for (const page of MARKET_STATE_COVERAGE) {
      for (const state of COVERAGE_STATES) {
        const entry = page.states[state];
        const hasMarker = entry.marker !== undefined;
        const hasDelegation = entry.delegatedTo !== undefined && entry.delegatedTo.length > 0;
        expect(
          hasMarker || hasDelegation,
          `${page.page}.${state} 既无 marker 也无 delegatedTo`,
        ).toBe(true);
      }
    }
  });

  it('theme 与清单口径一致（D1–D3/D6 浅色、D5 深色、D4 随上下文）', () => {
    expect(coverageOf('D1')?.theme).toBe('light');
    expect(coverageOf('D5')?.theme).toBe('dark');
    expect(coverageOf('D4')?.theme).toBe('context');
    expect(coverageOf('D6')?.theme).toBe('light');
    expect(coverageOf('D9')).toBeNull();
  });
});

describe('六态覆盖登记表 · 与源码逐字一致（挂点真实存在）', () => {
  it('每个 marker 都能在被声明的源文件里找到', () => {
    const missing: string[] = [];
    for (const item of declaredMarkers()) {
      const hit = item.sourceFiles.some((file) => {
        try {
          return readFileSync(join(repoRoot, file), 'utf8').includes(item.marker);
        } catch {
          return false;
        }
      });
      if (!hit)
        missing.push(
          `${item.page}/${item.state} 的 marker 不在 ${item.sourceFiles.join(', ')}：${item.marker}`,
        );
    }
    expect(missing).toEqual([]);
  });

  it('声明的源文件都真实存在（防止登记表指向幽灵路径）', () => {
    for (const page of MARKET_STATE_COVERAGE) {
      for (const file of page.sourceFiles) {
        expect(
          () => readFileSync(join(repoRoot, file), 'utf8'),
          `${page.page} 源文件缺失：${file}`,
        ).not.toThrow();
      }
    }
  });
});
