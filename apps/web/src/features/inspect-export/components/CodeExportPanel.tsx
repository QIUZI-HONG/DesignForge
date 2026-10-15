'use client';

/**
 * CodeExportPanel —— F6 代码导出面板（与 C15 检查态**同源**）。
 *
 * 同源的含义：代码由 `model/codegen` 从**同一份文档真值**生成——检查态看到的属性、
 * 复制出去的代码、令牌说明区列出的绑定，三者不可能各自漂移。
 *
 * 组成：档位分段（CSS / React）→ 代码区 → 复制（F11 Toast 反馈）→ 令牌 → CSS 变量说明。
 */

import type { NodeId, ScenePage, TokenSet } from '@dforge/engine';
import { Button, CopyIcon, EmptyState, SegmentedControl, useToast } from '@dforge/ui';
import { useMemo, useState } from 'react';

import { t } from '@/i18n';

import { type CodeTier, generateCode } from '../model/codegen';

/** 代码区 props。 */
export interface CodeExportPanelProps {
  page: ScenePage;
  /** 目标节点（宿主选中态）；节点不存在时按空态渲染。 */
  nodeId: NodeId;
  tokens: TokenSet;
  /** 复制实现（测试/宿主注入；缺省用 navigator.clipboard）。 */
  copyText?: (text: string) => Promise<void>;
}

/** 缺省复制实现（不安全环境如非 HTTPS 且无 clipboard 时抛错，由面板转失败提示）。 */
async function defaultCopyText(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) throw new Error('当前环境不支持剪贴板');
  await clipboard.writeText(text);
}

/** 代码导出面板。 */
export function CodeExportPanel({ page, nodeId, tokens, copyText }: CodeExportPanelProps) {
  const [tier, setTier] = useState<CodeTier>('css');
  const toast = useToast();
  const generated = useMemo(
    () => generateCode(page, nodeId, tier, { tokens }),
    [page, nodeId, tier, tokens],
  );

  const copy = async (): Promise<void> => {
    try {
      await (copyText ?? defaultCopyText)(generated.code);
      toast.show({ tone: 'success', message: t('editor.export.code.copied') });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.show({ tone: 'error', message: t('editor.export.code.copyFailed', { reason }) });
    }
  };

  const boundNotes = generated.notes.filter((note) => note.binding.tokenPath !== null);
  const unboundNotes = generated.notes.filter((note) => note.binding.tokenPath === null);

  return (
    <section
      className="dfx-code"
      data-df-inspect="code-export"
      aria-label={t('editor.export.code.title')}
    >
      <header className="dfx-code__head">
        <h3 className="dfx-section-title">{t('editor.export.code.title')}</h3>
        <SegmentedControl
          label={t('editor.export.code.tier')}
          size="sm"
          value={tier}
          onChange={(value) => setTier(value === 'react' ? 'react' : 'css')}
          options={[
            { value: 'css', label: t('editor.export.code.css') },
            { value: 'react', label: t('editor.export.code.react') },
          ]}
        />
      </header>

      {generated.code === '' ? (
        <EmptyState title={t('editor.export.code.empty')} />
      ) : (
        <>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 代码区是可滚动区域（长代码溢出），需要键盘可达才能用方向键滚动；它不承担点击交互，故不给交互 role。 */}
          <pre className="dfx-code__block" data-df-inspect="code" tabIndex={0}>
            <code>{generated.code}</code>
          </pre>
          <div className="dfx-code__actions">
            <Button size="sm" variant="secondary" icon={<CopyIcon />} onClick={() => void copy()}>
              {t('editor.export.code.copy')}
            </Button>
          </div>
        </>
      )}

      <div className="dfx-token-note" data-df-inspect="token-notes">
        <h3 className="dfx-section-title">{t('editor.export.token.title')}</h3>
        {generated.notes.length === 0 ? (
          <p className="dfx-token-note__empty">{t('editor.export.token.empty')}</p>
        ) : (
          <ul className="dfx-token-note__list">
            {boundNotes.map((note) => (
              <li className="dfx-token-note__row" key={note.id} data-df-inspect="token-note">
                {t('editor.export.token.bound', {
                  token: note.binding.tokenPath ?? '',
                  cssVar: note.binding.cssVar ?? '',
                })}
              </li>
            ))}
            {unboundNotes.map((note) => (
              <li
                className="dfx-token-note__row dfx-token-note__row--unbound"
                key={note.id}
                data-df-inspect="token-note-unbound"
              >
                {t('editor.export.token.unbound', { value: note.binding.raw })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
