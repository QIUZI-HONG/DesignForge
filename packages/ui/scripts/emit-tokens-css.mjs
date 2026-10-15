#!/usr/bin/env node
/**
 * tokens.css 落盘器（开发工具，非门禁）。
 *
 * 用法：`node packages/ui/scripts/emit-tokens-css.mjs`（在仓库根执行）——
 * 从 `src/tokens.ts` 展平出 CSS 变量并覆写 `src/tokens.css` 的三段规则块。
 * 为什么需要它：令牌是单一真源（TS），CSS 是其落盘形态；手改任一文件都会让
 * `src/tokens.test.ts` 的逐项比对失败，用本脚本重新落盘即可回到一致。
 *
 * 依赖 Node ≥22.18 的原生 TS 类型擦除（本仓 engines: node>=22，开发机 24）。
 * 退出码：0 成功 / 1 失败（视为工程事故）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPrimitives, flattenTheme, THEMES } from '../src/tokens.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../src/tokens.css');

const dump = (vars) =>
  Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

const generated = [
  `:root {\n${dump(flattenPrimitives())}\n}`,
  `:root[data-theme="light"] {\n${dump(flattenTheme(THEMES.light))}\n}`,
  `:root[data-theme="dark"] {\n${dump(flattenTheme(THEMES.dark))}\n}`,
].join('\n\n');

const current = readFileSync(cssPath, 'utf8');
const marker = ':root {';
const head = current.slice(0, current.indexOf(marker));
if (!head.startsWith('/*')) {
  console.error('tokens.css 缺少文件头注释块，拒绝覆写。');
  process.exit(1);
}

writeFileSync(cssPath, `${head}${generated}\n`, 'utf8');
console.log(
  `已重新落盘 ${cssPath}（${Object.keys(flattenPrimitives()).length} 条共享 + 2 × 主题变量）`,
);
