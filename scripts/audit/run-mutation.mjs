#!/usr/bin/env node
/**
 * Mutation 工装入口（#107 · 审计 10a）。
 *
 * 范围：**只跑 engine 的序列化模块**（`packages/engine/src/serialize/serialize.ts`），
 * 作为选择性接缝的首批基线；不覆盖全仓、不接 CI（成本高，见交接说明）。
 *
 * 为什么默认不进 CI：本机 2 并发跑一个模块约数分钟；全仓/高并发会把 CI 时间与稳定性
 * 拖成不可控。接入前需先有「已知 mutant 上限 + 增量模式 + 定时任务」的方案。
 *
 * 退出码语义：
 *   0 = mutation 运行完成（分数如实写进证据；阈值 break=null，不因低分失败）；
 *   1 = Stryker 运行失败（配置/沙箱/测试 runner 错误）；
 *   2 = 阻塞（依赖缺失 / 变异范围不存在）。
 *
 * 证据落 `<DF_EVIDENCE_DIR>/mutation/<stamp>/`（缺省 `~/df-evidence/audit-50/aud-60a`）：
 *   mutation.json / mutation.html / mutation-summary.json / stryker.log。
 *
 * 工具选择：配置用 Stryker **command runner**（`stryker.engine.config.json` 的 `testRunner`），
 * 不使用 `@stryker-mutator/vitest-runner`——后者在本仓 vitest 5.0.5 下 mutant 阶段执行
 * 0 个测试（139 个全 survived/NoCoverage，见 60a）；因此该 runner 依赖已从根
 * `package.json` / catalog / lockfile 移除。
 *
 * 命令的可移植性：Stryker command runner 用 `packages/engine/node_modules/.bin/vitest`，
 * 不能用根 `node_modules/.bin/vitest`——根 package.json 未声明 vitest，全新
 * `pnpm install --frozen-lockfile` 下根 bin 不存在（merger 复现的 exit 1）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = join(repoRoot, 'scripts', 'audit', 'stryker.engine.config.json');
const evidenceRoot = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', 'audit-50', 'aud-60a'),
);
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const runDir = join(evidenceRoot, 'mutation', stamp);

function log(message) {
  console.log(`[mutation] ${message}`);
}

if (!existsSync(configPath)) {
  console.error(`阻塞：mutation 配置不存在：${configPath}`);
  process.exit(2);
}
const strykerBin = join(repoRoot, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
if (!existsSync(strykerBin)) {
  console.error(`阻塞：未安装 @stryker-mutator/core（${strykerBin}）——先 pnpm install。`);
  process.exit(2);
}
// 前置检查：command runner 依赖包内 vitest bin；根 bin 在 frozen install 下不存在。
const engineVitestBin = join(repoRoot, 'packages', 'engine', 'node_modules', '.bin', 'vitest');
if (!existsSync(engineVitestBin)) {
  console.error(`阻塞：未找到 packages/engine 的 vitest（${engineVitestBin}）——先 pnpm install。`);
  process.exit(2);
}

mkdirSync(runDir, { recursive: true });
const jsonReport = join(runDir, 'mutation.json');
const htmlReport = join(runDir, 'mutation.html');
const startedAt = new Date();

log(`范围：engine/serialize（配置 ${configPath}）`);
log(`证据目录：${runDir}`);

// 报告路径只能在配置里指定（@stryker-mutator/core 10 没有 --jsonReporter.fileName CLI 选项）；
// 每次运行生成一份指向证据目录的运行时配置，静态配置保持可读、可复用。
const runtimeConfig = join(runDir, 'stryker.runtime.config.json');
const baseConfig = JSON.parse(readFileSync(configPath, 'utf8'));
writeFileSync(
  runtimeConfig,
  `${JSON.stringify(
    {
      ...baseConfig,
      jsonReporter: { fileName: jsonReport },
      htmlReporter: { fileName: htmlReport },
    },
    null,
    2,
  )}\n`,
);

const result = spawnSync(
  process.execPath,
  [strykerBin, 'run', runtimeConfig, '--logLevel', 'info'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  },
);
const finishedAt = new Date();
const exitCode = result.status ?? 1;

/** 从 Stryker JSON 报告现算计数与 mutation score（不抄 clear-text 输出）。 */
function summarize() {
  if (!existsSync(jsonReport)) return null;
  const report = JSON.parse(readFileSync(jsonReport, 'utf8'));
  const counts = {
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    compileError: 0,
    runtimeError: 0,
    ignored: 0,
  };
  const files = [];
  for (const [file, entry] of Object.entries(report.files ?? {})) {
    for (const mutant of entry.mutants ?? []) {
      // Stryker 的状态是 PascalCase（Killed/Survived/NoCoverage/...），归一后再计数。
      const key = mutant.status === 'NoCoverage' ? 'noCoverage' : mutant.status.toLowerCase();
      if (Object.hasOwn(counts, key)) counts[key] += 1;
      else counts.unknown = (counts.unknown ?? 0) + 1;
    }
    files.push({ file, mutants: (entry.mutants ?? []).length });
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const valid = counts.killed + counts.survived + counts.timeout + counts.noCoverage;
  const detected = counts.killed + counts.timeout;
  const mutationScore = valid === 0 ? null : Number(((detected / valid) * 100).toFixed(2));
  return { total, valid, detected, counts, mutationScore, files };
}

const summary = summarize();
const summaryDoc = {
  ticket: '#107',
  issue: '审计 10a · mutation 选择性工装',
  tool: '@stryker-mutator/core（command runner）',
  scope: ['packages/engine/src/serialize/serialize.ts'],
  defaultInCi: false,
  note: 'break=null：本次只建基线，不因低分失败；分数用于第二批计划（见交接说明）。',
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  strykerExitCode: exitCode,
  jsonReport,
  htmlReport,
  summary,
};
writeFileSync(join(runDir, 'mutation-summary.json'), `${JSON.stringify(summaryDoc, null, 2)}\n`);
if (summary !== null) {
  log(
    `mutants=${summary.total} killed=${summary.counts.killed} survived=${summary.counts.survived} ` +
      `noCoverage=${summary.counts.noCoverage} timeout=${summary.counts.timeout} ` +
      `score=${String(summary.mutationScore)}%`,
  );
}
log(`证据：${join(runDir, 'mutation-summary.json')}`);
process.exit(exitCode);
