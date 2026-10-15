/**
 * `/_design` 预览页测试（FE-01 · 预览页）。
 *
 * 断言：
 * 1. 页面可服务端渲染（无浏览器 API 依赖）——门禁取样与人工预览都依赖它能起得来；
 * 2. 全组件 × 全状态矩阵真的铺开：每个可对照单元带 `data-df-preview` 取样名，
 *    六态（验收标准 §5）在按钮族上有对应单元；
 * 3. 状态族登记表在页面上逐项可见（F1/F2/F3/F11–F15）；
 * 4. 渲染产物里没有裸色值（禁裸值的 DOM 级检查，与 guard-tokens 静态检查互补）。
 */

import { INTERACTION_STATES, STATE_FAMILIES } from '@dforge/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DesignPreviewPage from './page';

const html = renderToStaticMarkup(<DesignPreviewPage />);

/** 取出所有门禁取样名。 */
const previewIds = [...html.matchAll(/data-df-preview="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('设计系统预览页（/_design）', () => {
  it('服务端可渲染（内部工具能起得来）', () => {
    expect(html).toContain('设计系统预览');
    expect(html).toContain('data-df-section="tokens"');
  });

  it('取样名覆盖各分区（令牌/图标/按钮/输入/菜单/模态/抽屉/Toast/状态族）', () => {
    const groups = new Set(previewIds.map((id) => id.split('/')[0]));
    for (const expected of [
      'token',
      'icon',
      'family',
      'button',
      'icon-button',
      'segmented',
      'input',
      'tooltip',
      'menu',
      'empty',
      'error',
      'loading',
    ]) {
      expect(groups, `缺分区：${expected}`).toContain(expected);
    }
    expect(previewIds.length).toBeGreaterThan(40);
  });

  it('按钮族六态齐备（hover/active/disabled/loading 静态可取样）', () => {
    for (const state of ['default', 'hover', 'active', 'disabled', 'loading']) {
      expect(previewIds, `缺按钮态：${state}`).toContain(`button/primary/${state}`);
    }
  });

  it('六态枚举齐全（预览页与验收标准 §5 同一套词）', () => {
    expect(INTERACTION_STATES).toEqual([
      'hover',
      'active',
      'disabled',
      'loading',
      'empty',
      'error',
    ]);
  });

  it('状态族逐项在页面上可见（F1/F2/F3/F11–F15）', () => {
    for (const family of STATE_FAMILIES) {
      expect(html, `缺族：${family.id}`).toContain(`${family.id} · ${family.name}`);
    }
  });

  it('渲染产物无裸色值（DOM 级禁裸值检查）', () => {
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });
});
