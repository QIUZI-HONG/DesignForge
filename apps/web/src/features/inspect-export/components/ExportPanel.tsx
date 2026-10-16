'use client';

/**
 * ExportPanel —— 导出三档（PNG / SVG / PDF）与失败/重试（C15 导出、F6 面板的导出段）。
 *
 * 口径：
 * - 三档**各自独立**的进度与失败态（一档失败不影响另一档已完成的结果）；
 * - 失败态给「错误码 + 文案」，并提供重试（重试 = 用同一请求再发一次，不复制面板状态）；
 * - daemon 未启动（`daemon_offline`）单独给「本地服务未启动」文案，不与渲染失败混为一谈；
 * - 产物只回报元数据（文件名 / 字节数 / sha256 前缀）——证据 JSON 引用同一组字段。
 */

import type { ExportFormat } from '@dforge/contracts';
import { AlertCircleIcon, Button, DownloadIcon } from '@dforge/ui';
import { useState } from 'react';

import { t } from '@/i18n';

import type { ExportClient } from '../model/export-client';
import { createExportClient } from '../model/export-client';

/** 三档（顺序 = 呈现顺序）。 */
const FORMATS: readonly ExportFormat[] = ['png', 'svg', 'pdf'];

/**
 * 失败态的行动建议（G4 / UX-17）：为什么之外必须给下一步。
 * 分派只认错误码：`doc_not_found` 是「文档还没保存到本地」（编辑器里未保存的文档
 * 没有可导出的 `.dfg`），`daemon_offline` 是「服务没起来」；其余给通用重试指引。
 */
function failureHint(code: string): string {
  if (code === 'doc_not_found') return t('editor.export.hint.docNotFound');
  if (code === 'daemon_offline') return t('editor.export.hint.daemonOffline');
  return t('editor.export.hint.retry');
}

/** 单档状态。 */
interface FormatState {
  status: 'idle' | 'running' | 'error' | 'done';
  code?: string;
  message?: string;
  fileName?: string;
  length?: number;
}

/** 导出面板 props。 */
export interface ExportPanelProps {
  documentId: string;
  pageId: string;
  /** 导出客户端（宿主注入；缺省按契约缺省基址新建——门禁/测试一律注入）。 */
  client?: ExportClient;
}

/** 导出面板。 */
export function ExportPanel({ documentId, pageId, client }: ExportPanelProps) {
  const [states, setStates] = useState<Record<ExportFormat, FormatState>>({
    png: { status: 'idle' },
    svg: { status: 'idle' },
    pdf: { status: 'idle' },
  });

  const patch = (format: ExportFormat, next: FormatState): void => {
    setStates((current) => ({ ...current, [format]: next }));
  };

  const run = async (format: ExportFormat, activeClient: ExportClient): Promise<void> => {
    patch(format, { status: 'running' });
    const outcome = await activeClient.exportDocument({ documentId, pageId, format });
    if (outcome.ok) {
      patch(format, {
        status: 'done',
        fileName: outcome.artifact.fileName,
        length: outcome.artifact.length,
      });
      return;
    }
    patch(format, { status: 'error', code: outcome.code, message: outcome.message });
  };

  const activeClient = client ?? createExportClient();

  return (
    <section
      className="dfx-export"
      data-df-inspect="export-panel"
      aria-label={t('editor.export.panel.title')}
    >
      <h3 className="dfx-section-title">{t('editor.export.panel.title')}</h3>
      <fieldset className="dfx-export__buttons" aria-label={t('editor.export.panel.format')}>
        {FORMATS.map((format) => {
          const state = states[format];
          const label = format.toUpperCase();
          const running = state.status === 'running';
          return (
            <div className="dfx-export__slot" key={format}>
              <Button
                size="sm"
                variant="secondary"
                icon={<DownloadIcon />}
                loading={running}
                loadingLabel={t('editor.export.state.running', { format: label })}
                disabled={running}
                data-df-inspect={`export-${format}`}
                onClick={() => void run(format, activeClient)}
              >
                {t('editor.export.action.start', { format: label })}
              </Button>

              {state.status === 'running' ? (
                <p
                  className="dfx-export__meta"
                  role="status"
                  data-df-inspect={`export-${format}-running`}
                >
                  {t('editor.export.state.running', { format: label })}
                </p>
              ) : null}

              {state.status === 'done' ? (
                <p
                  className="dfx-export__meta dfx-export__meta--done"
                  data-df-inspect={`export-${format}-done`}
                >
                  {t('editor.export.state.done', {
                    fileName: state.fileName ?? '',
                    length: state.length ?? 0,
                  })}
                </p>
              ) : null}

              {state.status === 'error' ? (
                <div
                  className="dfx-export__error"
                  role="alert"
                  data-df-inspect={`export-${format}-error`}
                >
                  <AlertCircleIcon />
                  <div className="dfx-export__error-body">
                    <p className="dfx-export__error-line">
                      {state.code === 'daemon_offline'
                        ? t('editor.export.daemonOffline')
                        : t('editor.export.state.error', { message: state.message ?? '' })}
                    </p>
                    {/* 行动建议（G4）：为什么 + 下一步，紧跟在失败原因之后 */}
                    <p className="dfx-export__error-hint" data-df-inspect={`export-${format}-hint`}>
                      {failureHint(state.code ?? 'unknown')}
                    </p>
                    <p className="dfx-export__error-code">
                      {t('editor.export.state.errorCode', { code: state.code ?? 'unknown' })}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void run(format, activeClient)}>
                    {t('editor.export.action.retry')}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
    </section>
  );
}
