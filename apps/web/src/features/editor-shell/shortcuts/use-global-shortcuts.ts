'use client';

/**
 * 全局快捷键派发（E8 的「键盘可达」半边；另一半是快捷键说明表本身）。
 *
 * 口径：
 * - **快捷键表即派发表**：遍历命令注册表，用 `Command.shortcut` 解析匹配——
 *   FE-06/07/08 注册命令时给的 `shortcut` 自动可键盘触发，不需要各处再挂 keydown；
 * - 浮层优先：命令面板/快捷键说明打开时全局派发**让路**（浮层自己收键盘，Esc 归它）；
 * - 输入区保护：**无修饰键**的快捷键（工具键 V/F/R/T/H）在输入框/文本域/可编辑区里不派发
 *   （在命令面板搜索框里打 'v' 只能是输入 'v'）；
 * - 置灰命令不吞键：`enabled()` 判否时继续找同快捷键的其它命令，都不命中才放行给浏览器。
 */
import { useEffect } from 'react';
import { executeCommand } from '../commands/execute';
import { useCommandList } from '../commands/use-commands';
import { isEditorOverlayOpen } from '../state/ui';
import { hasModifier, isEditableTarget, matchesShortcut, parseShortcut } from './matching';

/** 挂载全局快捷键派发（编辑器壳挂一次）。 */
export function useGlobalShortcuts(): void {
  const commands = useCommandList();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      // Esc 归浮层自己（关闭面板/对话框）；浮层开着时全局快捷键整体让路
      if (event.key === 'Escape') return;
      if (isEditorOverlayOpen()) return;

      const editable = isEditableTarget(event.target);
      for (const command of commands) {
        if (command.shortcut === undefined) continue;
        const parsed = parseShortcut(command.shortcut);
        if (parsed === null) continue;
        if (!matchesShortcut(event, parsed)) continue;
        if (!hasModifier(parsed) && editable) continue;
        if (command.enabled?.() === false) continue;

        event.preventDefault();
        void executeCommand(command.id);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [commands]);
}
