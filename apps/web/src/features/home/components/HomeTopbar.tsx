'use client';

import type { DocumentSummary } from '@dforge/contracts';
/**
 * 首页顶栏（FE-02 · B1 顶栏 56 + B5 新建菜单 + B9 全局搜索 + B10 设置入口）。
 *
 * 结构（对标浅色基准）：高 `--dfg-size-topbar`（56），左品牌、中全局搜索、右新建与设置。
 *
 * B9 搜索的两条结果线：**本地文档**（父级用同一套筛选纯函数算出的命中）与**技能市场**
 * （父级异步查 daemon `/market/query`）。市场侧未就绪时这条线显示降级说明，整体不报错
 * ——市场索引由采集线产出，没跑采集时本就该是空的。
 *
 * B10 无账号简化版：没有头像/账号位，改为「本地优先 · 无需账号」提示 + 设置/快捷键入口；
 * 两条入口在目标页落地前保持禁用并给理由（F15），不做点了没反应的假入口。
 */
import {
  Button,
  DropdownMenu,
  FrameIcon,
  Input,
  type MenuItemSpec,
  PlusIcon,
  SearchIcon,
} from '@dforge/ui';
import { useId, useState } from 'react';

import { t } from '@/i18n';
import type { MarketSearchHit } from '../api/market';
import { GearIcon, TemplateIcon } from '../icons';

/** 技能市场结果线状态。 */
export interface MarketPanelState {
  loading: boolean;
  available: boolean;
  items: MarketSearchHit[];
}

/** 顶栏 props。 */
export interface HomeTopbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** 本地文档命中（父级按当前搜索词算好的前若干条）。 */
  documentHits: DocumentSummary[];
  onOpenDocument: (document: DocumentSummary) => void;
  market: MarketPanelState;
  onOpenMarket: (assetId: string) => void;
  /** B5「设计文件」条目：打开新建对话框（真正的创建走对话框）。 */
  onCreateDesignFile: () => void;
}

/** 顶栏。 */
export function HomeTopbar({
  query,
  onQueryChange,
  documentHits,
  onOpenDocument,
  market,
  onOpenMarket,
  onCreateDesignFile,
}: HomeTopbarProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const panelId = useId();
  const showPanel = searchFocused && !searchCollapsed && query.trim() !== '';
  const nothingFound = documentHits.length === 0 && market.items.length === 0 && !market.loading;

  return (
    <header className="dfg-home__topbar">
      <div className="dfg-home__brand">
        <FrameIcon size={24} />
        <span className="dfg-home__brand-name">{t('home.title')}</span>
      </div>

      {/* 焦点管理挂在容器上：点结果时 focusout 落在容器内部 → 面板不消失（否则 mousedown
          先触发 blur 会把面板卸载掉，click 永远到不了按钮） */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 该容器只观察焦点进出（focusin/focusout）以决定下拉显隐，自身没有点击/键盘动作，给它 role 会把装饰性包裹层塞进无障碍树 */}
      <div
        className="dfg-home__search"
        onFocus={() => {
          setSearchFocused(true);
          setSearchCollapsed(false);
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setSearchFocused(false);
        }}
      >
        <Input
          kind="search"
          className="dfg-home__searchfield"
          aria-label={t('home.search.label')}
          placeholder={t('home.search.placeholder')}
          value={query}
          role="searchbox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? panelId : undefined}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setSearchCollapsed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearchCollapsed(true);
          }}
          trailing={
            query === '' ? undefined : (
              <Button
                variant="ghost"
                size="sm"
                icon={<SearchIcon />}
                onClick={() => onQueryChange('')}
              >
                {t('home.search.clear')}
              </Button>
            )
          }
        />
        {showPanel ? (
          <div
            id={panelId}
            className="dfg-home__searchpanel"
            role="menu"
            aria-label={t('home.search.label')}
          >
            <SearchSection
              title={t('home.search.groupDocuments')}
              empty={t('home.search.noDocuments')}
              items={documentHits.map((document) => ({
                id: document.id,
                label: document.name,
                onSelect: () => onOpenDocument(document),
              }))}
              onSelected={() => setSearchCollapsed(true)}
            />
            <SearchSection
              title={t('home.search.groupMarket')}
              empty={
                market.available ? t('home.search.noMarket') : t('home.search.marketUnavailable')
              }
              loading={market.loading}
              items={market.items.map((hit) => ({
                id: hit.id,
                label: hit.name,
                onSelect: () => onOpenMarket(hit.id),
              }))}
              onSelected={() => setSearchCollapsed(true)}
            />
            {nothingFound ? (
              <div className="dfg-home__searchempty">
                <span className="dfg-home__searchempty-title">{t('home.search.emptyTitle')}</span>
                <span className="dfg-home__searchempty-desc">{t('home.search.emptyDesc')}</span>
                <Button variant="ghost" size="sm" onClick={() => onQueryChange('')}>
                  {t('home.search.emptyAction')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="dfg-home__topbar-actions">
        <DropdownMenu
          label={t('home.new.label')}
          align="end"
          trigger={({ triggerProps }) => (
            <Button {...triggerProps} variant="primary" icon={<PlusIcon />}>
              {t('home.new.label')}
            </Button>
          )}
          sections={[
            {
              id: 'create',
              items: [
                {
                  id: 'design-file',
                  label: t('home.new.designFile'),
                  icon: <FrameIcon />,
                  shortcut: '⌘N',
                  onSelect: onCreateDesignFile,
                },
                {
                  id: 'from-template',
                  label: t('home.new.fromTemplate'),
                  icon: <TemplateIcon />,
                  disabled: true,
                  disabledReason: t('home.new.fromTemplateDisabled'),
                },
              ] satisfies MenuItemSpec[],
            },
          ]}
        />
        <DropdownMenu
          label={t('home.settings.label')}
          align="end"
          trigger={({ triggerProps }) => (
            <Button {...triggerProps} icon={<GearIcon />} aria-label={t('home.settings.label')}>
              {t('home.settings.label')}
            </Button>
          )}
          sections={[
            {
              id: 'account',
              label: t('home.settings.hint'),
              items: [
                {
                  id: 'settings',
                  label: t('home.settings.item'),
                  icon: <GearIcon />,
                  disabled: true,
                  disabledReason: t('home.settings.itemDisabled'),
                },
                {
                  id: 'shortcuts',
                  label: t('home.settings.shortcuts'),
                  disabled: true,
                  disabledReason: t('home.settings.shortcutsDisabled'),
                },
              ] satisfies MenuItemSpec[],
            },
          ]}
        />
      </div>
    </header>
  );
}

/** 搜索结果线上的一个分组。 */
function SearchSection({
  title,
  items,
  empty,
  loading = false,
  onSelected,
}: {
  title: string;
  items: Array<{ id: string; label: string; onSelect: () => void }>;
  empty: string;
  loading?: boolean;
  /** 选中后的收尾（父级收面板）。 */
  onSelected?: () => void;
}) {
  return (
    <div className="dfg-home__searchgroup">
      <div className="dfg-home__searchgroup-title">{title}</div>
      {items.length === 0 ? (
        <div className="dfg-home__searchgroup-empty">
          {loading ? t('home.search.loading') : empty}
        </div>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="dfg-home__searchhit"
            onClick={() => {
              item.onSelect();
              onSelected?.();
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  );
}
