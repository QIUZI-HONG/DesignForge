/**
 * `scripts/coverage-report.mjs` 的组装逻辑回归测试（audit-d08 · D-11 coverage 报数步骤）。
 *
 * 覆盖面（纯函数，直测不碰真实仓库的 coverage/ 产物——test:scripts 在 CI 里先于
 * coverage 报数步跑，主流程不得对仓库当前产物状态有任何假设）：
 *  - extractTotals：完整 total 段取数；缺段记 0（不臆造数字）；
 *  - 目标集聚合：daemon routes 目录过滤、cli 命令参数面显式清单过滤、目标集全缺 → null；
 *  - buildReport：夹具根下「有产物 / 无产物 / 产物不可解析」三态包的计数与归属
 *    （daemonRoutes / cliArgSurface 只挂在对应包名上）；
 *  - structuralExitCode：齐 → 0；全缺 / 不可解析 → 1（报数管线断，不得当成功）。
 *
 * 用法：`pnpm test:scripts`（node --test + 根 glob，覆盖 scripts/tests 下全部 `*.test.mjs`）。
 * 退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  aggregateCliArgSurface,
  aggregateDaemonRoutes,
  buildReport,
  extractTotals,
  structuralExitCode,
  THRESHOLDS,
} from '../coverage-report.mjs';

/** 造一份 istanbul json-summary 形状的 total 段。 */
function makeSummary(entries) {
  const summary = {
    total: {
      statements: { covered: 10, total: 10, pct: 100 },
      branches: { covered: 5, total: 5, pct: 100 },
      functions: { covered: 3, total: 3, pct: 100 },
      lines: { covered: 12, total: 12, pct: 100 },
    },
  };
  for (const [absolutePath, branches] of Object.entries(entries)) {
    summary[absolutePath] = {
      statements: { covered: 1, total: 1, pct: 100 },
      functions: { covered: 1, total: 1, pct: 100 },
      lines: { covered: 1, total: 1, pct: 100 },
      branches: {
        covered: branches[0],
        total: branches[1],
        pct: (branches[0] / branches[1]) * 100,
      },
    };
  }
  return summary;
}

test('extractTotals：完整 total 段取四元组与分支计数；缺段记 0', () => {
  const summary = makeSummary({});
  const totals = extractTotals(summary);
  assert.deepEqual(
    { ...totals },
    {
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
      branchCovered: 5,
      branchTotal: 5,
    },
  );

  const empty = extractTotals({});
  assert.deepEqual(
    { ...empty },
    { lines: 0, branches: 0, functions: 0, statements: 0, branchCovered: 0, branchTotal: 0 },
  );
});

test('aggregateDaemonRoutes：只聚 src/routes/ 下文件；目标集全缺 → null', () => {
  const packageDir = '/repo/apps/daemon';
  const summary = makeSummary({
    '/repo/apps/daemon/src/routes/assets.ts': [18, 20],
    '/repo/apps/daemon/src/routes/config.ts': [9, 10],
    '/repo/apps/daemon/src/main.ts': [0, 10],
  });
  const routes = aggregateDaemonRoutes(summary, packageDir);
  assert.ok(routes !== null);
  assert.equal(routes.covered, 27);
  assert.equal(routes.total, 30);
  assert.equal(routes.pct, 90);

  assert.equal(
    aggregateDaemonRoutes(makeSummary({ '/repo/apps/daemon/src/main.ts': [1, 2] }), packageDir),
    null,
  );
});

test('aggregateCliArgSurface：显式五文件清单聚合；清单外不计数；全缺 → null', () => {
  const packageDir = '/repo/tools/cli';
  const summary = makeSummary({
    '/repo/tools/cli/src/index.ts': [7, 8],
    '/repo/tools/cli/src/market/index.ts': [4, 8],
    '/repo/tools/cli/src/market/args.ts': [3, 3],
    '/repo/tools/cli/src/config/index.ts': [5, 5],
    '/repo/tools/cli/src/config/daemon.ts': [0, 2],
    '/repo/tools/cli/src/market/collect-cmd.ts': [100, 100], // 清单外：命令实现面，不进参数面
  });
  const argSurface = aggregateCliArgSurface(summary, packageDir);
  assert.ok(argSurface !== null);
  assert.equal(argSurface.covered, 19);
  assert.equal(argSurface.total, 26);
  assert.equal(argSurface.pct, 73.08);

  assert.equal(aggregateCliArgSurface(makeSummary({}), packageDir), null);
});

test('buildReport：夹具根下三态包计数正确；目标集只挂对应包名；structuralExitCode 分流', () => {
  const root = mkdtempSync(join(tmpdir(), 'df-coverage-report-'));
  try {
    const daemonDir = join(root, 'apps', 'daemon');
    const cliDir = join(root, 'tools', 'cli');
    const bareDir = join(root, 'packages', 'ui');
    const brokenDir = join(root, 'services', 'ingest');
    for (const [dir, name] of [
      [daemonDir, '@dforge/daemon'],
      [cliDir, '@dforge/cli'],
      [bareDir, '@dforge/ui'],
      [brokenDir, '@dforge/ingest'],
    ]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
    }
    mkdirSync(join(daemonDir, 'coverage'), { recursive: true });
    writeFileSync(
      join(daemonDir, 'coverage', 'coverage-summary.json'),
      JSON.stringify(makeSummary({ [join(daemonDir, 'src', 'routes', 'assets.ts')]: [9, 10] })),
    );
    mkdirSync(join(cliDir, 'coverage'), { recursive: true });
    writeFileSync(
      join(cliDir, 'coverage', 'coverage-summary.json'),
      JSON.stringify(makeSummary({ [join(cliDir, 'src', 'index.ts')]: [4, 4] })),
    );
    mkdirSync(join(brokenDir, 'coverage'), { recursive: true });
    writeFileSync(join(brokenDir, 'coverage', 'coverage-summary.json'), '{ not json');

    const report = buildReport(root);
    assert.equal(report.packages.length, 4);
    assert.equal(report.present, 2);
    assert.equal(report.malformed, 1);

    const daemon = report.packages.find((pkg) => pkg.name === '@dforge/daemon');
    assert.ok(daemon?.daemonRoutes);
    assert.equal(daemon.daemonRoutes.pct, 90);
    assert.equal(daemon.cliArgSurface, undefined);

    const cli = report.packages.find((pkg) => pkg.name === '@dforge/cli');
    assert.ok(cli?.cliArgSurface);
    assert.equal(cli.cliArgSurface.pct, 100);
    assert.equal(cli.daemonRoutes, undefined);

    const bare = report.packages.find((pkg) => pkg.name === '@dforge/ui');
    assert.equal(bare?.summary, null);
    assert.equal(bare?.error, null);

    assert.equal(structuralExitCode(report), 1); // 有不可解析产物 → 报数管线断
    assert.equal(structuralExitCode({ packages: [], present: 0, malformed: 0 }), 1); // 全缺
    assert.equal(structuralExitCode({ packages: [], present: 2, malformed: 0 }), 0);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('THRESHOLDS：标记口径钉住批 8 验收行（行 ≥80 · 关键分支 ≥90）', () => {
  assert.deepEqual(THRESHOLDS, { lines: 80, criticalBranches: 90 });
});
