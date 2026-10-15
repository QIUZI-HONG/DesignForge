#!/usr/bin/env node
/**
 * verify-mk-01 —— MK-01 采集器门禁（issue #30 DoD）。
 *
 * 检查（全部只读）：
 *   1. 单元测试：services/ingest 全量 vitest（识别规则正反例/限速/分页/重放等）；
 *   2. ODS 产物 schema：raw_snapshots 一仓一记录逐行校验（复用采集器同一套校验器，
 *      单一真源，避免校验逻辑双写）；
 *   3. 请求纪律证据：raw_events 逐行校验（method=GET、状态码、预算记账），并从事件
 *      时间区间**离线复算**「串行（并发度=1）」与 304 计数，与证据 JSON 声明互证；
 *   4. 证据 JSON：`df.market.evidence/v1` 结构 + 四步齐备 + exitCode 语义一致。
 *
 * 退出码（规格《市场首实现》§6.1，禁止假绿）：
 *   0 = 全过；
 *   1 = 有产物但断言失败（真失败）；
 *   2 = 阻塞：无产物（未采集或网络不可用——脚本会探测并如实说明）/ 依赖不可用。
 *
 * 用法：
 *   node scripts/verify-mk-01.mjs [--dir ~/df-evidence/mk-01] [--evidence <file>] [--skip-tests]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INGEST_DIR = join(ROOT, 'services', 'ingest');

/** 解析参数。 */
function parseArgs(argv) {
  const opts = { dir: join(homedir(), 'df-evidence', 'mk-01'), evidence: null, skipTests: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      return argv[i] ?? '';
    };
    if (arg === '--dir') opts.dir = resolve(value());
    else if (arg === '--evidence') opts.evidence = resolve(value());
    else if (arg === '--skip-tests') opts.skipTests = true;
    else {
      console.error(
        `未知参数：${arg}\n用法：node scripts/verify-mk-01.mjs [--dir <证据目录>] [--evidence <文件>] [--skip-tests]`,
      );
      process.exit(2);
    }
  }
  return opts;
}

/** 定位最新证据 JSON（按 mtime）。 */
function latestEvidence(dir) {
  const evidenceDir = join(dir, 'evidence');
  if (!existsSync(evidenceDir)) return null;
  const files = readdirSync(evidenceDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(evidenceDir, f));
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

/** 探测网络/凭据状态（仅在无产物时用于如实说明阻塞原因）。 */
async function probeNetwork() {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (token === '') return 'unknown（无 GH_TOKEN/GITHUB_TOKEN，无法探测）';
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? 'reachable（网络可达：说明是尚未采集）' : `http-${res.status}`;
  } catch (error) {
    return `unreachable（${error instanceof Error ? error.message : String(error)}）`;
  }
}

/** 读 JSONL 为数组。 */
function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));
}

const failures = [];
const notes = [];
function check(ok, message) {
  if (ok) notes.push(`  ✓ ${message}`);
  else failures.push(`  ✗ ${message}`);
  return ok;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('MK-01 门禁（verify-mk-01）');
  console.log(`  证据目录：${opts.dir}`);

  // 0) 依赖可用性（阻塞语义而非失败）
  const vitest = join(INGEST_DIR, 'node_modules', '.bin', 'vitest');
  if (!opts.skipTests && !existsSync(vitest)) {
    console.error(`\n阻塞：缺少 vitest（${vitest}）——先 pnpm install。exit 2`);
    process.exit(2);
  }

  // 1) 单元测试
  if (!opts.skipTests) {
    const run = spawnSync(vitest, ['run'], { cwd: INGEST_DIR, encoding: 'utf8' });
    const tail = (run.stdout ?? '')
      .split('\n')
      .filter((l) => l.includes('Test Files') || l.includes('Tests '))
      .join(' | ');
    console.log(`\n[1/4] 单元测试：${tail || '(无摘要输出)'}`);
    if (run.status !== 0) {
      console.error(`  ✗ services/ingest 单测未过（exit=${run.status}）——先修测试再谈门禁。`);
      process.exit(1);
    }
    console.log('  ✓ 单测全绿');
  } else {
    console.log('\n[1/4] 单元测试：跳过（--skip-tests）');
  }

  // 2) 定位产物
  const evidencePath = opts.evidence ?? latestEvidence(opts.dir);
  if (evidencePath === null || !existsSync(evidencePath)) {
    const probe = await probeNetwork();
    console.error(`\n阻塞：未发现采集证据（${join(opts.dir, 'evidence', '*.json')}）。`);
    console.error(`  网络探测：${probe}`);
    console.error(
      '  说明：先跑 `node services/ingest/src/collect/cli.ts --limit 5 …` 产出真网证据，再跑本门禁。',
    );
    console.error('exit 2（阻塞：无数据/不可判定——禁止假绿）');
    process.exit(2);
  }
  console.log(`\n[2/4] 证据 JSON：${evidencePath}`);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  check(
    evidence.schema === 'df.market.evidence/v1',
    `schema = df.market.evidence/v1（实际 ${evidence.schema}）`,
  );
  check([0, 1, 2].includes(evidence.exitCode), `exitCode ∈ {0,1,2}（实际 ${evidence.exitCode}）`);
  check(
    Array.isArray(evidence.steps) && evidence.steps.length >= 4,
    `steps ≥ 4（实际 ${evidence.steps?.length}）`,
  );
  const stepIds = (evidence.steps ?? []).map((s) => s.id);
  for (const id of ['request-discipline', 'asset-identification', 'license-gate', 'ods-output']) {
    check(stepIds.includes(id), `步骤齐备：${id}`);
  }
  check(typeof evidence.offline === 'boolean', `offline 字段为布尔（实际 ${evidence.offline}）`);
  check(
    typeof evidence.runId === 'string' && evidence.runId.length > 0,
    `runId 非空（${evidence.runId}）`,
  );

  // 3) 请求纪律：从 raw_events 离线复算（不信自述，重算一次）
  const { validateOdsRepoRecord, validateRawEvent } = await import(
    join(INGEST_DIR, 'src', 'collect', 'ods.ts')
  );
  const artifacts = (evidence.steps ?? []).flatMap((s) => s.artifacts ?? []);
  const eventsArtifact = artifacts.find((a) => a.path?.includes('raw_events'));
  const snapshotsArtifact = artifacts.find((a) => a.path?.includes('raw_snapshots'));
  check(Boolean(eventsArtifact), '证据引用 raw_events 产物');
  check(Boolean(snapshotsArtifact), '证据引用 raw_snapshots 产物');

  if (eventsArtifact && existsSync(eventsArtifact.path)) {
    const events = readJsonl(eventsArtifact.path);
    const issues = events.flatMap((e) => validateRawEvent(e));
    check(issues.length === 0, `raw_events 逐行 schema 全过（问题 ${issues.length} 条）`);
    const nonGet = events.filter((e) => e.request?.method !== 'GET').length;
    check(nonGet === 0, `一律 GET（非 GET ${nonGet} 次；gh api -f 变 POST 的坑）`);

    const sorted = [...events].sort((a, b) => a.startedAtMs - b.startedAtMs);
    let overlaps = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startedAtMs < sorted[i - 1].endedAtMs) overlaps += 1;
    }
    check(overlaps === 0, `串行（并发度 = 1）：区间重叠 ${overlaps} 处`);

    const declared = evidence.steps.find((s) => s.id === 'request-discipline')?.metrics ?? {};
    const hits304 = events.filter((e) => e.response?.status === 304).length;
    check(
      declared.cacheHits304 === undefined || declared.cacheHits304 === hits304,
      `304 计数与证据互证（声明 ${declared.cacheHits304} / 实算 ${hits304}）`,
    );
    check(
      events.length === declared.events || declared.events === undefined,
      `事件总数与证据互证（声明 ${declared.events} / 实算 ${events.length}）`,
    );
    check(
      typeof declared.coreCalls !== 'number' || declared.coreCalls <= declared.coreLimit,
      `core 预算未越限（${declared.coreCalls}/${declared.coreLimit}）`,
    );
    check(
      typeof declared.searchCalls !== 'number' || declared.searchCalls <= declared.searchLimit,
      `search 预算未越限（${declared.searchCalls}/${declared.searchLimit}）`,
    );

    const counted = events.filter((e) => e.response?.countedAgainstBudget === true).length;
    check(counted <= 4000, `计入预算的请求 ${counted} ≤ 4000/时`);
  } else if (eventsArtifact) {
    failures.push(`  ✗ raw_events 产物缺失：${eventsArtifact.path}`);
  }

  // 4) ODS 一仓一记录
  if (snapshotsArtifact && existsSync(snapshotsArtifact.path)) {
    const records = readJsonl(snapshotsArtifact.path);
    const issues = records.flatMap((r) => validateOdsRepoRecord(r));
    check(issues.length === 0, `raw_snapshots 一仓一记录 schema 全过（问题 ${issues.length} 条）`);
    const odsMetrics = evidence.steps.find((s) => s.id === 'ods-output')?.metrics ?? {};
    check(
      odsMetrics.records === undefined || odsMetrics.records === records.length,
      `记录数与证据互证（声明 ${odsMetrics.records} / 实算 ${records.length}）`,
    );
    for (const record of records) {
      if (typeof record.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.digest)) {
        failures.push(`  ✗ ${record.repo?.fullName}：digest 形态非法`);
      }
      if (typeof record.fetchedAt !== 'string' || record.fetchedAt === '') {
        failures.push(`  ✗ ${record.repo?.fullName}：缺 fetchedAt`);
      }
    }
    const assetTotal = records.reduce((sum, r) => sum + (r.assets?.length ?? 0), 0);
    notes.push(`  · 记录 ${records.length} 仓 / 资产 ${assetTotal} 个`);
  } else if (snapshotsArtifact) {
    failures.push(`  ✗ raw_snapshots 产物缺失：${snapshotsArtifact.path}`);
  }

  console.log('\n[3/4] 请求纪律复算：');
  for (const line of notes.filter((l) => !l.startsWith('  · 记录'))) console.log(line);
  console.log('\n[4/4] ODS 产物：');
  for (const line of notes.filter((l) => l.startsWith('  · 记录'))) console.log(line);

  if (failures.length > 0) {
    console.log('\n失败明细：');
    for (const line of failures) console.log(line);
    console.log(`\nexit 1（有产物但断言失败：${failures.length} 条）`);
    process.exit(1);
  }
  console.log('\nexit 0（MK-01 门禁全过：单测 + 请求纪律 + ODS schema + 证据 JSON）');
  process.exit(0);
}

await main();
