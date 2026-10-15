'use client';

/**
 * 诊断面板（F8）——版本/环境、日志尾部、连通性自检（逐项状态 + 重试）。
 *
 * 口径（清单 F8 + 架构 v1.1 §7 诊断）：
 * - 版本与环境：daemon 握手（`/health`）+ 渲染侧环境（浏览器/桌面壳、平台、视口、DPR）；
 * - 连通性自检：`POST /config/connectivity` 的三项（本地服务 / ComfyUI / DeepSeek），
 *   逐项状态 + 可执行动作 + 逐项重试（本段自检是 daemon 的单次调用，逐项重试即重跑自检）；
 * - 日志尾部：本地事件日志（`/telemetry/events`）的最后 N 条，**仅本机、不上云**；
 * - daemon 不可达时给错误横幅（F14）+ 全量重试；未连接的行显示「未连接」而非空白。
 */
import { AlertTriangleIcon, Button, Drawer } from '@dforge/ui';
import { useMemo } from 'react';

import { t } from '@/i18n';

import { createDiagnosticsPort, type DiagnosticsPort } from '../client';
import {
  ENVIRONMENT_ROW_IDS,
  type EnvironmentInput,
  type EnvironmentRowId,
  environmentSnapshot,
  uptimeParts,
} from '../environment';
import { logTail } from '../logs';
import { diagnosticsStyles } from './styles';
import { useDiagnostics } from './use-diagnostics';

/** 环境注入（测试/门禁可给；缺省读 window/navigator）。 */
export type DiagnosticsEnv = Omit<EnvironmentInput, 'health'>;

/** DiagnosticsPanel props。 */
export interface DiagnosticsPanelProps {
  port?: DiagnosticsPort;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 渲染侧环境（不给则从 window/navigator 读取）。 */
  env?: DiagnosticsEnv;
}

/** 运行时长（ICU 拼接，不拼本地化字符串）。 */
function uptimeText(ms: number): string {
  const parts = uptimeParts(ms);
  if (parts.days > 0)
    return t('diagnostics.env.uptime.days', { days: parts.days, hours: parts.hours });
  if (parts.hours > 0)
    return t('diagnostics.env.uptime.hours', { hours: parts.hours, minutes: parts.minutes });
  if (parts.minutes > 0) return t('diagnostics.env.uptime.minutes', { minutes: parts.minutes });
  return t('diagnostics.env.uptime.seconds', { seconds: parts.seconds });
}

/** 诊断已知动作（未知动作原样显示 id，便于发现契约漂移）。 */
const KNOWN_ACTIONS = new Set(['retry-probe', 'set-base-url', 'configure-credentials']);

function actionLabel(action: string): string {
  return KNOWN_ACTIONS.has(action) ? t(`diagnostics.actions.${action}`) : action;
}

/** 从浏览器环境读默认注入值。 */
function defaultEnv(): DiagnosticsEnv {
  if (typeof window === 'undefined') {
    return {
      userAgent: '',
      language: 'zh-CN',
      devicePixelRatio: 1,
      viewport: { width: 0, height: 0 },
    };
  }
  return {
    userAgent: window.navigator.userAgent,
    language: window.navigator.language,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

/** 诊断面板。 */
export function DiagnosticsPanel(props: DiagnosticsPanelProps) {
  const { port: injectedPort, open, defaultOpen, onOpenChange, env } = props;
  const port = useMemo(() => injectedPort ?? createDiagnosticsPort(), [injectedPort]);
  const { health, connectivity, events, error, loading, reload } = useDiagnostics({ port });
  const environment = env ?? defaultEnv();
  const snapshot = environmentSnapshot({ ...environment, health });

  /** 环境行的值（id → 展示值；运行时长走 ICU）。 */
  const envValue = (id: EnvironmentRowId): string => {
    const disconnected = t('diagnostics.env.disconnected');
    if (snapshot.daemon === null) return disconnected;
    switch (id) {
      case 'daemon-version':
        return `${snapshot.daemon.name} ${snapshot.daemon.version}`;
      case 'daemon-uptime':
        return uptimeText(snapshot.daemon.uptimeMs);
      case 'data-root':
        return snapshot.daemon.dataRoot;
      case 'workspace':
        return snapshot.daemon.workspaceDir;
      case 'renderer':
        return t(`diagnostics.env.renderer.${snapshot.renderer}`);
      case 'platform':
        return t(`diagnostics.env.platform.${snapshot.platform}`);
      case 'locale':
        return snapshot.locale;
      case 'viewport':
        return `${String(snapshot.viewport.width)}×${String(snapshot.viewport.height)}`;
      case 'dpr':
        return String(snapshot.dpr);
      default:
        return disconnected;
    }
  };

  const lines = logTail(events, events.length);

  return (
    <Drawer
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      title={t('diagnostics.title')}
      description={t('diagnostics.subtitle')}
      closeLabel={t('diagnostics.close')}
      rememberKey="dfg-drawer-diagnostics"
      width="lg"
    >
      <div data-df-panel="diagnostics" style={diagnosticsStyles.body}>
        {error !== null ? (
          <div
            style={diagnosticsStyles.errorBanner}
            role="alert"
            data-df-diagnostics-error="daemon"
          >
            <span style={diagnosticsStyles.errorHeader}>
              <AlertTriangleIcon size={14} />
              {t('diagnostics.error.title')}
            </span>
            <span style={diagnosticsStyles.errorDesc}>
              {t('diagnostics.error.desc')}（{error}）
            </span>
            <div style={diagnosticsStyles.actions}>
              <Button
                size="sm"
                onClick={reload}
                loading={loading}
                loadingLabel={t('diagnostics.loading')}
              >
                {t('diagnostics.error.retry')}
              </Button>
            </div>
          </div>
        ) : null}

        <section
          aria-label={t('diagnostics.section.environment')}
          style={diagnosticsStyles.section}
        >
          <span style={diagnosticsStyles.sectionTitle}>{t('diagnostics.section.environment')}</span>
          <ul style={diagnosticsStyles.rowList}>
            {ENVIRONMENT_ROW_IDS.map((id) => (
              <li key={id} style={diagnosticsStyles.row} data-df-env-row={id}>
                <span style={diagnosticsStyles.rowLabel}>{t(`diagnostics.env.${id}`)}</span>
                <span style={diagnosticsStyles.rowValue}>{envValue(id)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label={t('diagnostics.section.connectivity')}
          style={diagnosticsStyles.section}
        >
          <div style={diagnosticsStyles.sectionHeader}>
            <span style={diagnosticsStyles.sectionTitle}>
              {t('diagnostics.section.connectivity')}
            </span>
            <span style={diagnosticsStyles.spacer} />
            {loading ? (
              <span style={diagnosticsStyles.muted} role="status">
                {t('diagnostics.connectivity.checking')}
              </span>
            ) : null}
            <Button
              size="sm"
              onClick={reload}
              disabled={loading}
              aria-label={t('diagnostics.connectivity.retryAll')}
            >
              {t('diagnostics.connectivity.retryAll')}
            </Button>
          </div>
          {connectivity === null ? (
            <span style={diagnosticsStyles.muted}>{t('diagnostics.env.disconnected')}</span>
          ) : (
            <ul style={diagnosticsStyles.rowList}>
              {connectivity.items.map((item) => (
                <li
                  key={item.id}
                  style={diagnosticsStyles.item}
                  data-df-connectivity-item={item.id}
                  data-df-connectivity-status={item.status}
                >
                  <span style={diagnosticsStyles.itemHeader}>
                    <span style={diagnosticsStyles.itemLabel}>{item.label}</span>
                    <span style={diagnosticsStyles.statusChip}>
                      {t(`diagnostics.status.${item.status}`)}
                    </span>
                    <span style={diagnosticsStyles.spacer} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={reload}
                      disabled={loading}
                      aria-label={t('diagnostics.connectivity.retryItem', { label: item.label })}
                    >
                      {t('diagnostics.error.retry')}
                    </Button>
                  </span>
                  {item.detail === null ? null : (
                    <span style={diagnosticsStyles.itemDetail}>{item.detail}</span>
                  )}
                  {item.actions.length > 0 ? (
                    <span style={diagnosticsStyles.chipRow}>
                      {item.actions.map((action) => (
                        <span key={action} style={diagnosticsStyles.chip}>
                          {actionLabel(action)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {connectivity !== null ? (
            <span style={diagnosticsStyles.muted}>
              {t('diagnostics.connectivity.checkedAt', {
                at: connectivity.checkedAt.slice(0, 19).replace('T', ' '),
              })}
            </span>
          ) : null}
        </section>

        <section aria-label={t('diagnostics.section.logs')} style={diagnosticsStyles.section}>
          <div style={diagnosticsStyles.sectionHeader}>
            <span style={diagnosticsStyles.sectionTitle}>{t('diagnostics.section.logs')}</span>
            <span style={diagnosticsStyles.spacer} />
            <Button size="sm" onClick={reload} disabled={loading}>
              {t('diagnostics.logs.refresh')}
            </Button>
          </div>
          {lines.length === 0 ? (
            <span style={diagnosticsStyles.muted}>{t('diagnostics.logs.empty')}</span>
          ) : (
            <ul style={diagnosticsStyles.logList}>
              {lines.map((line) => (
                <li key={line} style={diagnosticsStyles.logLine}>
                  {line}
                </li>
              ))}
            </ul>
          )}
          <span style={diagnosticsStyles.muted}>{t('diagnostics.logs.source')}</span>
        </section>
      </div>
    </Drawer>
  );
}
