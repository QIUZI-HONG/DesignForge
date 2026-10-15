'use client';

/**
 * InspectorPanel —— 属性面板根（C5 四分区 + C6 混选/对齐 + C7 空选态路由）。
 *
 * 结构：
 * - 空选取（C7）→ 画布设置（页面名/背景/网格）；
 * - 有选取 → 对齐工具行 + 四个分区：
 *   布局（位置/尺寸/旋转/自动布局）· 外观（不透明度/填充/描边/圆角）·
 *   文字（字体/字号/字重/行高/字距/对齐，仅含文本节点时）· 高级（混合模式/导出）。
 *
 * 数据流：读 → `model/readers`（三态：single/mixed/absent）；写 → `model/patches`
 * （批量补丁走引擎命令栈，提交时刻才发命令）。混选值显示「—」，批量修改作用于全选。
 */

import {
  type AutoLayoutConfig,
  type BlendMode,
  type Command,
  type CommandStack,
  findPage,
  type PageId,
  padding,
  type Selection,
  selectionNodes,
  type TextContent,
} from '@dforge/engine';
import { SegmentedControl } from '@dforge/ui';

import { t } from '@/i18n';

// 面板样式（令牌变量；禁裸值——样式集中在 inspector.css）
import '../inspector.css';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import {
  applyAutoLayoutToSelectionCommands,
  setBlendModeCommands,
  setFillColorCommands,
  setFillOpacityCommands,
  setNumberCommands,
  setStrokeCommands,
  setTextCommands,
} from '../model/patches';
import {
  activeFieldValue,
  type FieldValue,
  type NumberFieldKey,
  readAutoLayoutEnabled,
  readAutoLayoutField,
  readBlendMode,
  readFillColor,
  readFillOpacity,
  readNumberField,
  readStrokeColor,
  readStrokeWidth,
  readTextField,
  selectionHasText,
} from '../model/readers';
import { AlignRow } from './AlignRow';
import { CanvasSettings, isValidColorLiteral } from './CanvasSettings';
import { DraftTextField, FieldRow, SelectField, SwitchField } from './controls';
import { NumberField } from './NumberField';
import { InspectorSection } from './Section';

/** 面板 props。 */
export interface InspectorPanelProps {
  stack: CommandStack;
  pageId: PageId;
  selection: Selection;
}

/** 混合模式档位（P0 六档，与引擎 BlendMode 对齐）。 */
const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
];

/** 字重档位（与离线捆绑的 Noto Sans SC 400/500/700 对齐）。 */
const FONT_WEIGHTS = [400, 500, 700] as const;

/** 取单值（mixed/absent → undefined，控件显示「—」）。 */
function singleOrUndefined<T>(field: FieldValue<T>): T | undefined {
  return field.kind === 'single' ? field.value : undefined;
}

/** 属性面板。 */
export function InspectorPanel({ stack, pageId, selection }: InspectorPanelProps) {
  const document = useDocumentSnapshot(stack);
  const page = findPage(document, pageId);

  if (page === undefined) return null;
  if (selection.ids.length === 0) {
    // C7 空选态 = 画布设置
    return <CanvasSettings stack={stack} pageId={pageId} />;
  }

  const ids = selection.ids;
  const dispatch = (commands: readonly Command[], label: string): void => {
    if (commands.length > 0) stack.dispatch(commands, { label });
  };

  /** 标量数值控件（读三态 + 批量提交；混选以主选中值为起拖基准）。 */
  const numberControl = (
    key: NumberFieldKey,
    label: string,
    historyLabel: string,
    extra: { min?: number; max?: number; precision?: number; step?: number; suffix?: string } = {},
    /** 显示/提交的单位换算（如不透明度走百分比：显示 ×100、提交 ÷100）。 */
    scale = 1,
  ) => {
    const field = readNumberField(page, selection, key);
    const base = activeFieldValue(page, selection, (node) => node[key]);
    return (
      <NumberField
        label={label}
        fieldName={key}
        value={field.kind === 'single' ? field.value * scale : undefined}
        baseValue={base === undefined ? undefined : base * scale}
        onCommit={(value) =>
          dispatch(setNumberCommands(page, pageId, ids, key, value / scale), historyLabel)
        }
        {...extra}
      />
    );
  };

  /** 文本属性控件（仅文本节点；批量）。 */
  const textControl = (
    key: 'fontSize' | 'lineHeight' | 'letterSpacing',
    label: string,
    extra: { min?: number; precision?: number; step?: number } = {},
  ) => {
    const field = readTextField(page, selection, (text) => text[key]);
    const base = activeFieldValue(page, selection, (node) =>
      node.type === 'text' ? node.text[key] : undefined,
    );
    return (
      <NumberField
        label={label}
        fieldName={key}
        value={singleOrUndefined(field)}
        baseValue={base}
        onCommit={(value) =>
          dispatch(
            setTextCommands(page, pageId, ids, { [key]: value } as Partial<TextContent>),
            t('inspector.history.text'),
          )
        }
        {...extra}
      />
    );
  };

  const frameIds = selectionNodes(page, selection)
    .filter((node) => node.type === 'frame')
    .map((node) => node.id);
  const autoLayoutEnabled = readAutoLayoutEnabled(page, selection);
  const isAutoLayoutOn = autoLayoutEnabled.kind === 'single' && autoLayoutEnabled.value;
  const autoLayoutHistory = t('inspector.history.autoLayout');
  const setAutoLayout = (patch: Partial<AutoLayoutConfig> | null): void => {
    dispatch(
      applyAutoLayoutToSelectionCommands(document, pageId, frameIds, patch),
      autoLayoutHistory,
    );
  };

  const fillColor = readFillColor(page, selection);
  const fillOpacity = readFillOpacity(page, selection);
  const strokeColor = readStrokeColor(page, selection);
  const strokeWidth = readStrokeWidth(page, selection);
  const blendMode = readBlendMode(page, selection);
  const fontFamily = readTextField(page, selection, (text) => text.fontFamily);
  const fontWeight = readTextField(page, selection, (text) => text.fontWeight);
  const textAlign = readTextField(page, selection, (text) => text.align);

  const families = new Set<string>(['Noto Sans SC']);
  for (const node of selectionNodes(page, selection)) {
    if (node.type === 'text') families.add(node.text.fontFamily);
  }

  return (
    <aside className="dfi-panel" data-df-inspector="panel" aria-label={t('inspector.a11y.panel')}>
      <AlignRow stack={stack} pageId={pageId} selection={selection} />

      <InspectorSection id="layout" title={t('inspector.section.layout')}>
        <FieldRow>
          {numberControl('x', t('inspector.field.x'), t('inspector.history.position'), {
            precision: 0,
          })}
          {numberControl('y', t('inspector.field.y'), t('inspector.history.position'), {
            precision: 0,
          })}
        </FieldRow>
        <FieldRow>
          {numberControl('width', t('inspector.field.width'), t('inspector.history.size'), {
            min: 0,
            precision: 0,
          })}
          {numberControl('height', t('inspector.field.height'), t('inspector.history.size'), {
            min: 0,
            precision: 0,
          })}
        </FieldRow>
        <FieldRow>
          {numberControl(
            'rotation',
            t('inspector.field.rotation'),
            t('inspector.history.position'),
            {
              precision: 1,
              suffix: '°',
            },
          )}
        </FieldRow>
        {frameIds.length === 0 ? null : (
          <>
            <FieldRow>
              <SwitchField
                label={t('inspector.field.autoLayout')}
                fieldName="autoLayoutEnabled"
                checked={isAutoLayoutOn}
                onChange={(next) => setAutoLayout(next ? {} : null)}
              />
            </FieldRow>
            {isAutoLayoutOn ? (
              <>
                <FieldRow>
                  <div
                    className="dfi-select"
                    data-df-inspector-field="autoLayoutDirection"
                    data-df-state={
                      readAutoLayoutField(page, selection, (config) => config.direction).kind ===
                      'single'
                        ? 'default'
                        : 'mixed'
                    }
                  >
                    <span className="dfi-select__label">
                      {t('inspector.field.autoLayoutDirection')}
                    </span>
                    <SegmentedControl
                      label={t('inspector.field.autoLayoutDirection')}
                      size="sm"
                      options={[
                        { value: 'horizontal', label: t('inspector.layout.horizontal') },
                        { value: 'vertical', label: t('inspector.layout.vertical') },
                      ]}
                      value={
                        singleOrUndefined(
                          readAutoLayoutField(page, selection, (config) => config.direction),
                        ) ?? 'horizontal'
                      }
                      onChange={(value) =>
                        setAutoLayout({
                          direction: value === 'vertical' ? 'vertical' : 'horizontal',
                        })
                      }
                    />
                  </div>
                </FieldRow>
                <FieldRow>
                  {(() => {
                    const spacing = readAutoLayoutField(
                      page,
                      selection,
                      (config) => config.spacing,
                    );
                    const base = activeFieldValue(page, selection, (node) =>
                      node.type === 'frame' && node.autoLayout !== null
                        ? node.autoLayout.spacing
                        : undefined,
                    );
                    return (
                      <NumberField
                        label={t('inspector.field.autoLayoutSpacing')}
                        fieldName="autoLayoutSpacing"
                        value={singleOrUndefined(spacing)}
                        baseValue={base}
                        min={0}
                        precision={0}
                        onCommit={(value) => setAutoLayout({ spacing: value })}
                      />
                    );
                  })()}
                  {(() => {
                    const pad = readAutoLayoutField(
                      page,
                      selection,
                      (config) => config.padding.left,
                    );
                    const base = activeFieldValue(page, selection, (node) =>
                      node.type === 'frame' && node.autoLayout !== null
                        ? node.autoLayout.padding.left
                        : undefined,
                    );
                    return (
                      <NumberField
                        label={t('inspector.field.autoLayoutPadding')}
                        fieldName="autoLayoutPadding"
                        value={singleOrUndefined(pad)}
                        baseValue={base}
                        min={0}
                        precision={0}
                        onCommit={(value) => setAutoLayout({ padding: padding(value) })}
                      />
                    );
                  })()}
                </FieldRow>
              </>
            ) : null}
          </>
        )}
      </InspectorSection>

      <InspectorSection id="appearance" title={t('inspector.section.appearance')}>
        <FieldRow>
          {numberControl(
            'opacity',
            t('inspector.field.opacity'),
            t('inspector.history.appearance'),
            {
              min: 0,
              max: 100,
              precision: 0,
              suffix: '%',
            },
            100,
          )}
          {numberControl(
            'cornerRadius',
            t('inspector.field.cornerRadius'),
            t('inspector.history.appearance'),
            { min: 0, precision: 0 },
          )}
        </FieldRow>
        <FieldRow>
          <DraftTextField
            label={t('inspector.field.fill')}
            fieldName="fillColor"
            value={singleOrUndefined(fillColor)}
            swatch={singleOrUndefined(fillColor)}
            validate={isValidColorLiteral}
            invalidHint={t('inspector.color.invalid')}
            onCommit={(color) =>
              dispatch(
                setFillColorCommands(page, pageId, ids, color),
                t('inspector.history.appearance'),
              )
            }
          />
          {(() => {
            const base = activeFieldValue(page, selection, (node) => node.fills[0]?.opacity);
            return (
              <NumberField
                label={t('inspector.field.fillOpacity')}
                fieldName="fillOpacity"
                value={
                  fillOpacity.kind === 'single' ? Math.round(fillOpacity.value * 100) : undefined
                }
                baseValue={base === undefined ? undefined : Math.round(base * 100)}
                min={0}
                max={100}
                precision={0}
                suffix="%"
                onCommit={(value) =>
                  dispatch(
                    setFillOpacityCommands(page, pageId, ids, value / 100),
                    t('inspector.history.appearance'),
                  )
                }
              />
            );
          })()}
        </FieldRow>
        <FieldRow>
          <DraftTextField
            label={t('inspector.field.stroke')}
            fieldName="strokeColor"
            value={singleOrUndefined(strokeColor)}
            swatch={singleOrUndefined(strokeColor)}
            validate={isValidColorLiteral}
            invalidHint={t('inspector.color.invalid')}
            onCommit={(color) =>
              dispatch(
                setStrokeCommands(page, pageId, ids, { color }),
                t('inspector.history.appearance'),
              )
            }
          />
          {(() => {
            const base = activeFieldValue(page, selection, (node) => node.strokes[0]?.width);
            return (
              <NumberField
                label={t('inspector.field.strokeWidth')}
                fieldName="strokeWidth"
                value={singleOrUndefined(strokeWidth)}
                baseValue={base}
                min={0}
                precision={0}
                onCommit={(value) =>
                  dispatch(
                    setStrokeCommands(page, pageId, ids, { width: value }),
                    t('inspector.history.appearance'),
                  )
                }
              />
            );
          })()}
        </FieldRow>
      </InspectorSection>

      {selectionHasText(page, selection) ? (
        <InspectorSection id="text" title={t('inspector.section.text')}>
          <FieldRow>
            <SelectField
              label={t('inspector.field.fontFamily')}
              fieldName="fontFamily"
              value={singleOrUndefined(fontFamily)}
              options={[...families].map((family) => ({ value: family, label: family }))}
              onChange={(family) =>
                dispatch(
                  setTextCommands(page, pageId, ids, { fontFamily: family }),
                  t('inspector.history.text'),
                )
              }
            />
          </FieldRow>
          <FieldRow>
            {textControl('fontSize', t('inspector.field.fontSize'), { min: 1, precision: 0 })}
            <SelectField
              label={t('inspector.field.fontWeight')}
              fieldName="fontWeight"
              value={fontWeight.kind === 'single' ? String(fontWeight.value) : undefined}
              options={FONT_WEIGHTS.map((weight) => ({
                value: String(weight),
                label: String(weight),
              }))}
              onChange={(weight) =>
                dispatch(
                  setTextCommands(page, pageId, ids, { fontWeight: Number(weight) }),
                  t('inspector.history.text'),
                )
              }
            />
          </FieldRow>
          <FieldRow>
            {textControl('lineHeight', t('inspector.field.lineHeight'), {
              min: 0,
              precision: 2,
              step: 0.1,
            })}
            {textControl('letterSpacing', t('inspector.field.letterSpacing'), {
              precision: 2,
              step: 0.1,
            })}
          </FieldRow>
          <FieldRow>
            <div
              className="dfi-select"
              data-df-inspector-field="textAlign"
              data-df-state={textAlign.kind === 'single' ? 'default' : 'mixed'}
            >
              <span className="dfi-select__label">{t('inspector.field.textAlign')}</span>
              <SegmentedControl
                label={t('inspector.field.textAlign')}
                size="sm"
                options={(['left', 'center', 'right', 'justify'] as const).map((align) => ({
                  value: align,
                  label: t(`inspector.textAlign.${align}`),
                }))}
                value={singleOrUndefined(textAlign) ?? 'left'}
                onChange={(align) =>
                  dispatch(
                    setTextCommands(page, pageId, ids, {
                      align: align as TextContent['align'],
                    }),
                    t('inspector.history.text'),
                  )
                }
              />
            </div>
          </FieldRow>
        </InspectorSection>
      ) : null}

      <InspectorSection id="advanced" title={t('inspector.section.advanced')}>
        <FieldRow>
          <SelectField
            label={t('inspector.field.blendMode')}
            fieldName="blendMode"
            value={singleOrUndefined(blendMode)}
            options={BLEND_MODES.map((mode) => ({
              value: mode,
              label: t(`inspector.blendMode.${mode}`),
            }))}
            onChange={(mode) =>
              dispatch(
                setBlendModeCommands(page, pageId, ids, mode as BlendMode),
                t('inspector.history.blendMode'),
              )
            }
          />
        </FieldRow>
        <FieldRow>
          {/* 导出设置：面板归 C15/F6 票（FE-08 落地）；此处按 F15 禁用态族给桩（灰化 + 原因） */}
          <div className="dfi-row-block" data-df-inspector-field="export" data-df-state="disabled">
            <span className="dfi-select__label">{t('inspector.field.export')}</span>
            <button
              type="button"
              className="dfi-stub"
              disabled
              title={t('inspector.export.blocked')}
              aria-describedby="dfi-export-blocked"
            >
              {t('inspector.export.action')}
            </button>
            <span id="dfi-export-blocked" className="dfi-hint">
              {t('inspector.export.blocked')}
            </span>
          </div>
        </FieldRow>
      </InspectorSection>
    </aside>
  );
}
