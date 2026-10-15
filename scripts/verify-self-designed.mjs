#!/usr/bin/env node
/**
 * verify-self-designed —— 自设计页门禁（FE-09 交付；**FE-11 复用**）。
 *
 * 依据：《前端验收标准 v1》§6——自设计页不逐像素对照，改走三类检查：
 *   ① 设计系统一致性（令牌 / 组件 / 密度 / 栅格）→ 本脚本用 `guard-tokens` 核心扫
 *      「禁裸值」（颜色/长度/样式裸数字），违规即缺陷；
 *   ② 状态覆盖（同 §5 六态）→ 静态检查六态**证据挂点**存在性：
 *      源码里出现 `data-df-state="<状态>"` 或 `data-df-state={…'<状态>'…}`
 *      （动态态：loading/empty/error；交互态：hover/active/disabled 落在可定位的控件上）；
 *   ③ 与相邻对照页风格同族 → **人工 B 级**，本脚本只登记（`humanReview: pending`），不自动判。
 *
 * 不依赖参照集：本门禁无参照图、无浏览器，纯静态判定，退出码只用 0/1
 * （0 = 三类检查中自动项全过；1 = 有违规）。`2 = 阻塞`仅用于前置不成立
 * （扫描根缺失 / 守卫核心不可导入）——与仓库其它门禁的三态口径一致，禁止把 2 当通过。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-self-designed.mjs                      # FE-09 默认根
 *   node scripts/verify-self-designed.mjs --roots <csv> --ticket fe-11
 *   node scripts/verify-self-designed.mjs --verbose
 *
 * 参数：
 *   --roots   逗号分隔的扫描根（相对仓库根；默认 FE-09 的 feature + 路由目录）
 *   --ticket  证据归属票号（默认 fe-09；影响证据目录名）
 *   --out     证据根目录（默认 ~/df-evidence）
 *   --verbose 打印逐项明细
 *
 * 证据 JSON（字段对齐《前端验收标准 v1》§4 家族口径，落仓库外）：
 *   `~/df-evidence/<ticket>/verify-self-designed-<时间戳>.json`
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRoots } from '../packages/ui/src/tools/guard-tokens-core.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 验收标准 §5 六态。 */
const STATES = ['hover', 'active', 'disabled', 'loading', 'empty', 'error'];

/** 默认扫描根（FE-09：设置族 feature + 三路由）。FE-11 复用请显式传 --roots。 */
const DEFAULT_ROOTS = ['apps/web/src/features/settings', 'apps/web/src/app/settings'];

/** 扫描的源码扩展名。 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** 测试文件（六态挂点只看产品代码：测试里的断言串不算挂点）。 */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** 跳过的目录名。 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'out', 'coverage']);

/* ---------- 参数 ---------- */

const args = process.argv.slice(2);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const roots = (flagValue('--roots') ?? DEFAULT_ROOTS.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item.length > 0);
const ticket = flagValue('--ticket') ?? 'fe-09';
const evidenceRoot = resolve(flagValue('--out') ?? join(homedir(), 'df-evidence'));
const verbose = args.includes('--verbose');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(evidenceRoot, ticket);
const evidencePath = join(evidenceDir, `verify-self-designed-${stamp}.json`);

/** 证据骨架。 */
function baseEvidence() {
  return {
    ticket: ticket.toUpperCase(),
    gate: 'verify-self-designed',
    level: '自设计页（《前端验收标准 v1》§6：令牌一致性 + 六态覆盖 + 风格同族人工项）',
    referenceSet: '不适用（自设计页无参照集；本门禁 0/1，前置不成立为 2）',
    params: { roots, states: STATES },
    startedAt: startedAt.toISOString(),
    checks: {
      tokenConsistency: { verdict: 'pending', violations: [], whitelisted: [] },
      stateCoverage: { verdict: 'pending', states: {} },
      styleFamily: { verdict: 'pending', note: '人工 B 级：需对照相邻对照页截图复核' },
    },
    pages: [],
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '风格同族（§6 ③）为人工 B 级项：自动项通过后需人工对照相邻对照页登记。',
    },
    exitCode: 2,
  };
}

/** 落盘证据并结束进程。 */
function finish(evidence, code, message) {
  evidence.exitCode = code;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (message) console.log(message);
  console.log(`证据：${evidencePath}`);
  process.exit(code);
}

/** 相对仓库根的 `/` 分隔路径。 */
function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split(sep).join('/');
}

/** { sha256, length } 指纹。 */
function fingerprint(absPath) {
  const buffer = readFileSync(absPath);
  return {
    path: relPath(absPath),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 递归收集源码文件（绝对路径）。 */
function collectSourceFiles(absRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(absRoot);
  return out.sort();
}

/** 六态挂点匹配：`data-df-state="<态>"` 或 `data-df-state={…'<态>'…}`。 */
function hookPattern(state) {
  return new RegExp(`data-df-state=(?:"${state}"|\\{[^}]*["']${state}["'][^}]*\\})`);
}

const evidence = baseEvidence();

/* ---------- 前置（阻塞即 exit 2，不猜） ---------- */

const missingRoots = roots.filter((root) => !existsSync(join(REPO_ROOT, root)));
if (missingRoots.length > 0) {
  evidence.blockedReason = `扫描根不存在：${missingRoots.join(', ')}（前置不成立，非通过）`;
  finish(evidence, 2, `阻塞：扫描根不存在 → ${missingRoots.join(', ')}`);
}

/* ---------- ① 令牌一致性（复用 guard-tokens 核心） ---------- */

const tokenScan = scanRoots(REPO_ROOT, roots);
evidence.checks.tokenConsistency.violations = tokenScan.violations;
evidence.checks.tokenConsistency.verdict = tokenScan.violations.length === 0 ? 'pass' : 'fail';
evidence.checks.tokenConsistency.whitelisted = tokenScan.skipped;

/* ---------- ② 六态覆盖挂点 ---------- */

const sourceFiles = roots.flatMap((root) =>
  collectSourceFiles(join(REPO_ROOT, root)).filter((file) => !TEST_FILE.test(file)),
);
const stateHooks = {};
for (const state of STATES) {
  const hits = [];
  for (const file of sourceFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (hookPattern(state).test(line)) {
        hits.push({ file: relPath(file), line: index + 1 });
      }
    });
  }
  stateHooks[state] = hits;
}
evidence.checks.stateCoverage.states = stateHooks;
const missingStates = STATES.filter((state) => stateHooks[state].length === 0);
evidence.checks.stateCoverage.verdict = missingStates.length === 0 ? 'pass' : 'fail';

/* ---------- 路由登记（app 根下的 page.tsx → 路由路径） ---------- */

const pages = [];
for (const root of roots) {
  const appPrefix = 'apps/web/src/app/';
  if (!`${root}/`.startsWith(appPrefix)) continue;
  for (const file of collectSourceFiles(join(REPO_ROOT, root))) {
    if (!file.endsWith(`${sep}page.tsx`)) continue;
    const route = `/${relPath(file)
      .slice(appPrefix.length)
      .replace(/\/?page\.tsx$/, '')}`;
    pages.push(route === '/' ? '/' : route);
  }
}
evidence.pages = pages.sort();
for (const route of evidence.pages) {
  const file = join(REPO_ROOT, `apps/web/src/app${route === '/' ? '' : route}/page.tsx`);
  if (existsSync(file)) {
    evidence.artifacts[route] = fingerprint(file);
  }
}

/* ---------- ③ 风格同族（人工项登记，不自动判） ---------- */

evidence.checks.styleFamily.verdict = 'pending';

/* ---------- 结论 ---------- */

const failures = [];
if (evidence.checks.tokenConsistency.verdict === 'fail') {
  failures.push(`裸值违规 ${tokenScan.violations.length} 处`);
}
if (missingStates.length > 0) {
  failures.push(`六态挂点缺失：${missingStates.join(', ')}`);
}

if (verbose) {
  for (const root of roots) console.log(`扫描根：${root}`);
  for (const state of STATES) {
    const hits = stateHooks[state];
    console.log(`  [${hits.length > 0 ? '✓' : '✗'}] ${state}：${hits.length} 处挂点`);
    for (const hit of hits.slice(0, 3)) console.log(`      ${hit.file}:${hit.line}`);
  }
  console.log(`  路由：${evidence.pages.join(', ') || '（未登记）'}`);
}

const code = failures.length === 0 ? 0 : 1;
if (code === 0) {
  finish(
    evidence,
    0,
    [
      'verify-self-designed：通过（自动项）。',
      `  ① 令牌一致性：0 裸值违规（${sourceFiles.length} 文件）`,
      `  ② 六态挂点：${STATES.join(' / ')} 全部命中`,
      '  ③ 风格同族：人工 B 级项已登记（humanReview.pending）——自动项通过 ≠ 验收通过。',
    ].join('\n'),
  );
}
finish(
  evidence,
  1,
  [
    `verify-self-designed：违规（${failures.join('；')}）。`,
    '  逐项明细见证据 JSON；修复后重跑，禁止放行。',
  ].join('\n'),
);
