/**
 * C15 测量标注规格（与 F6 同源）。
 *
 * 口径：测量**复用画布侧数据**——`@dforge/engine` 的 `computeMeasurements`
 *（拖动吸附时画布上画的就是这一份），检查态只是把它读出来展示，不另算一套。
 */

import { createSelection, type ScenePage } from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { INSPECT_IDS, inspectPage, MEASURED_GAP } from '../testing/fixtures';
import { formatMeasureValue, readMeasurements } from './measurements';

describe('readMeasurements（与相邻对象的间距）', () => {
  const page: ScenePage = inspectPage();

  it('选中卡片：给出与右侧相邻块的横向间距（值 = 世界单位）', () => {
    const list = readMeasurements(page, createSelection([INSPECT_IDS.card]));
    const horizontal = list.find((item) => item.axis === 'x');
    expect(horizontal?.value).toBe(MEASURED_GAP);
    expect(horizontal?.refId).toBe(INSPECT_IDS.neighbor);
    expect(horizontal?.refName).toBe('相邻块');
    expect(horizontal?.id).toBe('x-neighbor');
  });

  it('同时给出纵向最近间距（取最近的相邻对象）', () => {
    const list = readMeasurements(page, createSelection([INSPECT_IDS.card]));
    const vertical = list.find((item) => item.axis === 'y');
    expect(vertical?.value).toBe(48);
    expect(vertical?.refId).toBe(INSPECT_IDS.plain);
  });

  it('空选 → 空列表（面板显示空态）', () => {
    expect(readMeasurements(page, createSelection([]))).toEqual([]);
  });

  it('多选：按选中并集计算（不重复计入选中者自身）', () => {
    const list = readMeasurements(page, createSelection([INSPECT_IDS.card, INSPECT_IDS.neighbor]));
    expect(list.every((item) => item.refId !== INSPECT_IDS.card)).toBe(true);
    expect(list.every((item) => item.refId !== INSPECT_IDS.neighbor)).toBe(true);
  });

  it('稳定排序：先横向后纵向，各自按参照名排序', () => {
    const list = readMeasurements(page, createSelection([INSPECT_IDS.card]));
    expect(list.map((item) => item.id)).toEqual(['x-neighbor', 'y-plain']);
  });

  it('无相邻对象（孤立节点）→ 不虚构间距', () => {
    const list = readMeasurements(page, createSelection([INSPECT_IDS.frame]));
    expect(list).toEqual([]);
  });
});

describe('formatMeasureValue（数值显示）', () => {
  it('整数原样、浮点去尾零', () => {
    expect(formatMeasureValue(40)).toBe('40');
    expect(formatMeasureValue(12.5)).toBe('12.5');
    expect(formatMeasureValue(0)).toBe('0');
  });
});
