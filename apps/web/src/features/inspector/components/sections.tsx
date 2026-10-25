'use client';

/**
 * Inspector 分区组件（RW-10 重写 · 交付 a/c/d）。
 *
 * 组织口径（交付 a）：设计页内折叠分区——尺寸 / 填充 / 描边 / 圆角 / 效果 / 文字；
 * 导出走独立页签（见 InspectorPanel）。分区内容为 memo 组件：
 * 面板因**页签切换 / 折叠开合**重渲时，props（page/selection/actions）不变 → 分区跳过，
 * 不整树重渲；选中集或文档变化时各分区拿到新 page/selection 正常刷新。
 *
 * scrubbing（交付 b）：全数值字段经 `FlowNumberField` 接 scrub 会话
 * （`onScrubStart` 括约 → 拖拽中零写入 → 松手 `commitCommands` 单事务提交）。
 *
 * 效果分区（交付 c）：列表可见（`readEffects` 三态）+ 可调（增/删/改经 node.update
 * 命令族，一次交互一条历史）；层模糊只显示适用参数（UI 不撒谎）。
 *
 * P0 口径（交付 d）：圆角只有「四角统一」一个字段——引擎 P0 不做四角独立，
 * UI 呈现不超出引擎能力。
 */

import {
  type AutoLayoutConfig,
  type BlendMode,
  type Command,
  type CommandStack,
  type Effect,
  type PageId,
  padding,
  type ScenePage,
  type Selection,
  selectionNodes,
  type TextContent,
} from '@dforge/engine';
import { Collapse, SegmentedControl } from '@dforge/ui';
import { memo, type ReactNode, useState } from 'react';

import { t } from '@/i18n';

import {
  addEffectCommands,
  applyAutoLayoutToSelectionCommands,
  defaultEffect,
  removeEffectCommands,
  setFillColorCommands,
  setFillOpacityCommands,
  setNumberCommands,
  setStrokeCommands,
  setTextCommands,
  type EffectType,
  updateEffectCommands,
} from '../model/patches';
import {
  activeFieldValue,
  type FieldValue,
  readAutoLayoutEnabled,
  readAutoLayoutField,
  readFillColor,
  readFillOpacity,
  readNumberField,
  readStrokeColor,
  readStrokeWidth,
  readTextField,
  readEffects,
} from '../model/readers';
import { ColorFieldRow, FieldRow, SelectField, SwitchField } from './controls';
import { NumberField, type NumberFieldProps } from './NumberField';

/** 分区 id（设计页折叠分区）。 */
export type InspectorSectionId = 'size' | 'fill' | 'stroke' | 'corner' | 'effects' | 'text';

/** 分区共享动作（引用稳定：useMemo 收拢的回调集，memo 边界的稳定 props）。 */
export interface SectionActions {
  /** 普通提交（离散操作：一次点击 = 一次修改 = 一条命令）。 */
  dispatch(commands: readonly Command[], label: string): void;
  /** scrub 会话括约：拖拽开始（拖拽中零写入）。 */
  beginScrub(): void;
  /** scrub 会话收口（松手；零写入，幂等）。 */
  endScrub(): void;
  /** 会话感知提交：会话开启中 = 单事务收口本段拖拽；否则普通提交（键入路径）。 */
  commitCommands(commands: readonly Command[], label: string): void;
  /** 折叠开合（面板记忆跨选中切换）。 */
  toggleSection(id: InspectorSectionId, open: boolean): void;
}

/** 分区公共 props（page/selection 随文档与选中变化；其余引用稳定）。 */
export interface SectionProps {
  stack: CommandStack;
  pageId: PageId;
  /** 当前页面（命令栈快照派生；页面缺失时分区不渲染）。 */
  page: ScenePage | undefined;
  selection: Selection;
  actions: SectionActions;
  /** 当前是否展开（面板记忆的开合态）。 */
  open: boolean;
}

/** 取单值（mixed/absent → undefined，控件显示「—」）。 */
function singleOrUndefined<T>(field: FieldValue<T>): T | undefined {
  return field.kind === 'single' ? field.value : undefined;
}

/** 折叠分区外壳（标题触发器 + 内容；内容 DOM 保留——调值中途折叠不回跳）。 */
function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: InspectorSectionId;
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="dfi-section" data-df-inspector-section={id}>
      <Collapse title={title} open={open} onToggle={onToggle}>
        <div className="dfi-section__body">{children}</div>
      </Collapse>
    </section>
  );
}

/**
 * 会话接线的数值字段：`onScrubStart/End` 接 scrub 会话（引擎 interaction 会话同语义：
 * 拖拽中不写文档、松手单事务提交），onCommit 由调用方经 `commitCommands` 落命令。
 */
function FlowNumberField({
  actions,
  onCommit,
  ...rest
}: Omit<NumberFieldProps, 'onScrubStart' | 'onScrubEnd'> & {
  actions: SectionActions;
  onCommit(value: number): void;
}) {
  return (
    <NumberField
      {...rest}
      onCommit={onCommit}
      onScrubStart={actions.beginScrub}
      onScrubEnd={actions.endScrub}
    />
  );
}

/* ------------------------------------------------------------------------ *
 * 尺寸（位置/尺寸/旋转/自动布局）
 * ------------------------------------------------------------------------ */

/** 字重档位（与离线捆绑的 Noto Sans SC 400/500/700 对齐）。 */
const FONT_WEIGHTS = [400, 500, 700] as const;

/** 尺寸分区（含画板的自动布局行）。 */
export const SizeSection = memo(function SizeSection({
  stack,
  pageId,
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  if (page === undefined) return null;
  const ids = selection.ids;

  /** 标量数值控件（读三态 + 批量提交；混选以主选中值为起拖基准）。 */
  const numberControl = (
    key: 'x' | 'y' | 'width' | 'height' | 'rotation',
    label: string,
    historyLabel: string,
    extra: { min?: number; max?: number; precision?: number; suffix?: string } = {},
  ) => {
    const field = readNumberField(page, selection, key);
    const base = activeFieldValue(page, selection, (node) => node[key]);
    return (
      <FlowNumberField
        actions={actions}
        label={label}
        fieldName={key}
        value={field.kind === 'single' ? field.value : undefined}
        baseValue={base}
        onCommit={(value) =>
          actions.commitCommands(setNumberCommands(page, pageId, ids, key, value), historyLabel)
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
    // 间距/内边距可被 scrub：走会话感知提交（拖拽松手单事务收口，含子项重排命令）
    actions.commitCommands(
      applyAutoLayoutToSelectionCommands(stack.document, pageId, frameIds, patch),
      autoLayoutHistory,
    );
  };

  return (
    <CollapsibleSection
      id="size"
      title={t('inspector.section.size')}
      open={open}
      onToggle={(next) => actions.toggleSection('size', next)}
    >
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
        {numberControl('rotation', t('inspector.field.rotation'), t('inspector.history.position'), {
          precision: 1,
          suffix: '°',
        })}
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
                  const spacing = readAutoLayoutField(page, selection, (config) => config.spacing);
                  const base = activeFieldValue(page, selection, (node) =>
                    node.type === 'frame' && node.autoLayout !== null
                      ? node.autoLayout.spacing
                      : undefined,
                  );
                  return (
                    <FlowNumberField
                      actions={actions}
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
                    <FlowNumberField
                      actions={actions}
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
    </CollapsibleSection>
  );
});

/* ------------------------------------------------------------------------ *
 * 填充 / 描边 / 圆角
 * ------------------------------------------------------------------------ */

/** 填充分区（颜色走 UI-kit ColorField 口径）。 */
export const FillSection = memo(function FillSection({
  stack,
  pageId,
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  if (page === undefined) return null;
  const ids = selection.ids;
  const fillColor = readFillColor(page, selection);
  const fillOpacity = readFillOpacity(page, selection);
  const history = t('inspector.history.appearance');

  return (
    <CollapsibleSection
      id="fill"
      title={t('inspector.section.fill')}
      open={open}
      onToggle={(next) => actions.toggleSection('fill', next)}
    >
      <FieldRow>
        <ColorFieldRow
          label={t('inspector.field.fill')}
          fieldName="fillColor"
          value={singleOrUndefined(fillColor)}
          onCommit={(color) =>
            actions.dispatch(setFillColorCommands(page, pageId, ids, color), history)
          }
        />
        {(() => {
          const base = activeFieldValue(page, selection, (node) => node.fills[0]?.opacity);
          return (
            <FlowNumberField
              actions={actions}
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
                actions.commitCommands(
                  setFillOpacityCommands(page, pageId, ids, value / 100),
                  history,
                )
              }
            />
          );
        })()}
      </FieldRow>
    </CollapsibleSection>
  );
});

/** 描边分区。 */
export const StrokeSection = memo(function StrokeSection({
  stack,
  pageId,
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  if (page === undefined) return null;
  const ids = selection.ids;
  const strokeColor = readStrokeColor(page, selection);
  const strokeWidth = readStrokeWidth(page, selection);
  const history = t('inspector.history.appearance');

  return (
    <CollapsibleSection
      id="stroke"
      title={t('inspector.section.stroke')}
      open={open}
      onToggle={(next) => actions.toggleSection('stroke', next)}
    >
      <FieldRow>
        <ColorFieldRow
          label={t('inspector.field.stroke')}
          fieldName="strokeColor"
          value={singleOrUndefined(strokeColor)}
          onCommit={(color) =>
            actions.dispatch(setStrokeCommands(page, pageId, ids, { color }), history)
          }
        />
        {(() => {
          const base = activeFieldValue(page, selection, (node) => node.strokes[0]?.width);
          return (
            <FlowNumberField
              actions={actions}
              label={t('inspector.field.strokeWidth')}
              fieldName="strokeWidth"
              value={singleOrUndefined(strokeWidth)}
              baseValue={base}
              min={0}
              precision={0}
              onCommit={(value) =>
                actions.commitCommands(
                  setStrokeCommands(page, pageId, ids, { width: value }),
                  history,
                )
              }
            />
          );
        })()}
      </FieldRow>
    </CollapsibleSection>
  );
});

/** 圆角分区（P0：四角统一一个字段，UI 不撒谎）。 */
export const CornerSection = memo(function CornerSection({
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  if (page === undefined) return null;
  const cornerRadius = readNumberField(page, selection, 'cornerRadius');
  const base = activeFieldValue(page, selection, (node) => node.cornerRadius);

  return (
    <CollapsibleSection
      id="corner"
      title={t('inspector.section.corner')}
      open={open}
      onToggle={(next) => actions.toggleSection('corner', next)}
    >
      <FieldRow>
        <FlowNumberField
          actions={actions}
          label={t('inspector.field.cornerRadius')}
          fieldName="cornerRadius"
          value={singleOrUndefined(cornerRadius)}
          baseValue={base}
          min={0}
          precision={0}
          onCommit={(value) =>
            actions.commitCommands(
              setNumberCommands(page, pageId, selection.ids, 'cornerRadius', value),
              t('inspector.history.appearance'),
            )
          }
        />
      </FieldRow>
      <p className="dfi-hint">{t('inspector.cornerRadius.uniform')}</p>
    </CollapsibleSection>
  );
});

/* ------------------------------------------------------------------------ *
 * 效果（RW-10 交付 c）
 * ------------------------------------------------------------------------ */

/** 单条效果行（参数编辑经 node.update 命令；层模糊只显示适用参数）。 */
const EffectRow = memo(function EffectRow({
  effect,
  index,
  stack,
  pageId,
  page,
  selection,
  actions,
}: {
  effect: Effect;
  index: number;
  stack: CommandStack;
  pageId: PageId;
  page: ScenePage;
  selection: Selection;
  actions: SectionActions;
}) {
  const ids = selection.ids;
  const history = t('inspector.history.effects');
  const isShadow = effect.type !== 'layer_blur';
  const update = (patch: Partial<Omit<Effect, 'type'>>): void => {
    actions.dispatch(updateEffectCommands(page, pageId, ids, index, patch), history);
  };
  /**
   * 参数数值字段（走 scrub 会话：拖拽零写入，松手单事务）。
   * 负值口径：偏移量可为负（投影方向不限）；模糊/扩展 min 0。
   */
  const param = (
    key: 'offsetX' | 'offsetY' | 'blur' | 'spread',
    label: string,
    extra: { min?: number } = {},
  ) => (
    <FlowNumberField
      actions={actions}
      label={label}
      fieldName={`effect-${index}-${key}`}
      value={effect[key]}
      min={extra.min}
      precision={0}
      onCommit={(value) => {
        // 按键位显式展开（计算键在严格模式下无法收窄到效果补丁形状）
        const patch: Partial<Omit<Effect, 'type'>> =
          key === 'offsetX'
            ? { offsetX: value }
            : key === 'offsetY'
              ? { offsetY: value }
              : key === 'blur'
                ? { blur: value }
                : { spread: value };
        actions.commitCommands(updateEffectCommands(page, pageId, ids, index, patch), history);
      }}
    />
  );

  return (
    <div
      className="dfi-effectrow"
      data-df-effect={effect.type}
      data-df-effect-index={index}
      data-df-state={effect.visible ? 'default' : 'dimmed'}
    >
      <div className="dfi-effectrow__head">
        <span className="dfi-effectrow__type">{t(`inspector.effect.${effect.type}`)}</span>
        <SwitchField
          label={t('inspector.effect.visible')}
          fieldName={`effectVisible-${index}`}
          checked={effect.visible}
          onChange={(visible) => update({ visible })}
        />
        <button
          type="button"
          className="dfi-effectrow__remove"
          data-df-effect-remove={String(index)}
          aria-label={t('inspector.effect.remove')}
          onClick={() => actions.dispatch(removeEffectCommands(page, pageId, ids, index), history)}
        >
          ×
        </button>
      </div>
      <div className="dfi-effectrow__params">
        {isShadow ? param('offsetX', t('inspector.effect.offsetX')) : null}
        {isShadow ? param('offsetY', t('inspector.effect.offsetY')) : null}
        {param('blur', t('inspector.effect.blur'), { min: 0 })}
        {isShadow ? param('spread', t('inspector.effect.spread'), { min: 0 }) : null}
        {isShadow ? (
          <ColorFieldRow
            label={t('inspector.effect.color')}
            fieldName={`effect-${index}-color`}
            value={effect.color}
            onCommit={(color) => update({ color })}
          />
        ) : null}
      </div>
    </div>
  );
});

/** 效果分区（列表可见可调 + 添加入口；混选诚实呈现）。 */
export const EffectsSection = memo(function EffectsSection({
  stack,
  pageId,
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  const [addType, setAddType] = useState<EffectType>('drop_shadow');
  if (page === undefined) return null;

  const effects = readEffects(page, selection);
  const history = t('inspector.history.effects');
  const add = (): void => {
    actions.dispatch(
      addEffectCommands(page, pageId, selection.ids, defaultEffect(addType)),
      history,
    );
  };

  return (
    <CollapsibleSection
      id="effects"
      title={t('inspector.section.effects')}
      open={open}
      onToggle={(next) => actions.toggleSection('effects', next)}
    >
      <div className="dfi-effects" data-df-inspector-field="effects">
        {effects.kind === 'single' ? (
          effects.value.map((effect, index) => (
            <EffectRow
              key={`${effect.type}-${index}`}
              effect={effect}
              index={index}
              stack={stack}
              pageId={pageId}
              page={page}
              selection={selection}
              actions={actions}
            />
          ))
        ) : (
          <p className="dfi-hint dfi-effects__mixed" data-df-effect-mixed="" data-df-state="mixed">
            {t('inspector.effect.mixed')}
          </p>
        )}
        <div className="dfi-row dfi-effects__add-row">
          <div className="dfi-select">
            <select
              className="dfi-select__control"
              data-df-effect-type=""
              aria-label={t('inspector.effect.type')}
              value={addType}
              onChange={(event) => setAddType(event.target.value as EffectType)}
            >
              {(['drop_shadow', 'inner_shadow', 'layer_blur'] as const).map((type) => (
                <option key={type} value={type}>
                  {t(`inspector.effect.${type}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="dfi-effects__add" data-df-effect-add="" onClick={add}>
            {t('inspector.effect.add')}
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
});

/* ------------------------------------------------------------------------ *
 * 文字
 * ------------------------------------------------------------------------ */

/** 文字分区（仅含文本节点时渲染）。 */
export const TextSection = memo(function TextSection({
  stack,
  pageId,
  page,
  selection,
  actions,
  open,
}: SectionProps) {
  if (page === undefined) return null;
  const ids = selection.ids;
  const history = t('inspector.history.text');

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
      <FlowNumberField
        actions={actions}
        label={label}
        fieldName={key}
        value={singleOrUndefined(field)}
        baseValue={base}
        onCommit={(value) =>
          actions.commitCommands(
            setTextCommands(page, pageId, ids, { [key]: value } as Partial<TextContent>),
            history,
          )
        }
        {...extra}
      />
    );
  };

  const fontFamily = readTextField(page, selection, (text) => text.fontFamily);
  const fontWeight = readTextField(page, selection, (text) => text.fontWeight);
  const textAlign = readTextField(page, selection, (text) => text.align);
  const weight = singleOrUndefined(fontWeight);

  const families = new Set<string>(['Noto Sans SC']);
  for (const node of selectionNodes(page, selection)) {
    if (node.type === 'text') families.add(node.text.fontFamily);
  }

  return (
    <CollapsibleSection
      id="text"
      title={t('inspector.section.text')}
      open={open}
      onToggle={(next) => actions.toggleSection('text', next)}
    >
      <FieldRow>
        <SelectField
          label={t('inspector.field.fontFamily')}
          fieldName="fontFamily"
          value={singleOrUndefined(fontFamily)}
          options={[...families].map((family) => ({ value: family, label: family }))}
          onChange={(family) =>
            actions.dispatch(setTextCommands(page, pageId, ids, { fontFamily: family }), history)
          }
        />
      </FieldRow>
      <FieldRow>
        {textControl('fontSize', t('inspector.field.fontSize'), { min: 1, precision: 0 })}
        <SelectField
          label={t('inspector.field.fontWeight')}
          fieldName="fontWeight"
          value={weight === undefined ? undefined : String(weight)}
          options={FONT_WEIGHTS.map((option) => ({
            value: String(option),
            label: String(option),
          }))}
          onChange={(value) =>
            actions.dispatch(
              setTextCommands(page, pageId, ids, { fontWeight: Number(value) }),
              history,
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
              actions.dispatch(
                setTextCommands(page, pageId, ids, {
                  align: align as TextContent['align'],
                }),
                history,
              )
            }
          />
        </div>
      </FieldRow>
    </CollapsibleSection>
  );
});

/** 混合模式档位（P0 六档，与引擎 BlendMode 对齐）。 */
export const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
];
