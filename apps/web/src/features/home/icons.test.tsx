/**
 * 首页自绘图标测试（FE-02）。
 *
 * 断言对外形状（16 画布 / currentColor / 装饰性 aria-hidden / 尺寸可覆盖），
 * 形状细节按验收标准 §2 属 B 级（视觉同族，人工复核）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ClockIcon,
  FolderIcon,
  GearIcon,
  GridViewIcon,
  ListViewIcon,
  SparkleIcon,
  TemplateIcon,
} from './icons';

const ALL = {
  GearIcon,
  GridViewIcon,
  ListViewIcon,
  ClockIcon,
  FolderIcon,
  SparkleIcon,
  TemplateIcon,
};

describe('首页图标集', () => {
  it('默认装饰性：aria-hidden、无 role=img', () => {
    for (const [name, Icon] of Object.entries(ALL)) {
      const html = renderToStaticMarkup(<Icon />);
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).not.toContain('role="img"');
    }
  });

  it('统一 16 画布与 currentColor 描边，默认边长 16', () => {
    for (const [name, Icon] of Object.entries(ALL)) {
      const html = renderToStaticMarkup(<Icon />);
      expect(html, name).toContain('viewBox="0 0 16 16"');
      expect(html, name).toContain('stroke="currentColor"');
      expect(html, name).toContain('width="16"');
      expect(html, name).toContain('height="16"');
    }
  });

  it('尺寸可覆盖（AI 提示区用 24 档）', () => {
    expect(renderToStaticMarkup(<SparkleIcon size={24} />)).toContain('width="24"');
  });
});
