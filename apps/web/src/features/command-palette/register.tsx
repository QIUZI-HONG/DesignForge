'use client';

/**
 * 命令面板域的**路由侧接线模块**（工单 08；工单 02 引导收口后的形状）。
 *
 * 挂载时机统一收口到编辑器唯一客户端引导件（`app/editor/editor-bootstrap.tsx` 的
 * 声明式注册表）：本模块提供三样东西，由引导在挂载后执行/渲染——
 * 1. `registerCommandPalette()`：**命令登记**（浏览器侧；幂等——同 id 覆盖）。用同 id
 *    （`view.commandPalette`）接管壳层内置的默认实现：键位从 ⌘K 改为规格故事 14 的
 *    **`⌘/`**（快捷键串即全局派发串，经 `../editor-shell/shortcuts` 惯例注册）；
 * 2. `CommandPaletteSlot`：命令面板（`overlays` 插槽声明引用）；
 * 3. `ShortcutCheatSheetSlot`：长按修饰键的快捷键速查浮层（`overlays` 插槽声明引用）。
 *
 * 命令源唯一：面板/速查卡自身不持清单，全部条目读命令注册表（`useCommandList`）；
 * 「面板自己怎么开」也是一条注册表命令——三处入口（全局键 / 主菜单视图组 / 面板内
 * 自检条目）同一实现。
 *
 * 为什么登记必须带 `typeof window` 守卫：本模块会被 SSR 求值（客户端组件也会），而
 * 注册表是模块单例——服务端注册会跨请求共享。工单 02 起模块求值**不再注册**，唯一
 * 执行点是编辑器引导件挂载后的 effect（浏览器侧），首帧一致性由此保证。
 */
import { t } from '@/i18n';

import { registerCommand, useEditorUi } from '../editor-shell';
import { CommandPalette } from './command-palette';
import { ShortcutCheatSheet } from './shortcut-cheatsheet';

/**
 * 登记命令面板域命令（浏览器侧；幂等——同 id 覆盖）。
 *
 * 由编辑器引导注册表声明执行（`app/editor/editor-bootstrap.tsx`），测试里也可显式调用。
 * `view.commandPalette` 是开关语义：面板开着时执行 = 关闭（入口三处的行为一致）；
 * 全局派发在面板开着时整体让路（`isEditorOverlayOpen`），键盘上 Esc 负责关闭。
 */
export function registerCommandPalette(): void {
  if (typeof window === 'undefined') return;
  registerCommand({
    id: 'view.commandPalette',
    title: t('editor.command.palette'),
    group: t('editor.group.view'),
    // 规格故事 14：面板开关 = ⌘/（主修饰键 ⌘ 在 Windows/Linux 上认 Ctrl，见 matching.ts）
    shortcut: '⌘/',
    run: () => {
      const ui = useEditorUi.getState();
      ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
    },
  });
}

/** 命令面板（`overlays` 槽声明引用）。 */
export function CommandPaletteSlot() {
  return <CommandPalette />;
}

/** 快捷键速查浮层（`overlays` 槽声明引用）。 */
export function ShortcutCheatSheetSlot() {
  return <ShortcutCheatSheet />;
}
