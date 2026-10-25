'use client';

/**
 * 资产面板（C4：组件 / Token 分段 + 搜索）。
 *
 * 数据来源都是引擎的只读查询：组件走 `listComponents`（含实例数），
 * 令牌走 `resolveAllTokens`（别名已求值）+ `groupTokenPaths`（点分路径分组）。
 * 组件卡点击 = 设置选择（与画布同源）；组件语义色用**组件紫** `--dfg-color-component`。
 *
 * 状态覆盖（验收标准 §5）：loading（骨架卡）/ empty（无组件、无令牌）/ no-results（搜索无果）/
 * error（加载失败 + 重试）/ hover（卡片悬停）/ active（选中组件）各有挂点属性供截图门禁取样。
 */
import { findPage, groupTokenPaths, listComponents, resolveAllTokens } from '@dforge/engine';
import {
  ComponentIcon,
  EmptyState,
  ErrorState,
  Input,
  SegmentedControl,
  Skeleton,
} from '@dforge/ui';
import { useMemo } from 'react';

import { t } from '@/i18n';

import { usePanelsDocument, usePanelsUi } from '../state/hooks';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

/** 资产面板 props（loading/error 状态挂点由壳层喂）。 */
export interface AssetsPanelProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 与左栏页签组合时隐藏自带标题（页签即标题）。 */
  hideHeader?: boolean;
  className?: string;
}

/** 资产面板。 */
export function AssetsPanel({
  loading = false,
  error = null,
  onRetry,
  hideHeader = false,
  className,
}: AssetsPanelProps) {
  const session = usePanelsSession();
  const doc = usePanelsDocument(session);
  const segment = usePanelsUi(session, (state) => state.assetSegment);
  const query = usePanelsUi(session, (state) => state.assetQuery);
  const selection = usePanelsUi(session, (state) => state.selection);

  const page = findPage(doc, session.pageId);
  const components = useMemo(() => (page === undefined ? [] : listComponents(page)), [page]);
  const tokenSet = useMemo(() => resolveAllTokens(doc.tokens), [doc.tokens]);

  const normalized = query.trim().toLowerCase();
  const matches = (text: string): boolean =>
    normalized.length === 0 || text.toLowerCase().includes(normalized);

  const visibleComponents = components.filter((entry) => matches(entry.name));
  const tokenPaths = Object.keys(tokenSet.resolved).sort();
  const visibleTokenPaths = tokenPaths.filter((path) => matches(path));
  const tokenGroups = groupTokenPaths(visibleTokenPaths);

  const componentsEmpty = components.length === 0;

  return (
    <section
      aria-label={t('panels.assets.title')}
      aria-busy={loading}
      data-df-panel="assets"
      data-df-segment={segment}
      className={className === undefined ? 'dfg-panels__panel' : `${className} dfg-panels__panel`}
    >
      {hideHeader ? null : (
        <header className="dfg-panels__header">
          <span className="dfg-panels__header-title">{t('panels.assets.title')}</span>
          <span className="dfg-panels__header-spacer" />
        </header>
      )}

      <div className="dfg-panels__asset-toolbar">
        <SegmentedControl
          label={t('panels.assets.segment.label')}
          size="sm"
          value={segment}
          options={[
            { value: 'components', label: t('panels.assets.segment.components') },
            { value: 'tokens', label: t('panels.assets.segment.tokens') },
          ]}
          onChange={(value) => {
            session.ui.getState().setAssetSegment(value === 'tokens' ? 'tokens' : 'components');
          }}
        />
        <Input
          kind="search"
          size="sm"
          placeholder={t('panels.assets.search.placeholder')}
          value={query}
          onChange={(event) => {
            session.ui.getState().setAssetQuery(event.currentTarget.value);
          }}
        />
      </div>

      {error !== null ? (
        <div data-df-sample="assets/error" className="dfg-panels__body">
          <ErrorState
            title={t('panels.assets.error.title')}
            description={t('panels.assets.error.desc')}
            {...(onRetry === undefined ? {} : { onRetry })}
            retryLabel={t('panels.assets.retry')}
          />
        </div>
      ) : loading ? (
        <div data-df-sample="assets/loading" className="dfg-panels__body">
          <span className="dfg-visually-hidden" role="status">
            {t('panels.assets.loading')}
          </span>
          <div className="dfg-panels__asset-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={`card-${String(index)}`} height="var(--dfg-size-drawer-sm)" />
            ))}
          </div>
        </div>
      ) : segment === 'components' ? (
        <div
          data-df-sample={componentsEmpty ? 'assets/empty' : 'assets/components'}
          className="dfg-panels__body"
        >
          {componentsEmpty ? (
            <EmptyState
              title={t('panels.assets.components.empty.title')}
              description={t('panels.assets.components.empty.desc')}
            />
          ) : visibleComponents.length === 0 ? (
            <div data-df-sample="assets/no-results">
              <EmptyState
                title={t('panels.assets.noResults.title')}
                description={t('panels.assets.noResults.desc')}
              />
            </div>
          ) : (
            <div className="dfg-panels__asset-grid">
              {visibleComponents.map((entry) => {
                const selected = selection.ids.includes(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={entry.name}
                    data-df-asset-component={entry.id}
                    data-df-state={selected ? 'selected' : 'default'}
                    className="dfg-panels__asset-card"
                    onClick={() => {
                      session.ui.getState().selectLayer(entry.id);
                    }}
                  >
                    <span aria-hidden className="dfg-panels__asset-thumb">
                      <ComponentIcon size={24} />
                    </span>
                    <span className="dfg-panels__asset-card-name">{entry.name}</span>
                    <span className="dfg-panels__asset-card-meta">
                      {t('panels.assets.component.instances', { count: entry.instanceCount })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : tokenPaths.length === 0 ? (
        <div data-df-sample="assets/tokens-empty" className="dfg-panels__body">
          <EmptyState
            title={t('panels.assets.tokens.empty.title')}
            description={t('panels.assets.tokens.empty.desc')}
          />
        </div>
      ) : visibleTokenPaths.length === 0 ? (
        <div data-df-sample="assets/no-results" className="dfg-panels__body">
          <EmptyState
            title={t('panels.assets.noResults.title')}
            description={t('panels.assets.noResults.desc')}
          />
        </div>
      ) : (
        <div data-df-sample="assets/tokens" className="dfg-panels__body">
          {Object.entries(tokenGroups).map(([group, paths]) => (
            <div key={group}>
              <div className="dfg-panels__token-group">{group}</div>
              {paths.map((path) => {
                const token = tokenSet.resolved[path];
                const value = token === undefined ? '' : String(token.value);
                const isColor = token !== undefined && token.type === 'color';
                return (
                  <div key={path} data-df-asset-token={path} className="dfg-panels__token-row">
                    <span
                      aria-hidden
                      title={isColor ? t('panels.assets.token.color') : undefined}
                      data-df-token-swatch={isColor ? 'color' : 'plain'}
                      className="dfg-panels__token-swatch"
                      // 颜色令牌的色块取文档里的解析值（文档数据，动态值豁免——工单 06 登记表）
                      style={isColor ? { background: value } : undefined}
                    />
                    <span className="dfg-panels__token-name">{path}</span>
                    <span className="dfg-panels__token-value">{value}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
