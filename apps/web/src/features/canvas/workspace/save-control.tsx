'use client';

/**
 * 顶栏「保存」动作与保存态（D-2 / UX-03）。
 *
 * 内容（挂在壳层的 `topbar-center` 槽里，紧邻文件名）：
 * - **显式保存动作**：按钮走命令 `file.save`（同 ⌘S）——入口与快捷键同一条命令，不会两套实现；
 * - **保存态**：未保存 / 保存中… / 已保存 / 失败（失败带原因与来源：载入失败 ≠ 保存失败），
 *   统一落在 `[data-df-save-state]` 上（e2e/门禁的确定性读点）。
 *
 * 为什么状态文案走 i18n 组合而不是在桥里拼中文：桥只给「原文原因」（daemon 的 message），
 * 人话由界面层经 zh-CN 目录包一层（ADR-0003）。
 */
import { Button } from '@dforge/ui';
import { useStore } from 'zustand';

import { executeCommand, useCommand } from '@/features/editor-shell';
import { t } from '@/i18n';

import { SAVE_DOCUMENT_COMMAND_ID } from './document-bridge';
import { getWorkspace } from './workspace-session';

/** 保存按钮与保存态。 */
export function DocumentSaveControl() {
  const workspace = getWorkspace();
  const status = useStore(workspace.documents.store, (state) => state.status);
  const error = useStore(workspace.documents.store, (state) => state.error);
  const errorKind = useStore(workspace.documents.store, (state) => state.errorKind);
  const command = useCommand(SAVE_DOCUMENT_COMMAND_ID);
  const available = command !== undefined && command.enabled?.() !== false;

  return (
    <span className="dfc-ws-save" data-df-save-control="">
      <Button
        size="sm"
        variant="secondary"
        loading={status === 'saving'}
        loadingLabel={t('editor.save.saving')}
        disabled={!available}
        data-df-save-action="save"
        onClick={() => {
          void executeCommand(SAVE_DOCUMENT_COMMAND_ID);
        }}
      >
        {t('editor.action.save')}
      </Button>
      <span className="dfc-ws-save__state" role="status" data-df-save-state={status}>
        {saveStateLabel(status, errorKind, error)}
      </span>
    </span>
  );
}

/** 保存态文案（失败按来源给「载入失败 / 保存失败」两种人话）。 */
function saveStateLabel(
  status: 'dirty' | 'saving' | 'saved' | 'error',
  errorKind: 'load' | 'save' | null,
  error: string | null,
): string {
  switch (status) {
    case 'dirty':
      return t('editor.save.dirty');
    case 'saving':
      return t('editor.save.saving');
    case 'saved':
      return t('editor.save.saved');
    case 'error':
      return errorKind === 'load'
        ? t('editor.load.failed', { message: error ?? '' })
        : t('editor.save.failed', { message: error ?? '' });
  }
}
