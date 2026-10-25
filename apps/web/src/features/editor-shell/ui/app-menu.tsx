'use client';

/**
 * 顶栏主菜单与历史入口（左上角「设界」菜单；F3 弹出菜单族）。
 *
 * 三个分区：
 * - **文件**：新建设计文件 / 导出…（命令 `file.new` / `file.export`，由首页族与导出票注册；
 *   未注册时条目**禁用并给出原因**）；
 * - **视图**：**从命令注册表动态派生**（放大/缩小/缩放至 100%…；FE-06 注册 `view.zoomFit`
 *   后自动出现「缩放至适合」）——菜单与命令面板同一真源；
 * - **帮助**：键盘快捷键（`help.shortcuts`，本票注册）。
 */
import { ChevronDownIcon, DropdownMenu, type MenuSectionSpec, UndoIcon } from '@dforge/ui';

import { t } from '@/i18n';

import { executeCommand } from '../commands/execute';
import { useCommandList } from '../commands/use-commands';
import { RedoIcon } from '../icons';
import { RESERVED_COMMAND_IDS } from '../tools';
import { CommandIconButton } from './command-entry';

/** 顶栏主菜单。 */
export function AppMenu() {
  const commands = useCommandList();
  const viewGroup = t('editor.group.view');
  const registered = new Set(commands.map((command) => command.id));
  const pending = t('editor.action.pending');

  const viewItems = commands
    .filter((command) => command.group === viewGroup)
    .map((command) => ({
      id: command.id,
      label: command.title,
      // exactOptionalPropertyTypes：无快捷键时不给该字段
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
      disabled: command.enabled?.() === false,
      onSelect: () => {
        void executeCommand(command.id);
      },
    }));

  const fileItems = [
    { id: RESERVED_COMMAND_IDS.newFile, label: t('editor.menu.newFile') },
    { id: RESERVED_COMMAND_IDS.exportFile, label: t('editor.menu.export') },
  ].map((item) => ({
    id: item.id,
    label: item.label,
    disabled: !registered.has(item.id),
    disabledReason: pending,
    onSelect: () => {
      void executeCommand(item.id);
    },
  }));

  const sections: MenuSectionSpec[] = [
    { id: 'file', label: t('editor.menu.file'), items: fileItems },
    { id: 'view', label: t('editor.menu.view'), items: viewItems },
    {
      id: 'help',
      label: t('editor.menu.help'),
      items: [
        {
          id: 'help.shortcuts',
          label: t('editor.action.shortcuts'),
          // 快捷键串由命令注册表给（工单 08 起说明表不再占 ⌘/——面板改版后 ⌘/ 归命令面板）
          disabled: !registered.has('help.shortcuts'),
          disabledReason: pending,
          onSelect: () => {
            void executeCommand('help.shortcuts');
          },
        },
      ],
    },
  ];

  return (
    <div className="dfg-editor-appmenu" data-df-preview="editor/app-menu">
      <DropdownMenu
        label={t('editor.topbar.menu')}
        sections={sections}
        trigger={(state) => (
          <button
            type="button"
            className="dfg-editor-appmenu__trigger"
            aria-label={t('editor.topbar.menu')}
            {...state.triggerProps}
          >
            <span className="dfg-editor-appmenu__mark" aria-hidden="true" />
            <span>{t('editor.topbar.brand')}</span>
            <ChevronDownIcon size={12} />
          </button>
        )}
      />
    </div>
  );
}

/** 顶栏左区的撤销/重做（入口先于实现：命令由 FE-06 注册）。 */
export function HistoryEntries() {
  return (
    <span className="dfg-editor-history">
      <CommandIconButton
        id={RESERVED_COMMAND_IDS.undo}
        label={t('editor.action.undo')}
        icon={<UndoIcon />}
      />
      <CommandIconButton
        id={RESERVED_COMMAND_IDS.redo}
        label={t('editor.action.redo')}
        icon={<RedoIcon />}
      />
    </span>
  );
}
