'use client';

/**
 * 工具栏（C2 清单）：**16 线性图标**（`--dfg-icon-size-md`）、active 底**蓝块**、分组分隔线、禁用态 tooltip。
 *
 * - 工具按钮直接复用 `@dforge/ui` 的 `IconButton`（`aria-pressed` 态在深色基准下即
 *   `--dfg-color-selection` 圆角块，与 C2 的 active 口径同一处定义）；
 * - 点击走命令（`tool.<id>`）——同一动作在命令面板/快捷键里也能触发，三处不会各写一份；
 * - 分隔线只在**后续票的追加段非空时**渲染（空分隔线看着像 bug）；
 * - 右侧：缩放菜单（C16）+ 「?」快捷键说明入口。
 */
import { Tooltip } from '@dforge/ui';

import { t } from '@/i18n';

import { executeCommand } from '../commands/execute';
import { useEditorSlotItems } from '../slots/host';
import { useEditorView } from '../state/view';
import { EDITOR_TOOLS, toolCommandId } from '../tools';
import { cx } from '../utils/cx';
import { CommandIconButton } from './command-entry';
import { ZoomMenu } from './zoom-menu';

/** 单个工具按钮。 */
function ToolButton({ id }: { id: (typeof EDITOR_TOOLS)[number]['id'] }) {
  const spec = EDITOR_TOOLS.find((tool) => tool.id === id);
  const activeTool = useEditorView((state) => state.activeTool);
  if (spec === undefined) return null;
  const Icon = spec.icon;
  const label = t(spec.labelKey);
  const active = activeTool === spec.id;
  return (
    <Tooltip content={`${label}（${spec.shortcut}）`} placement="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-df-tool={spec.id}
        className={cx('dfg-editor-tool', active && 'dfg-editor-tool--active')}
        onClick={() => {
          void executeCommand(toolCommandId(spec.id));
        }}
      >
        <Icon />
      </button>
    </Tooltip>
  );
}

/** 工具栏。 */
export function EditorToolbar() {
  const extraItems = useEditorSlotItems('toolbar');

  return (
    <div
      className="dfg-editor-toolbar"
      role="toolbar"
      aria-label={t('editor.group.tools')}
      data-df-preview="editor/toolbar"
    >
      <div className="dfg-editor-toolbar__group">
        {EDITOR_TOOLS.map((tool) => (
          <ToolButton key={tool.id} id={tool.id} />
        ))}
      </div>
      {extraItems.length === 0 ? null : (
        <>
          <span className="dfg-editor-toolbar__divider" aria-hidden="true" />
          <div className="dfg-editor-toolbar__group" data-df-slot="toolbar">
            {extraItems.map((item) => (
              <span key={item.id} className="dfg-editor-toolbar__slot">
                {item.render()}
              </span>
            ))}
          </div>
        </>
      )}
      <span className="dfg-editor-toolbar__spacer" />
      <ZoomMenu />
      <CommandIconButton
        id="help.shortcuts"
        label={t('editor.action.shortcuts')}
        icon={<span className="dfg-editor-help-mark">?</span>}
      />
    </div>
  );
}
