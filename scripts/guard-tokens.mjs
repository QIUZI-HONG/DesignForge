#!/usr/bin/env node
/**
 * guard-tokens —— 组件「禁裸值」守卫（FE-01 交付；本票范围内自管，**不接 CI**）。
 *
 * 用法（仓库根执行）：
 *   node scripts/guard-tokens.mjs             # 扫 apps/web/src + packages/ui/src
 *   node scripts/guard-tokens.mjs --verbose   # 附带打印白名单跳过明细
 *   node scripts/guard-tokens.mjs --roots apps/web/src
 *
 * 规则（详见 packages/ui/src/tools/guard-tokens-core.mjs 的 R1/R2/R3）：
 *   R1 颜色裸值 `#hex` / `rgb()` / `hsl()`；R2 长度裸值 `12px`/`1.5rem`（零值放行）；
 *   R3 样式对象里的间距族裸数字（`marginTop: 8`）。
 * 精度：注释与字符串里的**样式语法文本**（带 `{`、`rgb(`/`hsl(`、或令牌引用示例 `var(--dfg-…)`）
 * 视为说明/夹具而非取值，跳过；朴素取值写法（如注释里直接写 `#0d99ff` / `12px`）仍照抓。
 * 白名单：令牌定义文件（tokens.ts / tokens.css）、测试文件、守卫自测、
 * 以及行内豁免注释 `guard-tokens:allow <理由>`（理由必填）。
 *
 * 为什么先不接 CI：本段并肩开发多票，误伤他人既有文件的成本高于收益；
 * 接入 CI 由「四守卫」票统一处理（届时把本脚本并入 guard 家族）。
 *
 * 退出码（门禁三态，禁止假绿）：0 通过 / 1 违规 / 2 阻塞（扫描根缺失等前置不成立）。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ROOTS, RULES, scanRoots } from '../packages/ui/src/tools/guard-tokens-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const rootsIndex = args.indexOf('--roots');
const roots =
  rootsIndex >= 0
    ? (args[rootsIndex + 1] ?? '').split(',').filter((item) => item.length > 0)
    : DEFAULT_ROOTS;

if (roots.length === 0) {
  console.error('guard-tokens：未指定扫描目录。');
  process.exit(2);
}

const missing = roots.filter((root) => !existsSync(join(repoRoot, root)));
if (missing.length > 0) {
  console.error(`guard-tokens：扫描目录不存在 → ${missing.join(', ')}（阻塞，非通过）。`);
  process.exit(2);
}

const { violations, skipped } = scanRoots(repoRoot, roots);

if (verbose) {
  console.log(`guard-tokens：扫描 ${roots.join(', ')}`);
  for (const item of skipped) {
    console.log(`  ⤳ 白名单跳过 ${item.file}（${item.reason}）`);
  }
}

if (violations.length === 0) {
  console.log(`guard-tokens：通过（0 违规；规则 ${RULES.map((rule) => rule.id).join('/')}）。`);
  process.exit(0);
}

const byFile = new Map();
for (const violation of violations) {
  const list = byFile.get(violation.file) ?? [];
  list.push(violation);
  byFile.set(violation.file, list);
}

console.error(
  `guard-tokens：发现 ${violations.length} 处裸值（组件禁裸值：颜色/间距/圆角/字号走令牌）`,
);
for (const [file, list] of byFile) {
  console.error(`  ${file}`);
  for (const item of list) {
    console.error(
      `    ${item.line}:${item.column} [${item.rule} ${item.ruleTitle}] ${item.text} —— ${item.hint}`,
    );
  }
}
console.error(
  '修复：改用 var(--dfg-…) 令牌引用；确有个别例外时在该行注释里写 `guard-tokens:allow <理由>`。',
);
process.exit(1);
