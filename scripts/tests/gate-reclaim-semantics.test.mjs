/**
 * 门禁脚本回收语义与注入 API 的**静态回归钉**（审计缺陷 D-09 · audit-d07）。
 *
 * 缺陷回顾（证据 ~/df-evidence/audit-2026-11/gate-browser/）：
 *   ① 回收语义冲突：四个浏览器门禁的 finish() 第三段「按端口找监听者 SIGKILL」只看
 *      `webUrl !== null`——DF_WEB_URL 复用的**外部站点**也会被当残留杀掉（审计期实测
 *      误杀共享站点）。修正后该段只作用于**本脚本自起**的站点（`reuseSite === false`）；
 *      外部站点只探测复用，不可达走既有三态 exit 2 阻塞。
 *   ② verify-perf 误用 puppeteer 的 `page.evaluateOnNewDocument`（playwright-core 是
 *      `addInitScript`），@1k 档实跑抛 TypeError。
 *
 * 回收逻辑内嵌在各脚本的 finish()（I/O 区），不是可导出纯函数，故按 guard 检出强度
 * 回归的先例做**源结构断言**：钉住「killPortListener 调用必须被 !reuseSite 门控」与
 * 「禁用 evaluateOnNewDocument」两条不变量，防止回归。
 *
 * 用法：`pnpm test:scripts`（node --test）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const script = (name) => join(repoRoot, 'scripts', name);
const source = (name) => readFileSync(script(name), 'utf8');

/** 带第三段按端口回收的四个浏览器门禁（grep「回收残留监听进程」的全集）。 */
const RECLAIM_SCRIPTS = [
  'verify-command-palette.mjs',
  'verify-ruler-guides-persist.mjs',
  'verify-layers-reorder-persist.mjs',
  'verify-text-inline-edit.mjs',
];

test('四个回收脚本都定义 reuseSite（外部 DF_WEB_URL 复用记录旗标）', () => {
  for (const name of RECLAIM_SCRIPTS) {
    const src = source(name);
    assert.match(
      src,
      /const reuseSite = webUrl !== null;/,
      `${name} 缺 reuseSite 旗标定义（外部复用站点与自起站点必须可区分）`,
    );
  }
});

test('killPortListener 调用必须被 !reuseSite 门控（外部站点绝不按端口回收）', () => {
  for (const name of RECLAIM_SCRIPTS) {
    const src = source(name);
    const lines = src.split('\n');
    const callSites = lines
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => /(?<!function )killPortListener\(port\)/.test(line));
    assert.ok(
      callSites.length >= 1,
      `${name} 未找到 killPortListener 调用点（脚本结构变了，更新本测试）`,
    );
    for (const { line, number } of callSites) {
      // 门控行必在调用点上方 4 行内（`if (!reuseSite && webUrl !== null) {`）。
      const window = lines.slice(Math.max(0, number - 5), number - 1).join('\n');
      assert.match(
        window,
        /if \(!reuseSite && webUrl !== null\) \{/,
        `${name}:${number} 的 killPortListener 调用未被 !reuseSite 门控——外部 DF_WEB_URL 站点会被误杀（D-09 回归）`,
      );
      void line;
    }
  }
});

test('外部复用站点必须有不回收说明（回收边界可读，不靠读代码考古）', () => {
  for (const name of RECLAIM_SCRIPTS) {
    const src = source(name);
    assert.match(
      src,
      /不回收该站点进程/,
      `${name} 缺「外部站点不回收」的显式日志（回收边界必须可读）`,
    );
  }
});

test('verify-perf 用 playwright 的 addInitScript，不用 puppeteer 的 evaluateOnNewDocument', () => {
  const src = source('verify-perf.mjs');
  // 只钉**方法调用形态**（`.evaluateOnNewDocument(`）——注释里提及该名字（登记缺陷）不算违规。
  assert.doesNotMatch(
    src,
    /\.evaluateOnNewDocument\(/,
    'verify-perf.mjs 出现 evaluateOnNewDocument（puppeteer API）——playwright-core 实跑抛 TypeError（D-09 缺陷①回归）',
  );
  assert.match(
    src,
    /addInitScript\(INSTALL_FCP_OBSERVER\)/,
    'verify-perf.mjs 未用 addInitScript 注入 FCP 观察者（M1 辅助读数会失联）',
  );
});
