'use client';

/**
 * InspectPanel —— C15 检查 / 导出态（与 F6 **同源**）。
 *
 * 三区：
 * ① 属性摘要（`model/selection-reads`：位置/尺寸/填充/描边/圆角/文字，视图节点真值）；
 * ② 测量标注（`model/measurements`：**复用画布侧数据**——与拖动时画布上画的间距同源）；
 * ③ 代码（`CodeExportPanel`，F6）+ 导出三档（`ExportPanel`，daemon `/export`）。
 *
 * 多选口径：属性与代码跟随**主选中对象**（`selection.activeId`，与画布高亮一致），
 * 测量按选中并集计算，并在标题行显式提示「已选 N 个图层」——不假装是在看单个对象。
 */

import {
  type CommandStack,
  createSelection,
  findPage,
  type PageId,
  type Selection,
} from '@dforge/engine';
import { EmptyState } from '@dforge/ui';

import { t } from '@/i18n';

// 面板样式（令牌变量；禁裸值——样式集中在 inspect-export.css）
import '../inspect-export.css';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import type { ExportClient } from '../model/export-client';
import { formatMeasureValue, readMeasurements } from '../model/measurements';
import { readInspectSummary } from '../model/selection-reads';
import { CodeExportPanel } from './CodeExportPanel';
import { ExportPanel } from './ExportPanel';

/** 检查面板 props。 */
export interface InspectPanelProps {
  stack: CommandStack;
  pageId: PageId;
  selection: Selection;
  /** 导出目标的文档 id（daemon `/export` 请求用）。 */
  documentId: string;
  /** 导出客户端（宿主注入；门禁/测试一律注入假实现）。 */
  client?: ExportClient;
  /** 复制实现（透传给代码区；测试注入）。 */
  copyText?: (text: string) => Promise<void>;
}

/** 检查面板。 */
export function InspectPanel({
  stack,
  pageId,
  selection,
  documentId,
  client,
  copyText,
}: InspectPanelProps) {
  const document = useDocumentSnapshot(stack);
  const page = findPage(document, pageId);
  if (page === undefined) return null;

  const summary = readInspectSummary(page, selection);
  if (summary.kind === 'none') {
    return (
      <section className="dfx-panel" data-df-inspect="panel" aria-label={t('editor.inspect.title')}>
        <EmptyState title={t('editor.inspect.selection.none')} />
      </section>
    );
  }

  // 主选中对象：属性摘要与代码导出都看它（多选时其余对象只参与测量）
  const targetId = selection.activeId ?? selection.ids[0] ?? null;
  const detail =
    targetId === null ? summary : readInspectSummary(page, createSelection([targetId]));
  const measurements = readMeasurements(page, selection);

  return (
    <section className="dfx-panel" data-df-inspect="panel" aria-label={t('editor.inspect.title')}>
      <header className="dfx-panel__head">
        <h2 className="dfx-panel__title">{t('editor.inspect.title')}</h2>
        <span className="dfx-panel__meta" data-df-inspect="selection-count">
          {summary.kind === 'multiple'
            ? t('editor.inspect.selection.multiple', { count: summary.count })
            : (detail.name ?? '')}
        </span>
      </header>

      <section className="dfx-panel__section" data-df-inspect="properties">
        <h3 className="dfx-section-title">{t('editor.inspect.section.properties')}</h3>
        <dl className="dfx-props">
          {detail.fields.map((field) => (
            <div
              className="dfx-props__row"
              key={field.labelKey}
              data-df-inspect-field={field.labelKey}
            >
              <dt className="dfx-props__label">{t(field.labelKey)}</dt>
              <dd className="dfx-props__value">{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="dfx-panel__section" data-df-inspect="measurements">
        <h3 className="dfx-section-title">{t('editor.inspect.section.measure')}</h3>
        {measurements.length === 0 ? (
          <p className="dfx-measure__empty">{t('editor.inspect.measure.empty')}</p>
        ) : (
          <ul className="dfx-measures">
            {measurements.map((measurement) => (
              <li
                className="dfx-measure"
                key={measurement.id}
                data-df-inspect="measurement"
                data-df-axis={measurement.axis}
                data-df-value={measurement.value}
                data-df-ref={measurement.refId}
              >
                <span className="dfx-measure__axis">
                  {measurement.axis === 'x'
                    ? t('editor.inspect.measure.horizontal')
                    : t('editor.inspect.measure.vertical')}
                </span>
                <span className="dfx-measure__value">
                  {t('editor.inspect.measure.gap', {
                    value: formatMeasureValue(measurement.value),
                  })}
                </span>
                <span className="dfx-measure__ref">
                  {t('editor.inspect.measure.vs', { name: measurement.refName })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {targetId === null ? null : (
        <CodeExportPanel
          page={page}
          nodeId={targetId}
          tokens={document.tokens}
          {...(copyText === undefined ? {} : { copyText })}
        />
      )}

      <ExportPanel
        documentId={documentId}
        pageId={pageId}
        {...(client === undefined ? {} : { client })}
      />
    </section>
  );
}
