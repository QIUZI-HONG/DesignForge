'use client';

/**
 * 版本历史抽屉（C14）：右抽屉 + 时间戳列表 + 两步确认回滚入口。
 *
 * 两步确认的界面表达（F10）：
 * - 列表条目的主操作是「对比」→ 打开并排对比浮层（`VersionCompare`，**不改文档**）；
 * - 对比浮层的底栏才是「确认恢复」→ 派发 `document.replace`（命令栈唯一写入口，可撤销）。
 * 抽屉本身不提供「一键回滚」——避免误触把没看过的版本盖回去。
 *
 * 存储口径：本地快照目录（`storage.ts` 模块头写明 daemon 无版本路由的兜底声明）。
 * `data-df-*` 挂点是门禁取样契约（`scripts/verify-figma-review.mjs`）。
 */
import { Drawer } from '@dforge/ui';
import { useState } from 'react';

import { t } from '@/i18n';
import { formatTimestamp } from '../format';
import { useReviewSession, useVersionsUi } from '../review-context';
import { reviewStyles, versionStyles } from '../styles';
import { documentSummary, type VersionSnapshot } from './snapshots';
import { VersionCompare } from './VersionCompare';

/** 版本历史抽屉。 */
export function VersionsDrawer() {
  const session = useReviewSession();
  const open = useVersionsUi(session, (state) => state.open);
  const snapshots = useVersionsUi(session, (state) => state.snapshots);

  return (
    <>
      <div data-df-versions-root="">
        <Drawer
          open={open}
          onOpenChange={(next) => {
            session.versions.getState().setOpen(next);
          }}
          title={t('review.versions.title')}
          description={t('review.versions.description')}
          width="md"
          closeLabel={t('review.versions.close')}
        >
          <div style={versionStyles.drawerBody}>
            <button
              type="button"
              className="dfg-btn dfg-btn--secondary dfg-btn--sm"
              data-df-version-capture=""
              onClick={() => {
                session.versions.getState().capture(t('review.versions.defaultLabel'));
              }}
            >
              {t('review.versions.capture')}
            </button>

            {snapshots.length === 0 ? (
              <div data-df-sample="versions/empty" style={reviewStyles.empty}>
                <span style={reviewStyles.emptyTitle}>{t('review.versions.empty.title')}</span>
                <span style={reviewStyles.emptyDesc}>{t('review.versions.empty.desc')}</span>
              </div>
            ) : (
              <ul aria-label={t('review.versions.list.label')} style={reviewStyles.listReset}>
                {snapshots.map((snapshot) => (
                  <VersionRow key={snapshot.id} snapshot={snapshot} />
                ))}
              </ul>
            )}
          </div>
        </Drawer>
      </div>
      <VersionCompare />
    </>
  );
}

/** 一条版本记录（标签 / 时间戳 / 摘要 / 对比 + 删除）。 */
function VersionRow({ snapshot }: { snapshot: VersionSnapshot }) {
  const session = useReviewSession();
  const [hover, setHover] = useState(false);
  const summary = documentSummary(snapshot.document);
  return (
    <li
      data-df-version-row=""
      data-df-version-id={snapshot.id}
      data-df-state={hover ? 'hover' : 'idle'}
      style={versionStyles.row}
      onMouseEnter={() => {
        setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
      }}
    >
      <span style={versionStyles.rowHead}>
        <span style={reviewStyles.panelTitle}>
          {snapshot.label === '' ? snapshot.id : snapshot.label}
        </span>
        <span data-df-version-time="" style={reviewStyles.meta}>
          {formatTimestamp(snapshot.createdAt)}
        </span>
      </span>
      <span style={reviewStyles.meta}>
        {t('review.versions.summary', { pages: summary.pages, nodes: summary.nodes })}
      </span>
      <span style={versionStyles.rowActions}>
        <button
          type="button"
          className="dfg-btn dfg-btn--secondary dfg-btn--sm"
          onClick={() => {
            session.versions.getState().beginCompare(snapshot.id);
          }}
        >
          {t('review.versions.compare')}
        </button>
        <button
          type="button"
          className="dfg-btn dfg-btn--ghost dfg-btn--sm"
          onClick={() => {
            session.versions.getState().remove(snapshot.id);
          }}
        >
          {t('review.versions.remove')}
        </button>
      </span>
    </li>
  );
}
