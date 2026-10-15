'use client';

/**
 * 首页侧栏（FE-02 · B2 侧栏分区）。
 *
 * 结构（对标浅色基准）：分区标题小写字 + 条目 32 高（`--dfg-row-height-md`，随主题密度变），
 * 条目三态：悬停底色 / 选中（`--dfg-color-selection` 底 + 主色文字）/ 图标模式（折叠）。
 *
 * 受控组件：分区与折叠态由父级（store）持有，本组件只报事件——这样选中态只有一处真源，
 * 也让侧栏可以在 `/_design` 之外的任何容器里复用。
 */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  TrashIcon,
} from '@dforge/ui';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { ClockIcon, FolderIcon } from '../icons';
import { cx } from '../lib/cx';
import type { HomeSection } from '../state/home-store';

/** 侧栏 props。 */
export interface HomeSidebarProps {
  /** 当前分区。 */
  section: HomeSection;
  onSelect: (section: HomeSection) => void;
  /** 折叠为图标模式（窄窗让位）。 */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 删除记录条数（回收站条目角标）。 */
  trashCount: number;
}

/** 分区条目定义（顺序即视觉顺序）。 */
const SECTIONS: Array<{ id: HomeSection; label: () => string; icon: ReactNode }> = [
  { id: 'recent', label: () => t('home.nav.recent'), icon: <ClockIcon /> },
  { id: 'local', label: () => t('home.nav.local'), icon: <FolderIcon /> },
  { id: 'trash', label: () => t('home.nav.trash'), icon: <TrashIcon /> },
];

/** 侧栏。 */
export function HomeSidebar({
  section,
  onSelect,
  collapsed,
  onToggleCollapse,
  trashCount,
}: HomeSidebarProps) {
  return (
    <nav
      className={cx('dfg-home__sidebar', collapsed && 'dfg-home__sidebar--collapsed')}
      aria-label={t('home.nav.aria')}
    >
      <div className="dfg-home__sidebar-head">
        <IconButton
          label={collapsed ? t('home.nav.expand') : t('home.nav.collapse')}
          aria-expanded={!collapsed}
          size="sm"
          icon={collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          onClick={onToggleCollapse}
        />
      </div>

      <div className="dfg-home__group-label">{t('home.nav.groupFiles')}</div>

      <ul className="dfg-home__navlist">
        {SECTIONS.map((entry) => {
          const selected = entry.id === section;
          const label = entry.label();
          const isTrash = entry.id === 'trash';
          // 回收站条目把条数并入无障碍名（图标模式下也能听出有几条记录）
          const ariaLabel =
            isTrash && trashCount > 0
              ? t('home.nav.trashCount', { count: trashCount })
              : label;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={cx('dfg-home__navitem', selected && 'dfg-home__navitem--selected')}
                aria-current={selected ? 'true' : undefined}
                aria-label={ariaLabel}
                onClick={() => onSelect(entry.id)}
              >
                <span className="dfg-home__navitem-icon">{entry.icon}</span>
                <span className="dfg-home__navitem-label">{label}</span>
                {isTrash && trashCount > 0 ? (
                  <span className="dfg-home__navitem-count">{trashCount}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
