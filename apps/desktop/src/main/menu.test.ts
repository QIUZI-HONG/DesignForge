import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import { buildMenuTemplate } from './menu.js';

/** 取模板里所有子菜单项（`submenu` 声明类型含 Menu 实例，按数组收窄）。 */
function submenuItems(): MenuItemConstructorOptions[] {
  return buildMenuTemplate().flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : []));
}

describe('最小菜单（多标签等 15 项体验项缓归 P6，不得混入）', () => {
  const items = submenuItems();
  const roles = items.map((item) => ('role' in item ? item.role : undefined));

  it('每项要么是标准 role（白名单内），要么是分隔符——无自造菜单项', () => {
    const allowlist = new Set([
      'quit',
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
      'reload',
      'forceReload',
      'toggleDevTools',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen',
      'minimize',
      'close',
    ]);

    for (const item of items) {
      if ('type' in item && item.type === 'separator') {
        continue;
      }
      expect(allowlist.has(String('role' in item ? item.role : undefined))).toBe(true);
    }
  });

  it('不含「新窗口 / 多标签」类入口（范围边界 A 区缓归）', () => {
    const texts = submenuItems()
      .map(
        (item) => `${'role' in item ? item.role : ''}${'label' in item ? (item.label ?? '') : ''}`,
      )
      .join(' ');

    expect(texts).not.toMatch(/newWindow|new-window|tab/i);
  });

  it('含退出与开发者工具（最小可运维集）', () => {
    expect(roles).toContain('quit');
    expect(roles).toContain('toggleDevTools');
  });

  it('含标准窗口控制（最小化/关闭，桌面端 UX 补全）', () => {
    expect(roles).toContain('minimize');
    expect(roles).toContain('close');
  });
});
