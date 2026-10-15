/**
 * C17 覆盖清单与变体读取规格。
 *
 * 覆盖清单是「面板显示什么」的投影：值摘要必须区分「已覆盖值」与「主组件原值」，
 * 且覆盖键只认引擎覆盖表（同一份真值，面板不另存状态）。
 */

import type { ScenePage } from '@dforge/engine';
import { solidPaint } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { FIXTURE_IDS, FIXTURE_OVERRIDE_FILL, fixturePage } from '../testing/fixtures';
import { readOverrideEntries, summarizePatchValue } from './overrides';
import { readVariantState } from './variants';

describe('readOverrideEntries（覆盖清单）', () => {
  const page: ScenePage = fixturePage();

  it('列出覆盖路径、目标节点名与覆盖属性（值 vs 主组件原值）', () => {
    const entries = readOverrideEntries(page, FIXTURE_IDS.instance);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.key).toBe('cmp1_bg');
    expect(entry?.path).toEqual([FIXTURE_IDS.componentRect]);
    expect(entry?.virtualId).toBe(`${FIXTURE_IDS.instance}::${FIXTURE_IDS.componentRect}`);
    expect(entry?.label).toBe('按钮底');
    const fill = entry?.properties.find((property) => property.key === 'fills');
    expect(fill?.value).toBe(FIXTURE_OVERRIDE_FILL);
    // 主组件原值来自主组件节点自身（文档真值），不是覆盖值
    expect(fill?.mainValue).not.toBe(FIXTURE_OVERRIDE_FILL);
  });

  it('无覆盖 → 空清单', () => {
    expect(readOverrideEntries(page, FIXTURE_IDS.variantInstance)).toEqual([]);
  });

  it('非实例 → 空清单（不抛错，面板按空态渲染）', () => {
    expect(readOverrideEntries(page, FIXTURE_IDS.rectTop)).toEqual([]);
  });

  it('多路径覆盖按路径稳定排序', () => {
    const patched = structuredClone(page) as ScenePage;
    const instance = patched.nodes[FIXTURE_IDS.instance];
    if (instance?.type !== 'instance') throw new Error('夹具缺失实例');
    instance.overrides = {
      cmp1_label: { name: '覆盖名' },
      cmp1_bg: { opacity: 0.5 },
    };
    const entries = readOverrideEntries(patched, FIXTURE_IDS.instance);
    expect(entries.map((entry) => entry.key)).toEqual(['cmp1_bg', 'cmp1_label']);
  });
});

describe('summarizePatchValue（覆盖值摘要）', () => {
  it('纯色填充 → 色值；文本 → 字符内容', () => {
    expect(summarizePatchValue([solidPaint('#123456')])).toBe('#123456'); // guard-tokens:allow 文档数据色
    expect(summarizePatchValue({ characters: '确定', fontSize: 14 })).toBe('确定');
  });

  it('数值去掉尾零、布尔走中文字面', () => {
    expect(summarizePatchValue(0.5)).toBe('0.5');
    expect(summarizePatchValue(12)).toBe('12');
    expect(summarizePatchValue(true)).toBe('是');
    expect(summarizePatchValue(false)).toBe('否');
  });

  it('undefined → 「—」（缺省占位）', () => {
    expect(summarizePatchValue(undefined)).toBe('—');
  });
});

describe('readVariantState（变体维度）', () => {
  const page: ScenePage = fixturePage();

  it('实例指向变体 → 给出组件集、维度、取值与当前值', () => {
    const state = readVariantState(page, FIXTURE_IDS.variantInstance);
    expect(state?.setId).toBe(FIXTURE_IDS.set);
    expect(state?.dimensions).toEqual([
      { name: 'size', values: ['large', 'small'], current: 'small' },
    ]);
    expect(state?.current).toEqual({ size: 'small' });
  });

  it('实例的主组件不是变体 → null', () => {
    expect(readVariantState(page, FIXTURE_IDS.instance)).toBeNull();
  });

  it('非实例 → null', () => {
    expect(readVariantState(page, FIXTURE_IDS.rectTop)).toBeNull();
  });
});
