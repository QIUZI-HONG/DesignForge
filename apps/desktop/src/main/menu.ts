/**
 * 最小菜单 —— 只保留「可运维」的花名册：退出 / 编辑剪贴板 / 视图缩放与开发者工具。
 *
 * 为什么这么小：多标签工作台、标签组、最近关闭等 15 项体验项按《范围边界》A 区**整体缓归 P6**，
 * 最小壳不得顺手混入（本模块的测试会对着范围断言）。菜单项一律用标准 role，不写自造 label。
 */
import type { MenuItemConstructorOptions } from 'electron';

/** 生成最小菜单模板（标准 role 白名单见 `menu.test.ts`）。 */
export function buildMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: '设界',
      submenu: [{ role: 'quit', label: '退出设界' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];
}
