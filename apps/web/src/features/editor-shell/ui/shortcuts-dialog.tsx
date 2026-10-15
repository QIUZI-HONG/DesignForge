'use client';

/**
 * 快捷键说明（E8 清单）：两栏对照表（命令 | 快捷键），模态呈现。
 *
 * 数据 **100% 来自命令注册表**（`ui/shortcuts-model`）——后续票注册命令时给 `shortcut`，
 * 说明表自动收录，不需要改本文件；这与命令面板是同一真源（briefs/fe-03.md §3）。
 * 打开入口：⌘/（`help.shortcuts` 命令）、顶栏主菜单「帮助」、工具条右侧「?」。
 */
import { Modal } from '@dforge/ui';

import { t } from '@/i18n';

import { useCommandList } from '../commands/use-commands';
import { useEditorUi } from '../state/ui';
import { buildShortcutGroups, countShortcutRows } from './shortcuts-model';

/** 快捷键说明模态。 */
export function ShortcutsDialog() {
  const open = useEditorUi((state) => state.shortcutsOpen);
  const setOpen = useEditorUi((state) => state.setShortcutsOpen);
  const groups = buildShortcutGroups(useCommandList());
  const rowCount = countShortcutRows(groups);

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('editor.shortcuts.title')}
      size="md"
      closeLabel={t('editor.shortcuts.close')}
    >
      <div className="dfg-editor-shortcuts" data-df-preview="editor/shortcuts">
        {rowCount === 0 ? (
          <p className="dfg-editor-shortcuts__empty" data-df-state="empty">
            {t('editor.shortcuts.empty')}
          </p>
        ) : (
          <table className="dfg-editor-shortcuts__table">
            <thead>
              <tr>
                <th scope="col">{t('editor.shortcuts.command')}</th>
                <th scope="col" className="dfg-editor-shortcuts__keys-col">
                  {t('editor.shortcuts.keys')}
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.id} data-df-shortcut-group={group.id}>
                <tr className="dfg-editor-shortcuts__section">
                  <th scope="colgroup" colSpan={2}>
                    {group.label}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.command.id} data-df-command={row.command.id}>
                    <td>{row.command.title}</td>
                    <td className="dfg-editor-shortcuts__keys-col">
                      <kbd className="dfg-editor-shortcuts__keys">{row.shortcut}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </Modal>
  );
}
