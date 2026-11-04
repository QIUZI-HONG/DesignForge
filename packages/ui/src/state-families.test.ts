/**
 * 状态族登记表测试（「逐项打勾」的机器校验）。
 *
 * 断言：族号名单齐备（F1/F2/F3/F11–F19，F16–F19 为 RW-07 编辑器组件补齐）、
 * 承载组件真的从包入口可解析、**登记的每个态都能在承载组件上触发**
 * （arch-fix2 发现 B：六态并集不再算覆盖）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import * as UI from './index';
import { INTERACTION_STATES, STATE_FAMILIES } from './state-families';

/** 包内组件样式（状态触发的样式证据来源）。 */
const componentsCss = readFileSync(resolve(process.cwd(), 'src/components.css'), 'utf8');

/** 取一条 CSS 规则的声明体（选择器可位于分组列表；找不到返回空串——断言会显式失败）。 */
function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`).exec(componentsCss)?.[1] ?? '';
}

/** NumberField 调用方文案（本包不含业务文案）。 */
const MESSAGES = { reverted: '已恢复原值', clamped: (value: string) => `已限制为 ${value}` };

/**
 * 登记态 → 可触发口径（arch-fix2 发现 B）。
 *
 * 键必须与族的 `states` 完全一致：登记一个没有触发口径的态 = 假覆盖，直接红。
 * F17/F18 逐条执行（渲染或包样式规则），而不是写一句「有覆盖」的文字说明。
 */
const TRIGGER_CONTRACTS: Record<string, Record<string, () => void>> = {
  F17: {
    // 标签即拖拽把手：hover 时指针变横向缩放（cursor 只在指针悬停时生效）
    hover: () => {
      expect(cssRule('.dfi-numberfield__label')).toContain('cursor: ew-resize');
    },
    // 输入框进入编辑（点击或键盘聚焦）时字段盒子显示焦点环
    active: () => {
      expect(cssRule('.dfi-numberfield:focus-within')).toContain(
        'border-color: var(--dfg-color-focus-ring)',
      );
    },
    disabled: () => {
      const view = render(
        createElement(UI.NumberField, {
          label: 'X',
          fieldName: 'x',
          value: 10,
          mixedPlaceholder: '—',
          messages: MESSAGES,
          onCommit: () => {},
          disabled: true,
        }),
      );
      const input = screen.getByRole('textbox', { name: 'X' }) as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.closest('[data-df-inspector-field]')?.getAttribute('data-df-state')).toBe(
        'disabled',
      );
      expect(cssRule('.dfi-numberfield-cell[data-df-state="disabled"] .dfi-numberfield')).toContain(
        'opacity: 0.6',
      );
      view.unmount();
    },
  },
  F18: {
    hover: () => {
      expect(cssRule('.dfg-input-wrap:hover:not(.dfg-input-wrap--disabled)')).toContain(
        'border-color: var(--dfg-color-border-strong)',
      );
      expect(cssRule('button.dfg-swatch')).toContain('cursor: pointer');
    },
    active: () => {
      expect(cssRule('.dfg-input-wrap:focus-within')).toContain(
        'border-color: var(--dfg-color-focus-ring)',
      );
      expect(cssRule('button.dfg-swatch:focus-visible')).toContain('outline:');
    },
    disabled: () => {
      const swatch = render(
        createElement(UI.Swatch, { color: '#ff0000', label: '红色', disabled: true, onClick() {} }),
      );
      expect((screen.getByRole('button', { name: '红色' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      swatch.unmount();

      const field = render(
        createElement(UI.ColorField, { value: '#ff0000', disabled: true, fieldLabel: '填充' }),
      );
      expect((screen.getByRole('textbox', { name: '填充' }) as HTMLInputElement).disabled).toBe(
        true,
      );
      field.unmount();
    },
    empty: () => {
      const view = render(createElement(UI.Swatch, { color: null }));
      expect(document.querySelector('.dfg-swatch__fill--empty')).not.toBeNull();
      expect(cssRule('.dfg-swatch__fill--empty')).toContain('repeating-linear-gradient(');
      view.unmount();
    },
    error: () => {
      const view = render(
        createElement(UI.ColorField, {
          value: '#ff0000',
          invalid: true,
          errorMessage: '色值不合法',
        }),
      );
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('alert').textContent).toBe('色值不合法');
      expect(cssRule('.dfg-colorfield--invalid')).toContain(
        'border-color: var(--dfg-color-danger)',
      );
      view.unmount();
    },
  },
};

describe('状态族登记表', () => {
  it('族号名单与票面范围一致（F1/F2/F3/F11–F19）', () => {
    expect(STATE_FAMILIES.map((family) => family.id)).toEqual([
      'F1',
      'F2',
      'F3',
      'F11',
      'F12',
      'F13',
      'F14',
      'F15',
      'F16',
      'F17',
      'F18',
      'F19',
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

  it('F17 数值输入族指向单一 deep module（arch-02：不再登记双实现）', () => {
    const family = STATE_FAMILIES.find((entry) => entry.id === 'F17');
    expect(family?.components).toEqual(['NumberField']);
    // 双实现与「留作后续收敛」的登记口径已退役；Inspector 消费同一 module。
    expect(family?.owner).not.toContain('留作后续收敛');
    expect(family?.owner).not.toContain('app 级实现承接');
  });

  it('F17 登记态与实现一致（数值编辑无 loading/error——arch-fix2 发现 B）', () => {
    const family = STATE_FAMILIES.find((entry) => entry.id === 'F17');
    expect(family?.states).toEqual(['hover', 'active', 'disabled']);
  });

  it('F18 族名反映现状（TypographyField 已删除，不再是「色板与文字族」）', () => {
    const family = STATE_FAMILIES.find((entry) => entry.id === 'F18');
    expect(family?.name).toBe('色板族');
    expect(family?.components).toEqual(['Swatch', 'ColorField']);
  });

  it('F17/F18 登记的每个态都能在承载组件上触发（不再是六态并集）', () => {
    const reviewed = STATE_FAMILIES.filter((entry) => entry.id === 'F17' || entry.id === 'F18');
    expect(reviewed).toHaveLength(2);
    for (const family of reviewed) {
      const contract = TRIGGER_CONTRACTS[family.id];
      expect(contract, `${family.id} 缺触发契约`).toBeDefined();
      // 契约键与登记态一一对应：多登记一个态就会在这里暴露
      expect(Object.keys(contract ?? {}).sort(), `${family.id} 登记态缺触发口径`).toEqual(
        [...family.states].sort(),
      );
      for (const state of family.states) {
        const trigger = contract?.[state];
        expect(trigger, `${family.id}.${state} 无触发口径`).toBeDefined();
        expect(() => trigger?.(), `${family.id}.${state} 无法触发`).not.toThrow();
      }
    }
  });

  it('六态词汇表仍被全表覆盖（仅兜底；逐族真假由触发契约负责）', () => {
    const covered = new Set(STATE_FAMILIES.flatMap((family) => family.states));
    expect([...covered].sort()).toEqual([...INTERACTION_STATES].sort());
  });
});
