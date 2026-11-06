#!/usr/bin/env node
/**
 * coverage-report —— 逐包覆盖率报数（audit-d08 · D-11「coverage 入 CI 报数」）。
 *
 * 数据源：各 workspace 包跑完 `pnpm test:coverage` 后落在本包 `coverage/coverage-summary.json`
 * （vitest v8 provider + json-summary reporter，口径见各包 vitest.config.ts：只统计 `src/**`）。
 *
 * 报什么：
 *   1. 逐包总表——行 / 分支 / 函数 / 语句覆盖率（json-summary 的 total 段）；
 *   2. 关键分支目标集聚合——
 *      · daemon「routes 目标集」：`apps/daemon/src/routes/**`（98bd381 补测口径，同集续报）；
 *      · cli「命令参数面目标集」：`tools/cli/src/index.ts`、`src/market/index.ts`、
 *        `src/market/args.ts`、`src/config/index.ts`、`src/config/daemon.ts`（命令族/子命令
 *        分发 + 共享参数解析 + config 的地址/令牌/信封客户端——「命令参数分支」的落点）；
 *   3. 阈值标记（只标记不判定）：行 ≥80%（核心行保持线）· 关键分支 ≥90%（D-11 验收线）。
 *
 * **本步是「报数」不是「门禁」**：阈值未达标只在输出里标 ⚠，不改变退出码——覆盖率阈值
 * 是否升级为 CI 红绿是后续票的决策（届时另立 guard，按三态语义接入）；本脚本退出码只反映
 * 结构健康度：0 = 产物齐且可解析；1 = 一个产物都没有 / 产物 JSON 不可解析（结构性问题，
 * 说明 test:coverage 没跑或报告管线断了——这不能当「报数成功」放行）。
 *
 * 用法（仓库根执行，先 `pnpm test:coverage`）：
 *   node scripts/coverage-report.mjs           # 人类可读表（stderr 汇总行走 stdout）
 *   node scripts/coverage-report.mjs --json    # 机器可读 JSON（审计证据取数用）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** workspace 包目录族（与 pnpm-workspace.yaml packages 同源，scripts/ 本身不是包）。 */
const PACKAGE_GROUPS = ['apps', 'packages', 'services', 'tools'];

/** cli「命令参数面目标集」（相对 tools/cli/ 的文件清单；新增分发文件时在此登记）。 */
const CLI_ARG_SURFACE_FILES = [
  'src/index.ts',
  'src/market/index.ts',
  'src/market/args.ts',
  'src/config/index.ts',
  'src/config/daemon.ts',
];

/** 阈值（只标记不判定；口径 = OPTIMIZATION_PLAN §4 批 8 验收行）。 */
export const THRESHOLDS = { lines: 80, criticalBranches: 90 };

/**
 * 从一份 json-summary 提取 total 四元组（缺段视为 0/0，pct 记 0——不臆造数字）。
 * 入参既可以是整份 summary（total 段在 `summary.total`），也可以直接是 total 段本身。
 * @returns {{lines: number, branches: number, functions: number, statements: number,
 *            branchCovered: number, branchTotal: number}}
 */
export function extractTotals(summary) {
  const totalSegment =
    summary !== null && typeof summary === 'object' && 'total' in summary
      ? summary.total
      : (summary ?? {});
  const seg = (name) => totalSegment?.[name] ?? {};
  const pct = (seg) => (typeof seg.pct === 'number' ? seg.pct : 0);
  const branch = seg('branches');
  return {
    lines: pct(seg('lines')),
    branches: pct(branch),
    functions: pct(seg('functions')),
    statements: pct(seg('statements')),
    branchCovered: typeof branch.covered === 'number' ? branch.covered : 0,
    branchTotal: typeof branch.total === 'number' ? branch.total : 0,
  };
}

/**
 * 关键分支目标集聚合：按相对**包根**的文件路径过滤 json-summary 的逐文件条目，
 * 返回 covered/total 与 pct（目标集内一个文件都没有 → null，调用方如实报「目标集无产物」）。
 */
export function aggregateFiles(summary, packageDir, matchRelative) {
  let covered = 0;
  let total = 0;
  let matched = 0;
  for (const [absolutePath, entry] of Object.entries(summary)) {
    if (absolutePath === 'total') continue;
    const pkgRelative = relative(packageDir, absolutePath).replaceAll('\\', '/');
    if (!matchRelative(pkgRelative)) continue;
    matched += 1;
    covered += entry?.branches?.covered ?? 0;
    total += entry?.branches?.total ?? 0;
  }
  if (matched === 0) return null;
  return { covered, total, pct: total === 0 ? 0 : Math.round((covered / total) * 10000) / 100 };
}

/** daemon routes 目标集：包内路径在 src/routes/ 下。 */
export function aggregateDaemonRoutes(summary, packageDir) {
  return aggregateFiles(summary, packageDir, (pkgRelative) =>
    pkgRelative.startsWith('src/routes/'),
  );
}

/** cli 命令参数面目标集：显式文件清单（见 CLI_ARG_SURFACE_FILES）。 */
export function aggregateCliArgSurface(summary, packageDir) {
  return aggregateFiles(summary, packageDir, (pkgRelative) =>
    CLI_ARG_SURFACE_FILES.includes(pkgRelative),
  );
}

/** 枚举 workspace 包（返回 {name, dir}）；无 package.json 的子目录跳过。 */
export function listPackages(root = repoRoot) {
  const out = [];
  for (const group of PACKAGE_GROUPS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(groupDir, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let name = entry.name;
      try {
        name = JSON.parse(readFileSync(manifestPath, 'utf8')).name ?? name;
      } catch {
        // 清单不可读：保留目录名继续（报数面不能因一个包的清单炸掉）
      }
      out.push({ name, dir });
    }
  }
  return out;
}

/** 读一个包的 coverage-summary.json；返回 {summary} 或 {error}（缺失 → summary: null）。 */
function readPackageSummary(dir) {
  const summaryPath = join(dir, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) return { summary: null, summaryPath };
  try {
    return { summary: JSON.parse(readFileSync(summaryPath, 'utf8')), summaryPath };
  } catch (error) {
    return { summary: undefined, summaryPath, error: String(error) };
  }
}

/** 组装报数结构（IO 与组装分离，scripts/tests/coverage-report.test.mjs 直测本函数）。 */
export function buildReport(root = repoRoot) {
  const packages = [];
  let malformed = 0;
  let present = 0;
  for (const { name, dir } of listPackages(root)) {
    const { summary, summaryPath, error } = readPackageSummary(dir);
    if (summary === undefined) {
      malformed += 1;
      packages.push({ name, summary: null, summaryPath, error: error ?? 'json 不可解析' });
      continue;
    }
    if (summary === null) {
      packages.push({ name, summary: null, summaryPath, error: null });
      continue;
    }
    present += 1;
    packages.push({
      name,
      summaryPath,
      error: null,
      totals: extractTotals(summary),
      daemonRoutes: name === '@dforge/daemon' ? aggregateDaemonRoutes(summary, dir) : undefined,
      cliArgSurface: name === '@dforge/cli' ? aggregateCliArgSurface(summary, dir) : undefined,
    });
  }
  return { packages, present, malformed };
}

/** 人类可读表。 */
function printHuman(report) {
  const rows = report.packages.map((pkg) => {
    if (pkg.summary === null) {
      return {
        name: pkg.name,
        line: `${pkg.name.padEnd(22)} —— 无 coverage 产物（未跑 test:coverage）${pkg.error ? `（${pkg.error}）` : ''}`,
      };
    }
    const t = pkg.totals;
    const lineMark = t.lines >= THRESHOLDS.lines ? '✓' : '⚠';
    const base = `${pkg.name.padEnd(22)} 行 ${t.lines.toFixed(2).padStart(6)}% ${lineMark}   分支 ${t.branches.toFixed(2).padStart(6)}%   函数 ${t.functions.toFixed(2).padStart(6)}%   语句 ${t.statements.toFixed(2).padStart(6)}%`;
    const extras = [];
    if (pkg.daemonRoutes !== undefined) {
      const mark =
        pkg.daemonRoutes !== null && pkg.daemonRoutes.pct >= THRESHOLDS.criticalBranches
          ? '✓'
          : '⚠';
      extras.push(
        pkg.daemonRoutes === null
          ? 'routes 目标集无产物'
          : `routes 目标集分支 ${pkg.daemonRoutes.pct.toFixed(2)}% (${pkg.daemonRoutes.covered}/${pkg.daemonRoutes.total}) ${mark}`,
      );
    }
    if (pkg.cliArgSurface !== undefined) {
      const mark =
        pkg.cliArgSurface !== null && pkg.cliArgSurface.pct >= THRESHOLDS.criticalBranches
          ? '✓'
          : '⚠';
      extras.push(
        pkg.cliArgSurface === null
          ? 'cli 命令参数面目标集无产物'
          : `cli 命令参数面分支 ${pkg.cliArgSurface.pct.toFixed(2)}% (${pkg.cliArgSurface.covered}/${pkg.cliArgSurface.total}) ${mark}`,
      );
    }
    return {
      name: pkg.name,
      line: extras.length === 0 ? base : `${base}\n    ${extras.join(' · ')}`,
    };
  });
  for (const row of rows) console.log(row.line);
  console.log(
    `—— ${report.present} 包有产物` +
      `${report.malformed > 0 ? `，${report.malformed} 包产物不可解析（结构性问题）` : ''}` +
      `；标记口径：行 ≥${THRESHOLDS.lines}%（核心行保持）· 关键分支 ≥${THRESHOLDS.criticalBranches}%（D-11）` +
      `；本步只报数不判定（阈值是否升格为门禁由后续票决策）`,
  );
}

/**
 * 结构健康度退出码（与阈值无关，**不是门禁判定**）：
 *   0 = 至少一个包有产物且全部可解析；
 *   1 = 一个产物都没有（test:coverage 没跑）/ 有产物但 JSON 不可解析（报告管线断了）
 *       ——这两种情况「报数」没有发生，不得当报数成功放行。
 */
export function structuralExitCode(report) {
  return report.present === 0 || report.malformed > 0 ? 1 : 0;
}

function main() {
  const report = buildReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exit(structuralExitCode(report));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
