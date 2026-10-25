'use client';

/**
 * 快捷键速查浮层（工单 08 · 规格故事 15：长按修饰键，不用背键位）。
 *
 * 交互口径（对标 Figma 的按住 ⌘ 预览键位）：
 * - **长按** `Cmd/Ctrl`（≥ `SHORTCUT_HOLD_REVEAL_MS`）才显示——快速组合键（⌘Z/⌘S/⌘/）
 *   不闪卡：按住期间先击了别的键即取消挂起；
 * - **松开即消失**（修饰键全部松开或窗口失焦）；
 * - 卡上键位随上下文（`./cheat-model`：画布/文本编辑/面板），数据 100% 来自命令注册表
 *   ——与命令面板、快捷键说明同一真源；
 * - **与面板互不抢焦点**（验收 b）：浮层无焦点语义——无任何控件、不调 focus()、
 *   `pointer-events: none`（样式层），按住期间照常击键（全局派发不受影响，按住 ⌘
 *   看着卡按下一条快捷键正是预期用法）；
 * - 刻意**不走** `@dforge/ui` 的 Overlay：浮层栈的「焦点入层/滚动锁/Esc」都是模态语义，
 *   对一张按住才出现的瞬态卡是反向需求（会抢走画布/输入区焦点）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { t } from '@/i18n';

import { useCommandList, useEditorUi } from '../editor-shell';
import { buildCheatGroups, resolveCheatContext, type CheatContext } from './cheat-model';

/** 长按判定阈值（ms；guard:tokens 口径：时长一律毫秒）。 */
export const SHORTCUT_HOLD_REVEAL_MS = 400;

/** 面板上下文的固定键位卡（面板导航键不是命令注册表条目，模型不产文案）。 */
function paletteRows(): { label: string; rows: Array<{ label: string; shortcut: string }> } {
  return {
    label: t('editor.cheat.context.palette'),
    rows: [
      { label: t('editor.cheat.palette.select'), shortcut: '↑↓' },
      { label: t('editor.cheat.palette.run'), shortcut: '↵' },
      { label: t('editor.cheat.palette.close'), shortcut: 'Esc' },
    ],
  };
}

/** 快捷键速查浮层（挂 `overlays` 插槽；自身无开合态，显隐全由按住/松开驱动）。 */
export function ShortcutCheatSheet() {
  const commands = useCommandList();
  const paletteOpen = useEditorUi((state) => state.commandPaletteOpen);
  const shortcutsOpen = useEditorUi((state) => state.shortcutsOpen);

  const [visible, setVisible] = useState(false);
  /** 上下文可能随按键/焦点变化（按住期间继续击键）：以计数强制重算渲染。 */
  const [contextTick, setContextTick] = useState(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cancelPending = (): void => {
      if (pendingRef.current === null) return;
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    };
    const hideNow = (): void => {
      cancelPending();
      setVisible(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Meta' || event.key === 'Control') {
        if (event.repeat) return; // 按住的长重复事件不重置计时
        if (visible) {
          // 已显示（如先 ⌘ 后 Ctrl 也按住）：不重挂计时，只重算上下文
          setContextTick((tick) => tick + 1);
          return;
        }
        if (pendingRef.current !== null) return; // 已在计时
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null;
          setVisible(true);
        }, SHORTCUT_HOLD_REVEAL_MS);
        return;
      }
      if (visible) {
        // 已显示：保持（按住 ⌘ 看着卡继续击键），上下文重算
        setContextTick((tick) => tick + 1);
        return;
      }
      // 未显示：组合键（修饰键后跟击键）→ 取消挂起，不闪卡
      cancelPending();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      // 修饰键全部松开才算松开（⌘⇧ 这类组合松开其中一个仍算按住）
      if (!event.metaKey && !event.ctrlKey) hideNow();
    };
    const onBlur = (): void => hideNow();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelPending();
    };
  }, [visible]);

  if (!visible || typeof document === 'undefined') return null;

  const context: CheatContext = resolveCheatContext({
    paletteOpen,
    shortcutsOpen,
    activeElement: document.activeElement,
  });
  const groups = buildCheatGroups({ commands, context, paletteGroup: paletteRows() });

  return createPortal(
    <div
      className="dfg-cmdk-cheat"
      role="dialog"
      aria-modal="false"
      aria-label={t('editor.cheat.title')}
      data-df-context={context}
      data-df-tick={contextTick}
    >
      <p className="dfg-cmdk-cheat__context">{t(`editor.cheat.context.${context}`)}</p>
      {groups.map((group) => (
        <div key={group.id} className="dfg-cmdk-cheat__group" data-df-cheat-group={group.id}>
          <p className="dfg-cmdk-cheat__group-label">{group.label}</p>
          <ul className="dfg-cmdk-cheat__rows">
            {group.rows.map((row) => (
              <li key={`${row.label} ${row.shortcut}`} className="dfg-cmdk-cheat__row">
                <span className="dfg-cmdk-cheat__row-label">{row.label}</span>
                <kbd className="dfg-cmdk-cheat__keys">{row.shortcut}</kbd>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** 插槽渲染件（声明表引用）。 */
export function ShortcutCheatSheetSlot() {
  return <ShortcutCheatSheet />;
}
