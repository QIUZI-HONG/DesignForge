'use client';

/**
 * 文件列表容器（FE-02 · B1 网格 / B4 列表）。
 *
 * 两种视图**同一批卡片、同一套语义**，只是布局不同（父级 `data-view` 切换 CSS 网格/行）。
 * 之所以不做「列表专用组件」：卡片的信息密度（名称 + 页面数 + 更新时间）两视图一致，
 * 拆两份组件只会让两处文案与交互各自漂移。
 */
import type { DocumentSummary } from '@dforge/contracts';

import { cx } from '../lib/cx';
import type { HomeViewMode } from '../state/home-store';
import { DocumentCard } from './DocumentCard';

/** 列表容器 props。 */
export interface DocumentGridProps {
  viewMode: HomeViewMode;
  documents: DocumentSummary[];
  now: () => Date;
  onOpen: (document: DocumentSummary) => void;
  onRequestDelete: (document: DocumentSummary) => void;
}

/** 文件列表（网格/列表）。 */
export function DocumentGrid({
  viewMode,
  documents,
  now,
  onOpen,
  onRequestDelete,
}: DocumentGridProps) {
  return (
    <ul className={cx('dfg-home__files')} data-view={viewMode}>
      {documents.map((document) => (
        <DocumentCard
          key={document.id}
          document={document}
          now={now}
          onOpen={onOpen}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </ul>
  );
}
