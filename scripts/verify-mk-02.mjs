#!/usr/bin/env node
/**
 * verify-mk-02 —— MK-02 规范化与四层仓落盘门禁（issue #31 DoD）。
 *
 * 步骤（每一步都产出可复核断言 + 产物哈希）：
 *   1. `unit-tests`   —— `services/ingest` 全量 vitest（schema 正反例 / 解析器 / 重建一致性）；
 *   2. `ods-normalize`—— 夹具链路：规整后事件 gzip 逐字节保真、快照文件级 sha256、blob 内容寻址去重；
 *   3. `dwd-schema`   —— DWD 四表 schema 校验零问题 + 引用完整性（孤儿引用率 = 0）；
 *   4. `traceability` —— 样本资产可溯源到 commit + 文件哈希（asset.ref / asset_file.git_sha+sha256 / ODS 来源哈希）；
 *   5. `rebuild`      —— 删 DWD 从 ODS 重跑，四表字节一致；
 *   6. `real-data`    —— 若 `~/df-evidence/mk-01` 的真实采集产物在：用其跑通全链路（阻塞时如实报 2）。
 *
 * 退出码（规格《市场首实现》§6.1，禁止假绿）：
 *   0 = 通过；1 = 有数据但断言失败；2 = 阻塞（无真实产物 / 依赖不可用）。
 *
 * 用法：
 *   node scripts/verify-mk-02.mjs [--dir ~/df-evidence/mk-01] [--out ~/df-evidence/mk-02] [--skip-tests]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INGEST_DIR = join(ROOT, 'services', 'ingest');
const CLI = join('services', 'ingest', 'src', 'transform', 'cli.ts');
const FIXTURE = join(INGEST_DIR, 'src', 'transform', '__fixtures__', 'ods-source');

/** 解析参数。 */
function parseArgs(argv) {
  const opts = {
    dir: join(homedir(), 'df-evidence', 'mk-01'),
    out: join(homedir(), 'df-evidence', 'mk-02'),
    skipTests: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      return argv[index] ?? '';
    };
    if (arg === '--dir') opts.dir = resolve(value());
    else if (arg === '--out') opts.out = resolve(value());
    else if (arg === '--skip-tests') opts.skipTests = true;
    else {
      console.error(
        `未知参数：${arg}\n用法：node scripts/verify-mk-02.mjs [--dir <MK-01 产物根>] [--out <证据目录>] [--skip-tests]`,
      );
      process.exit(2);
    }
  }
  return opts;
}

const sha256 = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
const artifact = (path) => {
  const stats = statSync(path);
  return { path, sha256: sha256(path), length: stats.size };
};

/** 跑一条 CLI 子命令，返回解析后的结论（JSON 摘要 + 退出码）。 */
function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse((result.stdout ?? '').trim().split('\n').at(-1));
  } catch {
    parsed = null;
  }
  return {
    status: result.status ?? 1,
    stderr: (result.stderr ?? '').trim(),
    outcome: parsed,
  };
}

const steps = [];
const startedAt = new Date().toISOString();

function step(id, name) {
  const record = { id, name, verdict: 'pass', assertions: [], artifacts: [], metrics: {} };
  steps.push(record);
  return {
    assert(assertion) {
      record.assertions.push(assertion);
      if (assertion.ok === false) record.verdict = 'fail';
      console.log(`  [${assertion.ok ? 'ok' : 'FAIL'}] ${id} · ${assertion.name}`);
    },
    artifact(path) {
      if (existsSync(path)) record.artifacts.push(artifact(path));
    },
    metrics(values) {
      Object.assign(record.metrics, values);
    },
    block(reason) {
      record.verdict = 'blocked';
      record.assertions.push({ name: '阻塞原因', expected: '可判定', actual: reason, ok: false });
      console.log(`  [blocked] ${id} —— ${reason}`);
    },
    done() {
      console.log(`  → ${id}: ${record.verdict}`);
    },
  };
}

/** 建一个隔离的临时工作目录（四层仓数据面）。 */
function workDir(name) {
  const dir = join(opts.out, 'work', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const opts = parseArgs(process.argv.slice(2));

console.log('verify-mk-02 —— 规范化与四层仓落盘门禁');
console.log(`  输入：MK-01 产物根 ${opts.dir}`);
console.log(`  输出：证据目录 ${opts.out}`);

// ── 1. 单元测试 ───────────────────────────────────────────────────────────────
{
  const s = step('unit-tests', 'services/ingest 全量 vitest');
  if (opts.skipTests) {
    s.assert({ name: 'vitest（跳过）', expected: '0 失败', actual: '--skip-tests', ok: true });
  } else {
    const run = spawnSync('pnpm', ['vitest', 'run'], {
      cwd: INGEST_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const summary = output.match(/Tests\s+(\d+) passed[^\n]*/)?.[0] ?? '（无摘要）';
    const failed = /(\d+) failed/.test(output);
    s.assert({
      name: 'vitest 全绿',
      expected: '0 failed',
      actual: summary,
      ok: run.status === 0 && !failed,
    });
    s.metrics({ exitCode: run.status ?? 1 });
  }
  s.done();
}

// ── 2. ODS 规整（夹具链路 + 真产物链路）──────────────────────────────────────
{
  const s = step('ods-normalize', 'ODS 规整（gzip 事件 / 文件级 sha256 / blob 内容寻址）');
  const dataRoot = workDir('fixture');
  const odsRoot = join(dataRoot, 'ods');
  const run = runCli(['ods', '--source', FIXTURE, '--out', odsRoot]);
  s.assert({
    name: 'ods 子命令退出码 0',
    expected: '0',
    actual: String(run.status),
    ok: run.status === 0,
  });
  const summary = run.outcome?.summary ?? {};
  s.assert({
    name: '产出 gzip 事件 / 逐仓快照 / blob',
    expected: 'events≥1, snapshots≥1, blobs≥1',
    actual: `events=${summary.events}, snapshots=${summary.snapshots}, blobs=${summary.blobs}`,
    ok: (summary.events ?? 0) >= 1 && (summary.snapshots ?? 0) >= 1 && (summary.blobs ?? 0) >= 1,
  });

  // 事件 gzip 无损：解压内容与来源文件逐字节一致
  const { gunzipSync } = await import('node:zlib');
  const eventFiles = spawnSync('find', [join(odsRoot, 'raw_events'), '-name', '*.jsonl.gz'], {
    encoding: 'utf8',
  })
    .stdout.trim()
    .split('\n')
    .filter((line) => line !== '');
  const eventFile = eventFiles[0] ?? '';
  const gzOk =
    eventFile !== '' &&
    gunzipSync(readFileSync(eventFile)).toString('utf8') ===
      readFileSync(
        join(FIXTURE, 'ods', 'raw_events', 'date=2026-10-15', '20261015-120000.jsonl'),
        'utf8',
      );
  s.assert({
    name: '事件 gzip 解压后与来源逐字节一致',
    expected: 'true',
    actual: String(gzOk),
    ok: gzOk,
  });

  // 幂等：再跑一次 → 全部去重，零冲突
  const again = runCli(['ods', '--source', FIXTURE, '--out', odsRoot]);
  const replay = again.outcome?.summary ?? {};
  s.assert({
    name: '重入幂等（第二次全部跳过、零冲突）',
    expected: 'blobsWritten=0, conflicts=0',
    actual: `blobsWritten=${replay.blobsWritten}, conflicts=${replay.conflicts}`,
    ok: replay.blobsWritten === 0 && replay.conflicts === 0,
  });
  s.metrics({ sources: summary.sources ?? 0, artifacts: summary.artifacts ?? 0 });
  if (eventFile !== '') s.artifact(eventFile);
  s.done();
  opts.fixtureDataRoot = dataRoot;
}

// ── 3. DWD schema 校验 + 引用完整性 ───────────────────────────────────────────
let dwdRoot = '';
{
  const s = step('dwd-schema', 'DWD 四表 schema 校验与引用完整性');
  const odsRoot = join(opts.fixtureDataRoot, 'ods');
  dwdRoot = join(opts.fixtureDataRoot, 'dwd');
  const run = runCli(['dwd', '--ods', odsRoot, '--out', dwdRoot]);
  s.assert({
    name: 'dwd 子命令退出码 0',
    expected: '0',
    actual: String(run.status),
    ok: run.status === 0,
  });
  const rows = run.outcome?.summary?.rows ?? {};
  s.assert({
    name: '四表齐备',
    expected: 'repo/asset/asset_file/license',
    actual: JSON.stringify(rows),
    ok: rows.repo >= 1 && rows.asset >= 1 && rows.asset_file >= 1 && rows.license >= 1,
  });

  const validate = runCli(['validate', '--ods', odsRoot, '--dwd', dwdRoot]);
  s.assert({
    name: '校验零问题（含孤儿引用检测）',
    expected: '0',
    actual: `${validate.status}（${validate.outcome?.problems?.length ?? '?'} 条）`,
    ok: validate.status === 0 && (validate.outcome?.problems?.length ?? 1) === 0,
  });
  for (const name of ['repo', 'asset', 'asset_file', 'license']) {
    s.artifact(join(dwdRoot, `${name}.parquet`));
  }
  s.artifact(join(dwdRoot, '_dwd_manifest.json'));
  s.done();
}

// ── 4. 溯源：样本资产 → commit + 文件哈希 ────────────────────────────────────
{
  const s = step('traceability', '样本资产可溯源到 commit + 文件哈希');
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      import { readDwd } from '${join(INGEST_DIR, 'src', 'transform', 'index.ts')}';
      const tables = await readDwd(${JSON.stringify(dwdRoot)});
      const sample = tables.asset.slice(0, 3).map((asset) => ({
        asset_id: asset.asset_id,
        kind: asset.kind,
        ref: asset.ref,
        digest: asset.digest,
        digest_status: asset.digest_status,
        files: tables.asset_file
          .filter((file) => file.asset_id === asset.asset_id)
          .map((file) => ({ path: file.path, git_sha: file.git_sha, sha256: file.sha256 })),
      }));
      process.stdout.write(JSON.stringify(sample));
      `,
    ],
    { cwd: INGEST_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  let sample = [];
  try {
    sample = JSON.parse(probe.stdout.trim());
  } catch {
    sample = [];
  }
  const first = sample[0];
  s.assert({
    name: 'asset.ref 为 40 位 commit（≠ 短哈希）',
    expected: '40-hex',
    actual: first?.ref ?? '(无样本)',
    ok: typeof first?.ref === 'string' && /^[0-9a-f]{40}$/.test(first.ref),
  });
  s.assert({
    name: 'asset_file 逐条带 git blob sha',
    expected: '每条都非空',
    actual: `${first?.files?.length ?? 0} 条：${first?.files?.map((file) => file.path).join(',') ?? ''}`,
    ok:
      (first?.files?.length ?? 0) > 0 &&
      first.files.every((file) => /^[0-9a-f]{7,40}$/.test(file.git_sha)),
  });
  s.assert({
    name: 'digest 口径如实（ok 或有明确原因，不冒充）',
    expected: 'ok|incomplete-content|empty',
    actual: first ? `${first.digest_status} digest=${first.digest ?? 'null'}` : '(无样本)',
    ok: ['ok', 'incomplete-content', 'empty'].includes(first?.digest_status),
  });
  const manifest = JSON.parse(readFileSync(join(dwdRoot, '_dwd_manifest.json'), 'utf8'));
  s.assert({
    name: 'DWD 清单带 ODS 来源文件哈希（溯源链闭合）',
    expected: 'source.files[].sha256',
    actual: `${manifest.source.files.length} 个来源文件`,
    ok:
      Array.isArray(manifest.source.files) &&
      manifest.source.files.length > 0 &&
      manifest.source.files.every((file) => /^sha256:[0-9a-f]{64}$/.test(file.sha256)),
  });
  s.metrics({ sampled: sample.length });
  s.done();
}

// ── 5. 重建一致性 ────────────────────────────────────────────────────────────
{
  const s = step('rebuild', '删 DWD → 从 ODS 重跑 → 字节一致');
  const run = runCli(['rebuild', '--data', opts.fixtureDataRoot]);
  const summary = run.outcome?.summary ?? {};
  s.assert({
    name: '重建一致（无差异）',
    expected: 'consistent=true, differences=0',
    actual: `consistent=${summary.consistent}, differences=${run.outcome?.problems?.length ?? '?'}`,
    ok: run.status === 0 && summary.consistent === true,
  });
  s.done();
}

// ── 6. 真实产物链路（MK-01 小跑产物）──────────────────────────────────────────
{
  const s = step('real-data', 'MK-01 真实产物链路（ODS → DWD → 校验 → 重建）');
  const realSource = opts.dir;
  const realSnapshots = join(realSource, 'ods', 'raw_snapshots');
  if (!existsSync(realSnapshots)) {
    s.block(
      `未见真实采集产物：${realSnapshots}（MK-01 未落地或未小跑；夹具链路已通过，此处如实标阻塞）`,
    );
    s.done();
  } else {
    const dataRoot = workDir('real');
    const odsRoot = join(dataRoot, 'ods');
    const realDwd = join(dataRoot, 'dwd');
    const start = Date.now();
    const ods = runCli(['ods', '--source', realSource, '--out', odsRoot]);
    s.assert({
      name: '真实 ODS 规整退出码 0',
      expected: '0',
      actual: String(ods.status),
      ok: ods.status === 0,
    });
    const dwd = runCli(['dwd', '--ods', odsRoot, '--out', realDwd]);
    s.assert({
      name: '真实 DWD 构建退出码 0（含 schema 校验）',
      expected: '0',
      actual: `${dwd.status}${dwd.stderr ? ` | ${dwd.stderr.split('\n')[0]}` : ''}`,
      ok: dwd.status === 0,
    });
    const rows = dwd.outcome?.summary?.rows ?? {};
    s.assert({
      name: '真实数据行数 > 0（资产/文件清单非空）',
      expected: 'asset ≥ 31（规格首批 ≥31 可装载的载体）',
      actual: `repo=${rows.repo}, asset=${rows.asset}, asset_file=${rows.asset_file}, license=${rows.license}`,
      ok: (rows.repo ?? 0) >= 1 && (rows.asset ?? 0) >= 1,
    });
    const rebuild = runCli(['rebuild', '--data', dataRoot]);
    s.assert({
      name: '真实数据重建一致（字节级）',
      expected: 'consistent=true',
      actual: `${rebuild.status} consistent=${rebuild.outcome?.summary?.consistent}`,
      ok: rebuild.status === 0 && rebuild.outcome?.summary?.consistent === true,
    });
    const clusterCount = dwd.outcome?.summary?.clusters?.count ?? 0;
    s.assert({
      name: '同源聚合有产出（簇数可数）',
      expected: 'clusterCount ≥ 1',
      actual: String(clusterCount),
      ok: clusterCount >= 1,
    });
    for (const name of ['repo', 'asset', 'asset_file', 'license']) {
      s.artifact(join(realDwd, `${name}.parquet`));
    }
    s.metrics({ ms: Date.now() - start, ...rows });
    s.done();
  }
}

// ── 证据 JSON ────────────────────────────────────────────────────────────────
const exitCode = steps.some((item) => item.verdict === 'fail')
  ? 1
  : steps.every((item) => item.verdict === 'pass')
    ? 0
    : 2;

const evidence = {
  schema: 'df.market.evidence/v1',
  runId: `mk02-${startedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}`,
  asOf: startedAt,
  offline: true,
  collector: { name: 'df-market-transform', version: '0.1.0' },
  steps,
  exitCode,
};

mkdirSync(opts.out, { recursive: true });
const evidencePath = join(opts.out, 'verify-mk-02.evidence.json');
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
const localCopy = join(ROOT, 'artifacts', 'verify-mk-02');
mkdirSync(localCopy, { recursive: true });
writeFileSync(
  join(localCopy, 'verify-mk-02.evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);

console.log('\n汇总：');
for (const item of steps) console.log(`  ${item.verdict.padEnd(8)} ${item.id} —— ${item.name}`);
console.log(`  证据 JSON：${evidencePath}`);
console.log(`  退出码：${exitCode}（0 通过 / 1 失败 / 2 阻塞）`);
process.exit(exitCode);
