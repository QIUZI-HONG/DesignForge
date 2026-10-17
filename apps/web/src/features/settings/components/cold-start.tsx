'use client';

/**
 * 空库冷启动（FE-09 · 清单 E6，自设计页：空态 → 一键示例 → 进编辑器）。
 *
 * 流程：查文档清单 → 空库出空态（主按钮「一键示例」）→ 示例文档由 daemon 创建
 * （`POST /documents`，命名走 i18n 的 `coldstart.exampleName`）→ 进入编辑器。
 * 库中已有文件时本页只是分流提示（返回首页），不再重复冷启动动作。
 *
 * daemon 未启动是一等状态：错误态给「重启本地服务」引导 + 重试，不吞错也不假成功。
 * 编辑器地址形状归 FE-02 单点收敛（`features/home` 公开面导出的 `editorHref`，
 * `?documentId=`）——本页只经公开面消费，不另立约定也不引深路径；FE-03 编辑器接管解析。
 *
 * 六态挂点：`loading`（查清单中）/ `empty`（空态）/ `error`（daemon 不可达 / 创建失败）。
 */
import { Button, EmptyState, ErrorState, Spinner } from '@dforge/ui';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { editorHref } from '@/features/home';
import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';
import { useDaemonEndpointHref } from '@/lib/daemon-href';

import { DaemonClientError } from '../api/daemon-client';
import { createSettingsApi, type SettingsApi } from '../api/settings-api';
import { saveErrorMessage } from '../model/save-state';

/** 页面相。 */
type ColdStartPhase = 'loading' | 'empty' | 'exists' | 'error';

/** ColdStart props。 */
export interface ColdStartProps {
  /** 数据面注入（测试用）。 */
  api?: SettingsApi;
  /** 进入编辑器（缺省整页跳转到 FE-02 约定的 `/editor?documentId=…`）。 */
  onEnterEditor?: (documentId: string) => void;
}

/** 缺省进入编辑器：整页跳转（地址形状见 FE-02 的 `editorHref`），端点参数经单点续写（D-3）。 */
function defaultEnterEditor(documentId: string): void {
  if (typeof window !== 'undefined') {
    window.location.assign(withDaemonEndpoint(editorHref(documentId)));
  }
}

const styles = {
  page: {
    display: 'grid',
    // alignContent: start —— 行按内容高度排布，避免 minHeight:100vh 把页头行撑开
    alignContent: 'start',
    gap: 'var(--dfg-space-6)',
    padding: 'var(--dfg-space-8)',
    minHeight: '100vh',
    background: 'var(--dfg-color-surface)',
    color: 'var(--dfg-color-text-primary)',
    fontFamily: 'var(--dfg-font-sans)',
    fontSize: 'var(--dfg-font-size-13)',
  },
  header: { display: 'grid', gap: 'var(--dfg-space-2)' },
  title: {
    margin: 0,
    fontSize: 'var(--dfg-font-size-24)',
    fontWeight: 'var(--dfg-font-weight-bold)',
  },
  subtitle: {
    margin: 0,
    color: 'var(--dfg-color-text-secondary)',
    lineHeight: 'var(--dfg-line-height-relaxed)',
  },
  stage: {
    display: 'grid',
    gap: 'var(--dfg-space-4)',
    placeItems: 'center',
    padding: 'var(--dfg-space-8)',
    border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-lg)',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    color: 'var(--dfg-color-text-secondary)',
  },
  errorLine: { margin: 0, color: 'var(--dfg-color-danger)', fontSize: 'var(--dfg-font-size-12)' },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 'var(--dfg-control-height-md)',
    paddingInline: 'var(--dfg-control-padding-x-md)',
    background: 'var(--dfg-color-primary)',
    color: 'var(--dfg-color-on-primary)',
    borderRadius: 'var(--dfg-radius-md)',
    textDecoration: 'none',
  },
} satisfies Record<string, CSSProperties>;

/** 空库冷启动页。 */
export function ColdStart({ api, onEnterEditor }: ColdStartProps) {
  const client = useMemo(() => api ?? createSettingsApi(), [api]);
  const [phase, setPhase] = useState<ColdStartPhase>('loading');
  const [documentCount, setDocumentCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // 「返回首页」链接地址：续写当前端点参数（D-3/UX-01，首帧与 SSR 同口径）
  const homeHref = useDaemonEndpointHref('/');

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setLoadError(null);
    try {
      const list = await client.listDocuments();
      setDocumentCount(list.documents.length);
      setPhase(list.documents.length === 0 ? 'empty' : 'exists');
    } catch (error) {
      setLoadError(saveErrorMessage(error));
      setPhase('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const createExample = async (): Promise<void> => {
    setCreating(true);
    setCreateError(null);
    const exampleName = t('coldstart.exampleName');
    try {
      const document = await client.createDocument(exampleName);
      (onEnterEditor ?? defaultEnterEditor)(document.id);
    } catch (error) {
      // 幂等：「一键示例」重按 / 示例已存在不报错——改为打开既有示例文档
      if (error instanceof DaemonClientError && error.code === 'doc_exists') {
        try {
          const list = await client.listDocuments();
          const existing = list.documents.find((item) => item.name === exampleName);
          if (existing !== undefined) {
            (onEnterEditor ?? defaultEnterEditor)(existing.id);
            return;
          }
        } catch {
          // 落到统一失败提示（下面 setCreateError）
        }
      }
      setCreateError(saveErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('coldstart.title')}</h1>
        <p style={styles.subtitle}>{t('coldstart.subtitle')}</p>
      </header>

      <div style={styles.stage}>
        {phase === 'loading' ? (
          <div style={styles.loading} data-df-state="loading">
            <Spinner label={t('coldstart.loading')} />
            <span>{t('coldstart.loading')}</span>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div data-df-state="error" style={{ display: 'grid', gap: 'var(--dfg-space-2)' }}>
            <ErrorState
              title={t('coldstart.unreachable.title')}
              description={t('coldstart.unreachable.desc')}
              retryLabel={t('coldstart.action.retry')}
              onRetry={() => {
                void load();
              }}
            />
            {loadError === null ? null : <p style={styles.errorLine}>{loadError}</p>}
          </div>
        ) : null}

        {phase === 'empty' ? (
          <div data-df-state="empty" style={{ display: 'grid', gap: 'var(--dfg-space-3)' }}>
            <EmptyState
              title={t('coldstart.empty.title')}
              description={t('coldstart.empty.desc')}
              action={
                <Button
                  variant="primary"
                  loading={creating}
                  loadingLabel={t('coldstart.creating')}
                  onClick={() => {
                    void createExample();
                  }}
                >
                  {t('coldstart.empty.action')}
                </Button>
              }
            />
            {createError === null ? null : (
              <p style={styles.errorLine} role="alert">
                {t('coldstart.createFailed', { message: createError })}
              </p>
            )}
          </div>
        ) : null}

        {phase === 'exists' ? (
          <EmptyState
            title={t('coldstart.exists.title', { count: documentCount })}
            description={t('coldstart.exists.desc')}
            action={
              <a href={homeHref} style={styles.link}>
                {t('coldstart.exists.action')}
              </a>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
