/**
 * 状态族登记表测试（「逐项打勾」的机器校验）。
 *
 * 断言：族号名单齐备（F1/F2/F3/F11–F15）、承载组件真的从包入口可解析、
 * 六态被各族覆盖（验收标准 §5：缺项 = 缺陷）。
 */
import { describe, expect, it } from 'vitest';

import * as UI from './index';
import { INTERACTION_STATES, STATE_FAMILIES } from './state-families';

describe('状态族登记表', () => {
  it('族号名单与票面范围一致（F1/F2/F3/F11–F15）', () => {
    expect(STATE_FAMILIES.map((family) => family.id)).toEqual([
      'F1',
      'F2',
      'F3',
      'F11',
      'F12',
      'F13',
      'F14',
      'F15',
    ]);
  });

  it('每族都登记了承载组件与归属票', () => {
    for (const family of STATE_FAMILIES) {
      expect(family.components.length, `${family.id} 未登记组件`).toBeGreaterThan(0);
      expect(family.owner.length, `${family.id} 未登记归属`).toBeGreaterThan(0);
      expect(family.states.length, `${family.id} 未登记状态`).toBeGreaterThan(0);
    }
  });

  it('承载组件都能从包入口取到（防止登记表与实现脱节）', () => {
    const exported = new Set(Object.keys(UI));
    const missing = STATE_FAMILIES.flatMap((family) =>
      family.components.filter((component) => !exported.has(component)),
    );
    expect(missing).toEqual([]);
  });

  it('六态被各族完整覆盖（验收标准 §5 缺项即缺陷）', () => {
    const covered = new Set(STATE_FAMILIES.flatMap((family) => family.states));
    expect([...covered].sort()).toEqual([...INTERACTION_STATES].sort());
  });
});
