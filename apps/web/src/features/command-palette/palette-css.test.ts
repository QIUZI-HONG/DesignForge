/**
 * 命令面板样式接线测试（票 04 · spec P0-4 断点三的根因回归钉）。
 *
 * 背景：UX 巡检实测面板「无边框裸输入框压在画布上」——根因是 `command-palette.css`
 * 25 条规则存在于代码但**全仓没有任何 import**（jsdom 不加载外部 CSS，组件测试看不见
 * 这个故障；计算样式级断言在浏览器门禁 `scripts/verify-command-palette.mjs`）。
 *
 * 本文件在组件层守住「样式随组件接线」这一静态事实：面板/速查卡的类名消费方
 * （`command-palette.tsx` / `shortcut-cheatsheet.tsx`）所在的包被加载时，样式表必须
 * 被一起引入。CSS 内容本身的正确性（居中卡片/遮罩令牌）仍由浏览器门禁断言。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** 面板组件源码（样式引入的宿主）。 */
const paletteSource = readFileSync(join(here, 'command-palette.tsx'), 'utf8');
/** 样式表源码（类名契约的对照面）。 */
const cssSource = readFileSync(join(here, 'command-palette.css'), 'utf8');

describe('命令面板样式接线（票 04 根因回归钉）', () => {
  it('command-palette.tsx 引入 command-palette.css（无引入 = 25 条规则全部裸奔）', () => {
    // 行首锚定：`// import './command-palette.css'` 这类注释形态不算接线（tp1-03
    // 红验尸发现旧正则会命中注释行——把 import 注释掉仍判绿，守护被架空）。
    expect(paletteSource).toMatch(/^\s*import\s+'\.\/command-palette\.css';$/m);
  });

  it('组件消费的核心类名在样式表里有规则（tsx 与 css 的类名契约）', () => {
    for (const className of [
      '.dfg-cmdk',
      '.dfg-cmdk__card',
      '.dfg-cmdk__search',
      '.dfg-cmdk__input',
      '.dfg-cmdk__list',
      '.dfg-cmdk__item',
      '.dfg-cmdk-cheat',
    ]) {
      expect(cssSource).toContain(className);
    }
  });
});
