'use client';

/**
 * CanvasSettings —— C7 空选态（画布设置）。
 *
 * 三组设置全部落页面数据（`page.update` 命令）：
 * 页面名 / 画布背景色 / 网格（开关 + 间距）。网格其余字段（样式、吸附）原样保留——
 * 补丁只覆盖用户改的那一项。
 */

import { type CommandStack, findPage, type PageId, type PagePatch } from '@dforge/engine';

import { t } from '@/i18n';

// 面板样式（令牌变量；禁裸值——样式集中在 inspector.css）
import '../inspector.css';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import { DraftTextField, FieldRow, SwitchField } from './controls';
import { NumberField } from './NumberField';

/** 画布设置 props。 */
export interface CanvasSettingsProps {
  stack: CommandStack;
  pageId: PageId;
}

/** 颜色字面量校验（#RRGGBB / #RRGGBBAA，#RGB 亦收纳）。 */
export function isValidColorLiteral(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

/** 空选态：画布设置面板。 */
export function CanvasSettings({ stack, pageId }: CanvasSettingsProps) {
  const document = useDocumentSnapshot(stack);
  const page = findPage(document, pageId);

  if (page === undefined) return null;

  const update = (patch: PagePatch): void => {
    stack.dispatch(
      { type: 'page.update', pageId, patch },
      { label: t('inspector.history.canvas') },
    );
  };

  return (
    <section
      className="dfi-panel dfi-panel--canvas"
      data-df-inspector="canvas-settings"
      aria-label={t('inspector.canvas.title')}
    >
      <h3 className="dfi-section__title">{t('inspector.canvas.title')}</h3>
      <FieldRow>
        <DraftTextField
          label={t('inspector.canvas.pageName')}
          fieldName="pageName"
          value={page.name}
          onCommit={(name) => update({ name })}
        />
      </FieldRow>
      <FieldRow>
        <DraftTextField
          label={t('inspector.canvas.background')}
          fieldName="background"
          value={page.backgroundColor}
          swatch={isValidColorLiteral(page.backgroundColor) ? page.backgroundColor : undefined}
          validate={isValidColorLiteral}
          invalidHint={t('inspector.color.invalid')}
          onCommit={(backgroundColor) => update({ backgroundColor })}
        />
      </FieldRow>
      <FieldRow>
        <SwitchField
          label={t('inspector.canvas.grid')}
          fieldName="gridVisible"
          checked={page.grid.visible}
          onChange={(visible) => update({ grid: { ...page.grid, visible } })}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          label={t('inspector.canvas.gridSize')}
          fieldName="gridSize"
          value={page.grid.size}
          min={1}
          max={512}
          precision={0}
          onCommit={(size) => update({ grid: { ...page.grid, size } })}
        />
      </FieldRow>
    </section>
  );
}
