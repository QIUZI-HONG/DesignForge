'use client';

/**
 * InspectorPanel —— 属性面板根（RW-10 重写）。
 *
 * 组织（交付 a）：右栏双页签——**设计**（对齐行 + 混合模式/不透明度顶排 +
 * 折叠分区：尺寸/填充/描边/圆角/效果/文字）与**导出**（F15 禁用桩）。
 * 页签与折叠面板用 `@dforge/ui` 的 Tabs/Collapse（roving tabindex、DOM 保留），
 * 折叠开合在面板内记忆——跨选中切换不丢（进入分区记忆）。
 *
 * 刷新（交付 a）：选中集来自 **zustand store**（可选 `selectionStore`，工作区装配的
 * `PanelsUiStore` 结构兼容）；store 变化 → 面板自订阅即时刷新，不依赖宿主整树重渲。
 * 未提供 store 时回落宿主传入的 `selection`（props 受控路径，门禁/预览沿用）。
 * 分区内容为 memo 组件（`sections.tsx`）：页签切换/折叠开合只重渲面板壳，
 * 不重渲字段树（分区级 scoped 重渲）。
 *
 * scrubbing（交付 b）：数值字段经 `SectionActions` 的 scrub 会话接线——
 * 拖拽中零写入，松手单事务提交（`model/scrub-session`，引擎 interaction 会话同语义）。
 *
 * 数据流：读 → `model/readers`（三态：single/mixed/absent）；写 → `model/patches`
 * （批量补丁走引擎命令栈，提交时刻才发命令）。混选值显示「—」，批量修改作用于全选。
 */

import {
  type BlendMode,
  type Command,
  type CommandStack,
  findPage,
  type PageId,
  type Selection,
} from '@dforge/engine';
import { TabPanel, Tabs } from '@dforge/ui';
import { useCallback, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import { t } from '@/i18n';

// 面板样式（令牌变量；禁裸值——样式集中在 inspector.css）
import '../inspector.css';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import { setBlendModeCommands, setNumberCommands } from '../model/patches';
import {
  activeFieldValue,
  type FieldValue,
  readBlendMode,
  readNumberField,
  selectionHasText,
} from '../model/readers';
import { createScrubSession } from '../model/scrub-session';
import { AlignRow } from './AlignRow';
import { CanvasSettings } from './CanvasSettings';
import { FieldRow, SelectField } from './controls';
import { NumberField } from './NumberField';
import {
  BLEND_MODES,
  CornerSection,
  EffectsSection,
  FillSection,
  type InspectorSectionId,
  type SectionActions,
  SizeSection,
  StrokeSection,
  TextSection,
} from './sections';

/** 面板 props。 */
export interface InspectorPanelProps {
  stack: CommandStack;
  pageId: PageId;
  /**
   * 选中集（props 受控路径——门禁/预览/未接 store 的宿主用）；
   * 给出 `selectionStore` 时可省略（store 为准）。
   */
  selection?: Selection | undefined;
  /**
   * zustand 选择态订阅源（RW-10）：结构与工作区装配的 `PanelsUiStore` 兼容
   * （`{ selection }` 片段）。提供后面板自订阅选中变化——即时刷新且不随宿主重渲。
   */
  selectionStore?: SelectionSource | undefined;
}

/**
 * 选择态订阅源（结构最小面）：zustand 只读 store API 的 `{ selection }` 投影——
 * 直接借 zustand 的类型（而不是跨 feature 引 `PanelsUiStore`），useStore 的状态推断才不落 unknown。
 */
export type SelectionSource = Pick<
  StoreApi<{ selection: Selection }>,
  'getState' | 'getInitialState' | 'subscribe'
>;

/** 取混合模式单值（mixed/absent → undefined）。 */
function singleOrUndefined<T>(field: FieldValue<T>): T | undefined {
  return field.kind === 'single' ? field.value : undefined;
}

/** 属性面板（选择态路由：store 订阅路径 / props 受控路径）。 */
export function InspectorPanel({ stack, pageId, selection, selectionStore }: InspectorPanelProps) {
  if (selectionStore !== undefined) {
    return <StoreSelectionPanel stack={stack} pageId={pageId} source={selectionStore} />;
  }
  if (selection === undefined) return null; // 两路都没给：接线配置错误，不渲染
  return <InspectorBody stack={stack} pageId={pageId} selection={selection} />;
}

/** store 订阅路径：zustand 选择态 → 面板（RW-10 交付 a 的订阅点）。 */
function StoreSelectionPanel({
  stack,
  pageId,
  source,
}: {
  stack: CommandStack;
  pageId: PageId;
  source: SelectionSource;
}) {
  const selection = useStore(source, (state) => state.selection);
  return <InspectorBody stack={stack} pageId={pageId} selection={selection} />;
}

/** 面板主体（选择集已就位）。 */
function InspectorBody({
  stack,
  pageId,
  selection,
}: {
  stack: CommandStack;
  pageId: PageId;
  selection: Selection;
}) {
  const document = useDocumentSnapshot(stack);
  const page = findPage(document, pageId);

  // 页签态 + 折叠记忆（交付 a）：跨选中切换保留（面板实例存续期间）
  const [tab, setTab] = useState('design');
  const [collapsed, setCollapsed] = useState<Partial<Record<InspectorSectionId, boolean>>>({});

  // scrub 会话（交付 b）：与命令栈同生命周期；回调集引用稳定（memo 分区边界）
  const scrub = useMemo(() => createScrubSession(stack), [stack]);
  const dispatch = useCallback(
    (commands: readonly Command[], label: string): void => {
      if (commands.length > 0) stack.dispatch(commands, { label });
    },
    [stack],
  );
  const commitCommands = useCallback(
    (commands: readonly Command[], label: string): void => {
      scrub.commit(commands, label);
    },
    [scrub],
  );
  const beginScrub = useCallback(() => scrub.begin(), [scrub]);
  const endScrub = useCallback(() => scrub.end(), [scrub]);
  const toggleSection = useCallback((id: InspectorSectionId, open: boolean): void => {
    setCollapsed((previous) => ({ ...previous, [id]: !open }));
  }, []);
  const actions = useMemo<SectionActions>(
    () => ({ dispatch, beginScrub, endScrub, commitCommands, toggleSection }),
    [dispatch, beginScrub, endScrub, commitCommands, toggleSection],
  );

  if (page === undefined) return null;
  if (selection.ids.length === 0) {
    // C7 空选态 = 画布设置
    return <CanvasSettings stack={stack} pageId={pageId} />;
  }

  const blendMode = readBlendMode(page, selection);
  const hasText = selectionHasText(page, selection);

  /** 折叠分区的公共 props（open 由面板记忆派生）。 */
  const sectionProps = (id: InspectorSectionId) => ({
    stack,
    pageId,
    page,
    selection,
    actions,
    open: collapsed[id] !== true,
  });

  return (
    <aside className="dfi-panel" data-df-inspector="panel" aria-label={t('inspector.a11y.panel')}>
      <Tabs
        label={t('inspector.tabs.label')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'design', label: t('inspector.tab.design') },
          { id: 'export', label: t('inspector.tab.export') },
        ]}
      >
        <TabPanel tab="design" className="dfi-tabpanel">
          <AlignRow stack={stack} pageId={pageId} selection={selection} />
          <FieldRow>
            {/* 混合模式 + 不透明度：设计页顶排（Figma 同构），常驻不折叠 */}
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
                  setBlendModeCommands(page, pageId, selection.ids, mode as BlendMode),
                  t('inspector.history.blendMode'),
                )
              }
            />
            {(() => {
              const opacity = readNumberField(page, selection, 'opacity');
              const base = activeFieldValue(page, selection, (node) => node.opacity);
              return (
                <NumberField
                  label={t('inspector.field.opacity')}
                  fieldName="opacity"
                  value={opacity.kind === 'single' ? Math.round(opacity.value * 100) : undefined}
                  baseValue={base === undefined ? undefined : Math.round(base * 100)}
                  min={0}
                  max={100}
                  precision={0}
                  suffix="%"
                  onScrubStart={beginScrub}
                  onScrubEnd={endScrub}
                  onCommit={(value) =>
                    commitCommands(
                      setNumberCommands(page, pageId, selection.ids, 'opacity', value / 100),
                      t('inspector.history.appearance'),
                    )
                  }
                />
              );
            })()}
          </FieldRow>

          <SizeSection {...sectionProps('size')} />
          <FillSection {...sectionProps('fill')} />
          <StrokeSection {...sectionProps('stroke')} />
          <CornerSection {...sectionProps('corner')} />
          <EffectsSection {...sectionProps('effects')} />
          {hasText ? <TextSection {...sectionProps('text')} /> : null}
        </TabPanel>

        <TabPanel tab="export" className="dfi-tabpanel">
          <FieldRow>
            {/* 导出设置：面板归 C15/F6 票（FE-08 落地）；此处按 F15 禁用态族给桩（灰化 + 原因） */}
            <div
              className="dfi-row-block"
              data-df-inspector-field="export"
              data-df-state="disabled"
            >
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
        </TabPanel>
      </Tabs>
    </aside>
  );
}
