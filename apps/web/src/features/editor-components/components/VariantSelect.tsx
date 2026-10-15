'use client';

/**
 * 变体切换下拉（C17「变体切换」）。
 *
 * 一个维度一个下拉（Figma 的变体属性即多维度开关）；选中即提交一条命令，
 * 提交由宿主（ComponentPanel）经 `model/actions` 落到命令栈。维度取值为引擎索引推导。
 */

import { t } from '@/i18n';

import type { VariantStateRead } from '../model/variants';

/** 变体切换 props。 */
export interface VariantSelectProps {
  state: VariantStateRead;
  /** 选择某维度新值（宿主合并其余维度后提交）。 */
  onSelect: (properties: Record<string, string>) => void;
}

/** 变体切换（多维度下拉开集合）。 */
export function VariantSelect({ state, onSelect }: VariantSelectProps) {
  return (
    <div className="dfc-variants" data-df-component="variants">
      <h3 className="dfc-panel__section-title">{t('editor.components.variants.title')}</h3>
      {state.dimensions.map((dimension) => {
        const label = t('editor.components.variants.dimension', { name: dimension.name });
        const current = dimension.current ?? dimension.values[0] ?? '';
        return (
          <label className="dfc-variants__field" key={dimension.name}>
            <span className="dfc-variants__label">{label}</span>
            <select
              className="dfc-variants__control"
              data-df-component="variant-select"
              data-df-variant-dimension={dimension.name}
              aria-label={label}
              value={current}
              onChange={(event) =>
                onSelect({ ...state.current, [dimension.name]: event.target.value })
              }
            >
              {dimension.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
