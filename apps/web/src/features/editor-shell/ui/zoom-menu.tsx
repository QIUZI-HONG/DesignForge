'use client';

import { ZOOM_LEVELS } from '@dforge/engine';
/**
 * 缩放菜单（C16 清单）：**百分比列表 + 适应 / 100%**。
 *
 * - 百分比档位取自 `@dforge/engine` 的 `ZOOM_LEVELS`（引擎注释即标明这是 C16 的档位表），
 *   当前档位带对勾；选择即改缩放（并在 HUD 闪一次新百分比）；
 * - 「缩放至适合」需要画布尺寸与内容包围盒 → **由 FE-06 注册 `view.zoomFit` 命令**，
 *   本菜单只渲染入口：未注册则禁用 + 原因提示，注册后自动可点（标签也取自命令表，同一真源）；
 * - 「缩放至 100%」用 `view.zoom100`（本票默认实现，FE-06 可同 id 接管）。
 */
import { CheckIcon, ChevronDownIcon, DropdownMenu, type MenuSectionSpec } from '@dforge/ui';

import { t } from '@/i18n';
import { executeCommand } from '../commands/execute';
import { useCommandList } from '../commands/use-commands';
import { canvasHud } from '../hud/controller';
import { toZoomPercent, useEditorView } from '../state/view';
import { RESERVED_COMMAND_IDS } from '../tools';
import { cx } from '../utils/cx';

/** 缩放变化时的 HUD 提示时长（一次性动作 → 自动淡出）。 */
const ZOOM_HUD_MS = 1200;

/** 缩放菜单（工具条右侧）。 */
export function ZoomMenu() {
  const zoom = useEditorView((state) => state.zoom);
  const setZoom = useEditorView((state) => state.setZoom);
  const commands = useCommandList();

  const zoomFit = commands.find((command) => command.id === RESERVED_COMMAND_IDS.zoomFit);
  const zoom100 = commands.find((command) => command.id === 'view.zoom100');

  const levels = ZOOM_LEVELS.map((level) => ({
    id: `zoom:${String(level)}`,
    label: `${String(toZoomPercent(level))}%`,
    // 当前档位带对勾（保持可点：再选一次是 no-op，与 Figma 一致——不用禁用灰盖住「我就是当前档」）
    icon: level === zoom ? <CheckIcon /> : undefined,
    onSelect: () => {
      if (level === zoom) return;
      setZoom(level);
      canvasHud.show(`${String(toZoomPercent(level))}%`, { autoHideMs: ZOOM_HUD_MS });
    },
  }));

  // 动作区在前、百分比档位在后（与 Figma 本体一致：适应/100% 不该被 17 个档位挤到滚动区）
  const sections: MenuSectionSpec[] = [
    {
      id: 'actions',
      items: [
        {
          id: RESERVED_COMMAND_IDS.zoomFit,
          label: zoomFit?.title ?? t('editor.command.zoomFit'),
          // exactOptionalPropertyTypes：未注册时不给 shortcut 字段
          ...(zoomFit?.shortcut === undefined ? {} : { shortcut: zoomFit.shortcut }),
          disabled: zoomFit === undefined,
          disabledReason: t('editor.action.pending'),
          onSelect: () => {
            void executeCommand(RESERVED_COMMAND_IDS.zoomFit);
          },
        },
        {
          id: 'view.zoom100',
          label: zoom100?.title ?? t('editor.command.zoom100'),
          ...(zoom100?.shortcut === undefined ? {} : { shortcut: zoom100.shortcut }),
          disabled: zoom100 === undefined,
          disabledReason: t('editor.action.pending'),
          onSelect: () => {
            void executeCommand('view.zoom100');
          },
        },
      ],
    },
    { id: 'levels', label: t('editor.zoom.sectionLevels'), items: levels },
  ];

  return (
    <div className="dfg-editor-zoom" data-df-preview="editor/zoom-menu">
      <DropdownMenu
        label={t('editor.zoom.label')}
        align="end"
        sections={sections}
        trigger={(state) => (
          <button
            type="button"
            className={cx('dfg-editor-zoom__trigger')}
            aria-label={t('editor.zoom.label')}
            data-df-zoom={toZoomPercent(zoom)}
            {...state.triggerProps}
          >
            {/* 单表达式成单一文本节点：{值}% 两段相邻文本在 SSR 静态标记里被合并，
                水合按节点比对必然错位（Server "100%" vs Client "100"） */}
            <span className="dfg-editor-zoom__value">{`${String(toZoomPercent(zoom))}%`}</span>
            <ChevronDownIcon size={12} />
          </button>
        )}
      />
    </div>
  );
}
