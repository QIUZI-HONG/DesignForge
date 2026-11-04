'use client';

import { useEffect } from 'react';
/**
 * 命令面板域的**路由侧接线模块**（工单 08 建域；票 04 · spec P0-4 起为全局入口）。
 *
 * 挂载与注册（两处，都是路由层/布局层的声明式接线）：
 * 1. `GlobalCommandPalette`：**全局宿主**（根布局 `app/layout.tsx` 渲染一次）——
 *    - 注册 `view.commandPalette`（⌘K 主键位；⌘/ 为**编辑器别名**，经 `shortcutAliases`
 *      声明，由编辑器壳的派发器消费——别名不外溢到首页/设置）；
 *    - 派发主键位：壳层派发器（`useGlobalShortcuts`）只随编辑器壳挂载，首页/设置没有
 *      派发器，宿主自带一个**只认主键位**的窗口监听补齐「任意页 ⌘K」；同一命令两条
 *      派发链靠「命中即 preventDefault」的去重约定（编辑器内先到先得，单次执行）；
 *    - 渲染 `<CommandPalette />`（Overlay 关着时不产生可见 DOM，SSR 首帧同形）。
 * 2. `CommandPaletteSlot` / `ShortcutCheatSheetSlot`：`overlays` 插槽声明引用
 *    （编辑器引导件挂载；速查卡仍是编辑器域专属——面板已全局化，不再经插槽挂）。
 *
 * 命令源唯一：面板/速查卡自身不持清单，全部条目读命令注册表（`useCommandList`）；
 * 「面板自己怎么开」也是一条注册表命令——三处入口（全局键 / 主菜单视图组 / 面板内
 * 自检条目）同一实现。
 *
 * 为什么登记必须带 `typeof window` 守卫：本模块会被 SSR 求值（客户端组件也会），而
 * 注册表是模块单例——服务端注册会跨请求共享。注册只发生在挂载后的 effect（浏览器侧），
 * 服务端与客户端首帧一致。
 */
import { t } from '@/i18n';
import {
  executeCommand,
  getCommand,
  isEditorOverlayOpen,
  matchesShortcut,
  parseShortcut,
  registerCommand,
  useEditorUi,
} from '../editor-shell';
import { CommandPalette } from './command-palette';
import { ShortcutCheatSheet } from './shortcut-cheatsheet';

/**
 * 登记命令面板域命令（浏览器侧；幂等——同 id 覆盖）。
 *
 * 键位（票 04 · spec P0-4）：主键位 **⌘K**（全局，首页/设置/编辑器均可呼出），
 * `shortcutAliases: ['⌘/']` 为**编辑器别名**（工单 08 的原键位，随壳层派发器生效）。
 * `view.commandPalette` 是开关语义：面板开着时执行 = 关闭（入口三处的行为一致）；
 * 全局派发在面板开着时整体让路（`isEditorOverlayOpen`），键盘上 Esc 负责关闭。
 */
export function registerCommandPalette(): void {
  if (typeof window === 'undefined') return;
  registerCommand({
    id: 'view.commandPalette',
    title: t('editor.command.palette'),
    group: t('editor.group.view'),
    // ⌘ 是主修饰键：mac 认 Meta，Windows/Linux 认 Ctrl（见 matching.ts）
    shortcut: '⌘K',
    shortcutAliases: ['⌘/'],
    run: () => {
      const ui = useEditorUi.getState();
      ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
    },
  });
}

/**
 * 命令面板全局宿主（根布局渲染一次；「任意页 ⌘K」的接线点）。
 *
 * 派发口径与壳层派发器一致（`../editor-shell/shortcuts` 惯例：快捷键表即派发表），
 * 差别只有两条——只认**主键位**（别名 ⌘/ 归编辑器壳），且浮层占键盘时让路
 * （与 `useGlobalShortcuts` 同一条 `isEditorOverlayOpen` 规则）。
 * 事件先到先得：编辑器内壳层派发器命中即 `preventDefault`，本监听按
 * `defaultPrevented` 让位，同一按键不会双派发。
 */
export function GlobalCommandPalette() {
  useEffect(() => {
    registerCommandPalette();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (isEditorOverlayOpen()) return;
      const command = getCommand('view.commandPalette');
      if (command === undefined || command.shortcut === undefined) return;
      if (command.enabled?.() === false) return;
      const parsed = parseShortcut(command.shortcut);
      if (parsed === null || !matchesShortcut(event, parsed)) return;
      event.preventDefault();
      void executeCommand(command.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // 面板随宿主全路由可用：关着时 Overlay 不渲染（SSR 首帧 = 关着形态，无 hydration 差异）
  return <CommandPalette />;
}

/** 命令面板（`overlays` 槽声明引用；面板全局化后仅测试与旧接线消费）。 */
export function CommandPaletteSlot() {
  return <CommandPalette />;
}

/** 快捷键速查浮层（`overlays` 槽声明引用）。 */
export function ShortcutCheatSheetSlot() {
  return <ShortcutCheatSheet />;
}
