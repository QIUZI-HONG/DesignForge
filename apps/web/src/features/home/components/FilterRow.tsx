'use client';

/**
 * 首页筛选行（FE-02 · B4 筛选 / 排序 / 视图切换）。
 *
 * 结构（对标浅色基准）：单行高 40（`--dfg-space-10`），左侧两个下拉（时间范围 / 排序），
 * 右侧视图切换（单选组）+ 结果计数。下拉面板与条目样式复用 `@dforge/ui` 的
 * DropdownMenu（F3 族：条目 32、圆角 6、图标 16）——本组件只负责业务取值与文案。
 *
 * 受控组件：三个取值都由父级（store）持有。
 */
import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  type MenuItemSpec,
  SegmentedControl,
} from '@dforge/ui';

import { t } from '@/i18n';

import { GridViewIcon, ListViewIcon } from '../icons';
import type { DocumentRange, DocumentSort } from '../lib/filter';
import type { HomeViewMode } from '../state/home-store';

/** 筛选行 props。 */
export interface FilterRowProps {
  range: DocumentRange;
  onRangeChange: (range: DocumentRange) => void;
  sort: DocumentSort;
  onSortChange: (sort: DocumentSort) => void;
  viewMode: HomeViewMode;
  onViewModeChange: (mode: HomeViewMode) => void;
  /** 当前列表条数（筛选后的结果计数）。 */
  resultCount: number;
}

/** 时间范围选项（顺序即菜单顺序）。 */
const RANGE_OPTIONS: Array<{ value: DocumentRange; label: () => string }> = [
  { value: 'all', label: () => t('home.filter.range.all') },
  { value: 'today', label: () => t('home.filter.range.today') },
  { value: 'week', label: () => t('home.filter.range.week') },
  { value: 'month', label: () => t('home.filter.range.month') },
];

/** 排序选项。 */
const SORT_OPTIONS: Array<{ value: DocumentSort; label: () => string }> = [
  { value: 'updated-desc', label: () => t('home.filter.sort.updated') },
  { value: 'created-desc', label: () => t('home.filter.sort.created') },
  { value: 'name-asc', label: () => t('home.filter.sort.name') },
];

/** 取当前选项文案。 */
function labelOf<T extends string>(
  options: Array<{ value: T; label: () => string }>,
  value: T,
): string {
  return options.find((option) => option.value === value)?.label() ?? value;
}

/** 筛选行。 */
export function FilterRow({
  range,
  onRangeChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  resultCount,
}: FilterRowProps) {
  const rangeLabel = labelOf(RANGE_OPTIONS, range);
  const sortLabel = labelOf(SORT_OPTIONS, sort);

  /** 下拉条目：文案 + 选中勾（选中态用勾号而不是底色，符合菜单族口径）。 */
  const toItems = <T extends string>(
    options: Array<{ value: T; label: () => string }>,
    current: T,
    onSelect: (value: T) => void,
  ): MenuItemSpec[] =>
    options.map((option) => ({
      id: option.value,
      label: option.label(),
      icon: option.value === current ? <CheckMark /> : undefined,
      onSelect: () => onSelect(option.value),
    }));

  return (
    // 不加 role="group"：行内两个下拉与一个单选组各自带无障碍名，再包一层具名分组
    // 反而把「筛选行」听成表单域；`data-df-home` 只作为截图门禁的取样挂点
    <div className="dfg-home__filterrow" data-df-home="filter-row">
      <DropdownMenu
        label={t('home.filter.range')}
        sections={[{ id: 'range', items: toItems(RANGE_OPTIONS, range, onRangeChange) }]}
        trigger={({ triggerProps }) => (
          <Button
            {...triggerProps}
            aria-label={`${t('home.filter.range')}：${rangeLabel}`}
            icon={<ChevronDownIcon />}
          >
            {rangeLabel}
          </Button>
        )}
      />
      <DropdownMenu
        label={t('home.filter.sort')}
        sections={[{ id: 'sort', items: toItems(SORT_OPTIONS, sort, onSortChange) }]}
        trigger={({ triggerProps }) => (
          <Button
            {...triggerProps}
            aria-label={`${t('home.filter.sort')}：${sortLabel}`}
            icon={<ChevronDownIcon />}
          >
            {sortLabel}
          </Button>
        )}
      />
      <div className="dfg-home__filterrow-end">
        <span className="dfg-home__count">{t('home.filter.count', { count: resultCount })}</span>
        <SegmentedControl
          label={t('home.filter.view')}
          value={viewMode}
          onChange={(value) => onViewModeChange(value === 'list' ? 'list' : 'grid')}
          options={[
            { value: 'grid', label: t('home.filter.view.grid'), icon: <GridViewIcon /> },
            { value: 'list', label: t('home.filter.view.list'), icon: <ListViewIcon /> },
          ]}
        />
      </div>
    </div>
  );
}

/** 菜单选中勾（小尺寸勾号，避免为菜单项额外引一个图标依赖）。 */
function CheckMark() {
  return (
    <span className="dfg-home__check" aria-hidden="true">
      ✓
    </span>
  );
}
