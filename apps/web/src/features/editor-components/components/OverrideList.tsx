'use client';

/**
 * 实例覆盖清单（C17「覆盖清单与重置」）。
 *
 * 展示口径：一行 = 一条覆盖路径；行内每个属性给出「覆盖值 → 主组件值」对照，
 * 每行一个「重置」，面板另有「重置覆盖」总入口。重置只经宿主回调（宿主走命令栈），
 * 组件本身不持有写能力。
 */

import { IconButton, UndoIcon } from '@dforge/ui';

import { t } from '@/i18n';

import type { OverrideEntryRead } from '../model/overrides';

/** 属性键 → 界面标签（i18n 键映射；未收录的键退回原键名）。 */
const PROPERTY_LABEL_KEYS: Record<string, string> = {
  fills: 'editor.inspect.field.fill',
  strokes: 'editor.inspect.field.stroke',
  text: 'editor.inspect.field.text',
  cornerRadius: 'editor.inspect.field.radius',
  name: 'editor.components.createDialog.name',
};

/** 覆盖清单 props。 */
export interface OverrideListProps {
  entries: readonly OverrideEntryRead[];
  /** 重置单条路径的覆盖。 */
  onResetPath: (path: readonly string[]) => void;
}

/** 属性键的界面标签。 */
export function propertyLabel(key: string): string {
  const messageKey = PROPERTY_LABEL_KEYS[key];
  return messageKey === undefined ? key : t(messageKey);
}

/** 覆盖清单。 */
export function OverrideList({ entries, onResetPath }: OverrideListProps) {
  if (entries.length === 0) {
    return (
      <p className="dfc-overrides__empty" data-df-component="overrides-empty">
        {t('editor.components.overrides.empty')}
      </p>
    );
  }
  return (
    <ul className="dfc-overrides" data-df-component="overrides">
      {entries.map((entry) => (
        <li
          className="dfc-overrides__row"
          key={entry.key}
          data-df-component="override-row"
          data-df-override-path={entry.key}
        >
          <div className="dfc-overrides__head">
            <span className="dfc-overrides__label">{entry.label}</span>
            <IconButton
              size="sm"
              label={t('editor.components.overrides.resetLabel', { label: entry.label })}
              icon={<UndoIcon />}
              data-df-component="override-reset"
              onClick={() => onResetPath(entry.path)}
            />
          </div>
          <ul className="dfc-overrides__props">
            {entry.properties.map((property) => (
              <li
                className="dfc-overrides__prop"
                key={property.key}
                data-df-override-key={property.key}
              >
                <span className="dfc-overrides__prop-name">{propertyLabel(property.key)}</span>
                <span className="dfc-overrides__prop-value">{property.value}</span>
                <span className="dfc-overrides__prop-main">
                  {t('editor.components.overrides.mainValue', { value: property.mainValue })}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
