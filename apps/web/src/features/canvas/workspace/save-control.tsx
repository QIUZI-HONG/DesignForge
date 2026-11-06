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
import { Button, TechnicalDetails } from '@dforge/ui';
import { useStore } from 'zustand';

import { executeCommand, useCommand } from '@/features/editor-shell';
import { t } from '@/i18n';
import { classifyDaemonFailure } from '@/lib/daemon-failure';

import { SAVE_DOCUMENT_COMMAND_ID } from './document-bridge';
import { getWorkspace } from './workspace-session';

/** 保存按钮与保存态。 */
export function DocumentSaveControl() {
  const workspace = getWorkspace();
  const status = useStore(workspace.documents.store, (state) => state.status);
  const error = useStore(workspace.documents.store, (state) => state.error);
  const errorKind = useStore(workspace.documents.store, (state) => state.errorKind);
  const errorCode = useStore(workspace.documents.store, (state) => state.errorCode);
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
        <SaveStateContent
          status={status}
          errorKind={errorKind}
          error={error}
          errorCode={errorCode}
        />
      </span>
    </span>
  );
}

/**
 * 保存态内容（票 06 / spec P1-2）：失败态先经共享归类——网络层失败（fetch/TypeError 族）
 * 渲染中文人话（人话里带下一步：重新保存 / 重试），原始技术串与归一错误码沉进
 * **可折叠技术详情**（默认收起，报障可引用）；其余失败（daemon 明确拒绝等）维持
 * 既有「保存失败：{原因}」组合文案。dirty/saving/saved 三态不受影响。
 *
 * 保存冲突分支（audit-d06 · D-05 · Q2=A）：保存失败且错误码是 `doc_revision_conflict`
 * （条件保存基线过期——另一窗口已先保存）→ 独立冲突文案 + **手动刷新**入口
 * （重新载入 daemon 最新版本；不做自动合并）。判定走桥的结构化 `errorCode`，
 * 不做失败原文的特征串猜测——409 明确拒绝不落网络族（批4 回归钉语义）。
 */
function SaveStateContent({
  status,
  errorKind,
  error,
  errorCode,
}: {
  status: 'dirty' | 'saving' | 'saved' | 'error';
  errorKind: 'load' | 'save' | null;
  error: string | null;
  errorCode: string | null;
}) {
  if (status === 'error' && error !== null) {
    if (errorKind === 'save' && errorCode === 'doc_revision_conflict') {
      return <SaveConflictState raw={error} />;
    }
    const view = classifyDaemonFailure({ message: error });
    if (view.isNetwork) {
      return (
        <>
          {t(errorKind === 'load' ? 'editor.load.failed.network' : 'editor.save.failed.network')}
          <TechnicalDetails
            className="dfc-ws-save__tech"
            label={t('error.technicalDetails')}
            code={view.code}
            raw={view.raw}
          />
        </>
      );
    }
  }
  return saveStateLabel(status, errorKind, error);
}

/**
 * 保存冲突态（audit-d06 · D-05）：独立文案 + 刷新按钮。
 *
 * 刷新 = 重新 `load(documentId)`：载入 daemon 最新版本并采纳（会话未保存的修改被放弃——
 * 文案言明；Q2=A 不做自动合并）。刷新后基线更新，再保存即恢复（冲突后无脑重按保存
 * 只会再次 409——确定性拒绝，不会静默覆盖他人更新）。
 */
function SaveConflictState({ raw }: { raw: string }) {
  const workspace = getWorkspace();
  const refresh = (): void => {
    const documentId = workspace.documents.store.getState().documentId;
    if (documentId !== null) void workspace.documents.load(documentId);
  };
  return (
    <>
      {t('editor.save.conflict')}
      <Button size="sm" variant="secondary" data-df-save-conflict-refresh="" onClick={refresh}>
        {t('editor.save.conflict.refresh')}
      </Button>
      <TechnicalDetails
        className="dfc-ws-save__tech"
        label={t('error.technicalDetails')}
        code="doc_revision_conflict"
        raw={raw}
      />
    </>
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
