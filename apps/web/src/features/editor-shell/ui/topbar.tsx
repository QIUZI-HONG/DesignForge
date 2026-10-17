'use client';

/**
 * 编辑器顶栏（C1 清单 · 三区，高 `--dfg-size-topbar`）。
 *
 * - **左工具区**：主菜单（文件/视图/帮助）+ 撤销/重做 + `topbar-left` 插槽；
 * - **中文件名 + 版本入口**：文件名（`h1`）+ 版本历史入口（`review.versions.open`，归 FE-07）
 *   + `topbar-center` 插槽（画布工作区在此挂「保存」动作与保存态，D-2）；
 * - **右分享 + Present**：`topbar-right` 插槽（FE-07 的评论/Present 入口也在此挂）+ 评论 +
 *   演示 + 分享。
 *
 * 「入口先于实现」：分享/演示/评论/版本的实现分属 FE-07 等票，本票只渲染入口，
 * 入口的可用性跟着**命令表**走（未注册 = 禁用 + 原因提示，注册后自动可点）。
 *
 * 文件名：`useEditorView.documentName` 为真源——未载入/未落盘（null）时显示
 * 「未命名设计文件」占位（这是**新文件**的合法态），载入或保存后显示真实文档名（D-2/UX-03）。
 */
import { t } from '@/i18n';

import { CommentIcon, HistoryIcon, PresentIcon } from '../icons';
import { EditorSlotHost } from '../slots/host';
import { useEditorView } from '../state/view';
import { RESERVED_COMMAND_IDS } from '../tools';
import { AppMenu, HistoryEntries } from './app-menu';
import { CommandButton, CommandIconButton } from './command-entry';

/** 顶栏。 */
export function EditorTopbar() {
  const documentName = useEditorView((state) => state.documentName);
  return (
    <header className="dfg-editor-topbar" data-df-preview="editor/topbar">
      <div className="dfg-editor-topbar__zone dfg-editor-topbar__zone--left">
        <AppMenu />
        <HistoryEntries />
        <EditorSlotHost slot="topbar-left" />
      </div>

      <div className="dfg-editor-topbar__zone dfg-editor-topbar__zone--center">
        <h1
          className="dfg-editor-topbar__title"
          data-df-document-name={documentName ?? ''}
          data-df-document-loaded={documentName === null ? 'false' : 'true'}
        >
          {documentName ?? t('editor.topbar.untitled')}
        </h1>
        <EditorSlotHost slot="topbar-center" />
        <CommandIconButton
          id={RESERVED_COMMAND_IDS.versions}
          label={t('editor.action.versions')}
          icon={<HistoryIcon />}
        />
      </div>

      <div className="dfg-editor-topbar__zone dfg-editor-topbar__zone--right">
        <EditorSlotHost slot="topbar-right" />
        <CommandIconButton
          id={RESERVED_COMMAND_IDS.commentToggle}
          label={t('editor.action.comment')}
          icon={<CommentIcon />}
        />
        <CommandIconButton
          id={RESERVED_COMMAND_IDS.present}
          label={t('editor.action.present')}
          icon={<PresentIcon />}
        />
        <CommandButton
          id={RESERVED_COMMAND_IDS.share}
          label={t('editor.action.share')}
          variant="primary"
        />
      </div>
    </header>
  );
}
