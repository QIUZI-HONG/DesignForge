'use client';

/**
 * 版本对比浮层（F10 第一步：**并排对比**；第二步的确认在底栏）。
 *
 * 布局口径：两栏并排——左「该版本」（快照）、右「当前」；每栏给出摘要
 * （文档名 / 页数 / 图层数）与首个画板的 DOM 预览（同 Present 的 `SlidePreview`），
 * 下方是逐页差异清单（新增 / 删除 / 改动 / 无改动 + 节点增删改计数）。
 *
 * 为什么是全屏浮层而不是抽屉内嵌：抽屉宽 420，两栏并排在窄抽屉里无法真实「并排」；
 * Figma 本体的版本对比也是铺开的视图。浮层保留 `data-df-version-compare` 挂点供门禁取样。
 */
import type { DesignDocument } from '@dforge/engine';
import type { CSSProperties } from 'react';

import { t } from '@/i18n';
import { formatTimestamp } from '../format';
import { SlidePreview } from '../present/SlidePreview';
import { buildSlides, frameOf } from '../present/sequence';
import { useReviewDocument, useReviewSession, useVersionsUi } from '../review-context';
import { reviewStyles, versionStyles } from '../styles';
import { type DocumentDiff, documentSummary, type PageDiffEntry } from './snapshots';

/** 版本对比浮层。 */
export function VersionCompare() {
  const session = useReviewSession();
  const compareId = useVersionsUi(session, (state) => state.compareId);
  const document_ = useReviewDocument(session);

  if (compareId === null) return null;
  const snapshot = session.versions.getState().snapshots.find((item) => item.id === compareId);
  if (snapshot === undefined) return null;
  const diff = session.versions.getState().diffOf(compareId);

  return (
    <section
      data-df-version-compare=""
      data-df-state="compare"
      aria-label={t('review.versions.compare.title')}
      style={versionStyles.overlay}
    >
      <header style={versionStyles.overlayHeader}>
        <span style={reviewStyles.panelTitle}>{t('review.versions.compare.title')}</span>
        <span style={reviewStyles.meta}>
          {snapshot.label === '' ? snapshot.id : snapshot.label} ·{' '}
          {formatTimestamp(snapshot.createdAt)}
        </span>
      </header>

      <div style={versionStyles.columns}>
        <CompareColumn
          side="baseline"
          title={t('review.versions.compare.baseline')}
          document={snapshot.document}
        />
        <CompareColumn
          side="current"
          title={t('review.versions.compare.current')}
          document={document_}
        />
      </div>

      <section
        data-df-version-diff=""
        aria-label={t('review.versions.compare.pagesLabel')}
        style={versionStyles.diffPanel}
      >
        <span style={reviewStyles.meta}>{t('review.versions.compare.pagesLabel')}</span>
        {diff === null || !diff.changed ? (
          <span data-df-version-unchanged="" style={reviewStyles.emptyDesc}>
            {t('review.versions.compare.unchanged')}
          </span>
        ) : (
          <DiffList diff={diff} />
        )}
      </section>

      <footer style={versionStyles.footer}>
        <span style={versionStyles.confirmHint}>{t('review.versions.confirm.hint')}</span>
        <button
          type="button"
          className="dfg-btn dfg-btn--ghost dfg-btn--sm"
          onClick={() => {
            session.versions.getState().cancelCompare();
          }}
        >
          {t('review.versions.confirm.cancel')}
        </button>
        <button
          type="button"
          className="dfg-btn dfg-btn--primary dfg-btn--sm"
          data-df-version-confirm=""
          onClick={() => {
            session.versions.getState().confirmRestore(t('review.versions.autoLabel'));
          }}
        >
          {t('review.versions.confirm.submit')}
        </button>
      </footer>
    </section>
  );
}

/** 一栏：摘要 + 首个画板预览。 */
function CompareColumn({
  side,
  title,
  document: designDocument,
}: {
  side: 'baseline' | 'current';
  title: string;
  document: DesignDocument;
}) {
  const summary = documentSummary(designDocument);
  const slide = buildSlides(designDocument)[0];
  const frame = slide === undefined ? null : frameOf(designDocument, slide);

  return (
    <section data-df-version-column={side} aria-label={title} style={versionStyles.column}>
      <header style={versionStyles.columnHeader}>
        <span style={reviewStyles.panelTitle}>{title}</span>
        <span style={reviewStyles.meta}>{designDocument.name}</span>
        <span style={reviewStyles.meta}>
          {t('review.versions.summary', { pages: summary.pages, nodes: summary.nodes })}
        </span>
      </header>
      <div style={versionStyles.columnPreview}>
        {slide !== undefined && frame !== null ? (
          <SlidePreview frame={frame} pageId={slide.pageId} document={designDocument} />
        ) : (
          <span style={reviewStyles.emptyDesc}>{t('review.present.empty.desc')}</span>
        )}
      </div>
    </section>
  );
}

/** 逐页差异清单。 */
function DiffList({ diff }: { diff: DocumentDiff }) {
  return (
    <ul style={reviewStyles.listReset} aria-label={t('review.versions.compare.pagesLabel')}>
      {diff.nameChanged ? (
        <li style={versionStyles.diffRow}>
          <span>{t('review.versions.compare.nameChanged')}</span>
        </li>
      ) : null}
      {diff.tokensChanged ? (
        <li style={versionStyles.diffRow}>
          <span>{t('review.versions.compare.tokensChanged')}</span>
        </li>
      ) : null}
      {diff.pages.map((page) => (
        <li
          key={page.pageId}
          data-df-version-page={page.pageId}
          data-df-state={page.status}
          style={versionStyles.diffRow}
        >
          <span>{page.name}</span>
          <span style={reviewStyles.meta}>{statusText(page)}</span>
        </li>
      ))}
    </ul>
  );
}

/** 页面状态文案（含节点计数）。 */
function statusText(page: PageDiffEntry): string {
  switch (page.status) {
    case 'added':
      return t('review.versions.compare.pageAdded');
    case 'removed':
      return t('review.versions.compare.pageRemoved');
    case 'unchanged':
      return t('review.versions.compare.pageUnchanged');
    case 'changed': {
      const parts: string[] = [];
      if (page.nodesAdded > 0)
        parts.push(t('review.versions.compare.nodesAdded', { count: page.nodesAdded }));
      if (page.nodesRemoved > 0)
        parts.push(t('review.versions.compare.nodesRemoved', { count: page.nodesRemoved }));
      if (page.nodesChanged > 0)
        parts.push(t('review.versions.compare.nodesChanged', { count: page.nodesChanged }));
      return parts.length > 0 ? parts.join(' · ') : t('review.versions.compare.pageChanged');
    }
    default:
      return '';
  }
}

/** 供样式模块引用的类型（保持样式对象在本模块外定义）。 */
export type VersionCompareStyles = Record<string, CSSProperties>;
