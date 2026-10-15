'use client';

/**
 * FilterBar —— 市场筛选栏与搜索（D1 筛选栏 + D3 搜索与筛选）。
 *
 * 一级标签（全部/技能/插件/设计系统/模板）+ 二级（市场 | 已装载）+ 搜索框 +
 * 排序/品类/泳道/许可档下拉 + 场景 chips + 来源仓库输入 + 清空筛选。
 * 下拉一律用 `@dforge/ui` 的 `DropdownMenu`（F3：条目高 32、圆角 6、选中打勾），
 * 文案全部走 i18n；筛选状态由页面持有（受控组件，便于测试与 URL 化）。
 */

import type { MarketCategory, MarketLane } from '@dforge/contracts';
import { MARKET_CATEGORIES } from '@dforge/contracts';
import {
  Button,
  CheckIcon,
  ChevronDownIcon,
  DropdownMenu,
  Input,
  SegmentedControl,
} from '@dforge/ui';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import {
  activeFilterCount,
  hasActiveFilters,
  MARKET_KIND_TABS,
  type MarketFilters,
} from '../filters';
import { badgeRowStyle, filterBarStyle, filterRowStyle, hintStyle, toolbarStyle } from '../styles';

/** 泳道词表（§1.4；中文口径按规格原词）。 */
const LANES: readonly { value: MarketLane; labelKey: string }[] = [
  { value: 'create', labelKey: 'market.lane.create' },
  { value: 'refine', labelKey: 'market.lane.refine' },
  { value: 'deliver', labelKey: 'market.lane.deliver' },
];

/** 许可档选项（全部 + 三档；`blocked` 不在列表但保留词条以便展示）。 */
const LICENSE_OPTIONS: readonly { value: MarketFilters['licenseGate']; labelKey: string }[] = [
  { value: 'all', labelKey: 'market.filter.all' },
  { value: 'loadable', labelKey: 'market.license.loadable.label' },
  { value: 'view-only', labelKey: 'market.license.viewOnly.label' },
];

/** 排序选项。 */
const SORT_OPTIONS: readonly { value: MarketFilters['sort']; labelKey: string }[] = [
  { value: 'score', labelKey: 'market.filter.sort.score' },
  { value: 'updated', labelKey: 'market.filter.sort.updated' },
  { value: 'name', labelKey: 'market.filter.sort.name' },
];

/** 筛选栏 props（受控：状态在页面，事件回传 patch）。 */
export interface FilterBarProps {
  filters: MarketFilters;
  /** 场景 chips 数据（当前结果集并集；空数组则不渲染 chips 区）。 */
  scenes: readonly string[];
  /** 二级标签：市场 | 已装载。 */
  installedView: boolean;
  /** 结果计数（索引缺失时为 null，不显示「0 个资源」误导）。 */
  total: number | null;
  /** 可装载计数（索引缺失时 null）。 */
  loadableCount: number | null;
  /** 索引生成时刻（ISO；无索引不显示）。 */
  generatedAt: string | null;
  onChange: (patch: Partial<MarketFilters>) => void;
  onInstalledViewChange: (installed: boolean) => void;
  onClear: () => void;
}

/** 筛选栏。 */
export function FilterBar({
  filters,
  scenes,
  installedView,
  total,
  loadableCount,
  generatedAt,
  onChange,
  onInstalledViewChange,
  onClear,
}: FilterBarProps) {
  const filterCount = activeFilterCount(filters);
  const kindLabelKeys = new Map(MARKET_KIND_TABS.map((tab) => [tab.value, tab.labelKey]));

  return (
    <section style={filterBarStyle} data-df-page="market-home" data-df-market="filter-bar">
      <div style={toolbarStyle}>
        <div style={{ flex: '1 1 auto', minWidth: 'var(--dfg-size-menu-min-width)' }}>
          <Input
            kind="search"
            value={filters.query}
            aria-label={t('market.search.label')}
            placeholder={t('market.search.placeholder')}
            onChange={(event) => {
              onChange({ query: event.currentTarget.value });
            }}
          />
        </div>
        <SegmentedControl
          label={t('market.filter.scope')}
          value={installedView ? 'installed' : 'market'}
          onChange={(value) => {
            onInstalledViewChange(value === 'installed');
          }}
          options={[
            { value: 'market', label: t('market.filter.market') },
            { value: 'installed', label: t('market.filter.installed') },
          ]}
        />
      </div>

      <div
        style={toolbarStyle}
        role="tablist"
        aria-label={t('market.filter.kind')}
        data-df-market="kind-tabs"
      >
        {MARKET_KIND_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={filters.kind === tab.value ? 'primary' : 'ghost'}
            aria-pressed={filters.kind === tab.value}
            onClick={() => {
              onChange({ kind: tab.value });
            }}
          >
            {t(kindLabelKeys.get(tab.value) ?? 'market.kind.all')}
          </Button>
        ))}
      </div>

      <div style={filterRowStyle}>
        <SelectMenu
          label={t('market.filter.sort')}
          valueLabel={t(
            SORT_OPTIONS.find((option) => option.value === filters.sort)?.labelKey ??
              'market.filter.sort.score',
          )}
          options={SORT_OPTIONS.map((option) => ({
            id: option.value,
            label: t(option.labelKey),
            selected: filters.sort === option.value,
            onSelect: () => {
              onChange({ sort: option.value });
            },
          }))}
        />
        <SelectMenu
          label={t('market.filter.category')}
          valueLabel={filters.category === 'all' ? t('market.filter.all') : filters.category}
          options={[
            {
              id: 'all',
              label: t('market.filter.all'),
              selected: filters.category === 'all',
              onSelect: () => {
                onChange({ category: 'all' });
              },
            },
            ...MARKET_CATEGORIES.map((category: MarketCategory) => ({
              id: category,
              label: category,
              selected: filters.category === category,
              onSelect: () => {
                onChange({ category });
              },
            })),
          ]}
        />
        <SelectMenu
          label={t('market.filter.lane')}
          valueLabel={
            filters.lane === 'all'
              ? t('market.filter.all')
              : t(
                  LANES.find((lane) => lane.value === filters.lane)?.labelKey ??
                    'market.filter.all',
                )
          }
          options={[
            {
              id: 'all',
              label: t('market.filter.all'),
              selected: filters.lane === 'all',
              onSelect: () => {
                onChange({ lane: 'all' });
              },
            },
            ...LANES.map((lane) => ({
              id: lane.value,
              label: t(lane.labelKey),
              selected: filters.lane === lane.value,
              onSelect: () => {
                onChange({ lane: lane.value });
              },
            })),
          ]}
        />
        <SelectMenu
          label={t('market.filter.license')}
          valueLabel={t(
            LICENSE_OPTIONS.find((option) => option.value === filters.licenseGate)?.labelKey ??
              'market.filter.all',
          )}
          options={LICENSE_OPTIONS.map((option) => ({
            id: option.value,
            label: t(option.labelKey),
            selected: filters.licenseGate === option.value,
            onSelect: () => {
              onChange({ licenseGate: option.value });
            },
          }))}
        />
        <div style={{ minWidth: 'var(--dfg-size-menu-min-width)' }}>
          <Input
            value={filters.repo}
            aria-label={t('market.filter.source')}
            placeholder={t('market.filter.sourcePlaceholder')}
            onChange={(event) => {
              onChange({ repo: event.currentTarget.value });
            }}
          />
        </div>
        <Button
          size="sm"
          variant={filters.loadedOnly ? 'primary' : 'secondary'}
          aria-pressed={filters.loadedOnly}
          onClick={() => {
            onChange({ loadedOnly: !filters.loadedOnly });
          }}
        >
          {t('market.filter.loadedOnly')}
        </Button>
        {hasActiveFilters(filters) ? (
          <Button size="sm" variant="ghost" onClick={onClear} data-df-market="clear-filters">
            {t('market.filter.clear')}
          </Button>
        ) : null}
        {filterCount > 0 ? (
          <span style={hintStyle} data-df-market="filter-count">
            {t('market.filter.activeCount', { count: filterCount })}
          </span>
        ) : null}
      </div>

      {scenes.length > 0 ? (
        <div style={badgeRowStyle} data-df-market="scene-chips">
          <span style={hintStyle}>{t('market.scene.label')}</span>
          {scenes.map((scene) => (
            <Button
              key={scene}
              size="sm"
              variant={filters.scene === scene ? 'primary' : 'ghost'}
              aria-pressed={filters.scene === scene}
              onClick={() => {
                onChange({ scene: filters.scene === scene ? null : scene });
              }}
            >
              {scene}
            </Button>
          ))}
        </div>
      ) : null}

      <div style={badgeRowStyle} data-df-market="summary">
        <span style={hintStyle} data-df-market="result-count">
          {total === null
            ? t('market.loading')
            : t('market.summary', {
                total,
                loadable: loadableCount ?? 0,
              })}
        </span>
        {generatedAt === null ? null : (
          <span style={hintStyle}>{t('market.generatedAt', { at: generatedAt })}</span>
        )}
      </div>
    </section>
  );
}

/** 下拉选择（触发器显示当前值；选中项打勾）。 */
function SelectMenu({
  label,
  valueLabel,
  options,
}: {
  label: string;
  valueLabel: string;
  options: readonly {
    id: string;
    label: string;
    selected: boolean;
    onSelect: () => void;
  }[];
}) {
  const triggerLabel: ReactNode = (
    <>
      {valueLabel}
      <ChevronDownIcon size={12} />
    </>
  );
  return (
    <DropdownMenu
      label={label}
      align="start"
      trigger={(state) => (
        <Button
          size="sm"
          variant="secondary"
          icon={null}
          // 触发器的可访问名带维度前缀（「排序：综合评分」）——读屏与用例都能唯一定位该下拉
          aria-label={`${label}：${valueLabel}`}
          aria-haspopup={state.triggerProps['aria-haspopup']}
          aria-expanded={state.triggerProps['aria-expanded']}
          aria-controls={state.triggerProps['aria-controls']}
          onClick={state.toggle}
          onKeyDown={state.triggerProps.onKeyDown}
          ref={state.triggerProps.ref}
          data-df-market="select"
          data-df-select={label}
        >
          {triggerLabel}
        </Button>
      )}
      sections={[
        {
          id: 'options',
          items: options.map((option) => ({
            id: option.id,
            label: option.label,
            icon: option.selected ? <CheckIcon size={12} /> : undefined,
            onSelect: option.onSelect,
          })),
        },
      ]}
    />
  );
}
