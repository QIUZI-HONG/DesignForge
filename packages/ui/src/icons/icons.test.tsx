/**
 * 图标集测试（FE-01 · 图标模块）。
 *
 * 口径来源：清单 §1.0——16px 画布 / 1.5px 线性描边 / currentColor。
 * 断言的是**可观测契约**（尺寸、描边、语义角色），不是具体路径数据——
 * 路径细节属 B 级人工复核（验收标准 §2「图标形状细节按 B 级」）。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createIcon, ICONS } from './index';

const iconEntries = Object.entries(ICONS);

describe('图标集 · 统一口径', () => {
  it('图标数量与命名齐备（清单所需基础件图标）', () => {
    expect(iconEntries.length).toBeGreaterThanOrEqual(20);
    for (const [name] of iconEntries) {
      expect(name).toMatch(/Icon$/);
    }
  });

  it('每个图标都是 16 画布 / 1.5 描边 / currentColor 的装饰性 svg', () => {
    for (const [name, Icon] of iconEntries) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, `${name} 未渲染 svg`).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg?.getAttribute('stroke-width'), name).toBe('1.5');
      expect(svg?.getAttribute('stroke'), name).toBe('currentColor');
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg?.getAttribute('focusable'), name).toBe('false');
      expect(
        (svg?.querySelectorAll('path, circle, rect') ?? []).length,
        `${name} 没有几何图形`,
      ).toBeGreaterThan(0);
      unmount();
    }
  });

  it('size 可覆盖，默认 16', () => {
    const { container: defaultBox } = render(<ICONS.CheckIcon />);
    expect(defaultBox.querySelector('svg')?.getAttribute('width')).toBe('16');
    const { container: bigBox } = render(<ICONS.CheckIcon size={24} />);
    expect(bigBox.querySelector('svg')?.getAttribute('width')).toBe('24');
    expect(bigBox.querySelector('svg')?.getAttribute('height')).toBe('24');
  });

  it('给 title 后成为具名图形（role=img + 可访问名）', () => {
    const { container } = render(<ICONS.CloseIcon title="关闭" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('title')?.textContent).toBe('关闭');
  });

  it('createIcon 生成的组件带 displayName（便于调试与门禁列举）', () => {
    const Custom = createIcon('CustomIcon', <path d="M2 2 14 14" />);
    expect(Custom.displayName).toBe('CustomIcon');
  });
});

describe('图标集 · 编辑器补全（RW-07：图层树 / Inspector / 命令面板）', () => {
  // 用词对齐 Figma 中文界面：图层类型（矩形/椭圆/多边形/直线/图片/组/区块）、
  // 拖拽把手、吸管（取色）、效果、回车（命令面板执行）、键盘（快捷键速查）。
  const REQUIRED = [
    'GripIcon',
    'RectangleIcon',
    'EllipseIcon',
    'PolygonIcon',
    'LineIcon',
    'ImageIcon',
    'GroupIcon',
    'SectionIcon',
    'PipetteIcon',
    'EffectsIcon',
    'CornerDownLeftIcon',
    'KeyboardIcon',
  ] as const;

  it('图层树/Inspector/命令面板所需图标全部在册', () => {
    const missing = REQUIRED.filter((name) => !(name in ICONS));
    expect(missing).toEqual([]);
  });

  it('补全图标沿用统一口径（16 画布 / 1.5 描边 / 装饰性）', () => {
    for (const name of REQUIRED) {
      const Icon = ICONS[name];
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 16 16');
      expect(svg?.getAttribute('stroke-width'), name).toBe('1.5');
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true');
      unmount();
    }
  });
});
