/**
 * 组件快捷键登记规格（命令面板 E7 的条目契约）。
 *
 * 断言：条目标识与文案键齐备、修饰键精确匹配（多按 Shift 不命中）、
 * 文案键在 zh-CN 目录里真实存在（登记不允许「挂了键但没文案」）。
 */

import { describe, expect, it } from 'vitest';

import { t } from '@/i18n';

import { COMPONENT_SHORTCUTS, matchComponentShortcut, shortcutById } from './shortcuts';

describe('COMPONENT_SHORTCUTS（命令面板登记）', () => {
  it('条目 id 唯一且带全中文分组', () => {
    const ids = COMPONENT_SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of COMPONENT_SHORTCUTS) {
      expect(entry.category).toBe('组件');
      expect(entry.keys).not.toBe('');
    }
  });

  it('每个登记条目的文案键在 zh-CN 目录可解析（无漏译）', () => {
    for (const entry of COMPONENT_SHORTCUTS) {
      const text = t(entry.labelKey);
      expect(text).not.toBe(entry.labelKey);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('创建组件登记为 ⌘⌥K（Figma 习惯）', () => {
    expect(shortcutById('component.create')?.keys).toBe('⌘⌥K');
    expect(shortcutById('missing')?.id).toBeUndefined();
  });
});

describe('matchComponentShortcut（键盘匹配）', () => {
  it('⌘⌥K 命中创建组件', () => {
    expect(matchComponentShortcut({ key: 'k', metaKey: true, altKey: true })?.id).toBe(
      'component.create',
    );
  });

  it('主键大小写不敏感（大写锁）', () => {
    expect(matchComponentShortcut({ key: 'K', metaKey: true, altKey: true })?.id).toBe(
      'component.create',
    );
  });

  it('修饰键精确匹配：少按或多按都不命中', () => {
    expect(matchComponentShortcut({ key: 'k', altKey: true })).toBeNull();
    expect(
      matchComponentShortcut({ key: 'k', metaKey: true, altKey: true, shiftKey: true }),
    ).toBeNull();
    expect(
      matchComponentShortcut({ key: 'k', metaKey: true, altKey: true, ctrlKey: true }),
    ).toBeNull();
  });

  it('未登记的键不命中', () => {
    expect(matchComponentShortcut({ key: 'q', metaKey: true, altKey: true })).toBeNull();
    expect(matchComponentShortcut({ key: 'k' })).toBeNull();
  });

  it('重置覆盖登记为 ⌘⌥R', () => {
    expect(matchComponentShortcut({ key: 'r', metaKey: true, altKey: true })?.id).toBe(
      'component.resetOverrides',
    );
  });
});
