#!/usr/bin/env node
/**
 * verify-mk-03 —— MK-03 五维评分（DWS）门禁（issue #32 DoD）。
 *
 * 检查（全部只读上游，产物只写本票证据目录）：
 *   1. 单元测试：services/ingest 全量 vitest（五维信号 / 边界 / 确定性快照 / 词表冻结）；
 *   2. CLI 端到端：`--sample` 跑两遍（三遍取样），DWS JSONL **逐字节一致**（确定性硬判据）；
 *   3. DWS 产物 schema 与自证：逐行校验 + **独立重算**（不信自述：重跑 scoreBatch 比 sha256、
 *      重算总分与维度分互证、扣分码逐条对词表）；
 *   4. 边界口径（规格 §5.4）：冷启动 → 生态热度空心；无 license/NOASSERTION → 安全维满分
 *      （仅 L1 delta 0）；归档仓 → 维护活跃 ≤0.3；超大仓截断 → 文件级缺失信号为 null；
 *   5. 证据 JSON：`df.market.evidence/v1` 结构 + exitCode 语义 + artifacts 逐件 sha256 复算。
 *   可选：`--dwd <文件>` 时追加真实 DWD 产物跑分（MK-02 落地后接）；未提供 → 如实列为待办 note。
 *
 * 退出码（《市场首实现》§6.1，禁止假绿）：
 *   0 = 全过；
 *   1 = 有产物但断言失败（真失败）；
 *   2 = 阻塞：缺依赖（vitest）/ CLI 不可跑 / 无产物。
 *
 * 用法：
 *   node scripts/verify-mk-03.mjs [--dir ~/df-evidence/mk-03] [--out <证据根>] [--dwd <DWD JSONL>] [--skip-tests]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INGEST_DIR = join(ROOT, 'services', 'ingest');
const SCORE_DIR = join(INGEST_DIR, 'src', 'score');

/** 解析参数。 */
function parseArgs(argv) {
  const opts = {
    outDir: join(homedir(), 'df-evidence', 'mk-03'),
    dwd: null,
    skipTests: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      return argv[i] ?? '';
    };
    if (arg === '--out' || arg === '--dir') opts.outDir = resolve(value());
    else if (arg === '--dwd') opts.dwd = resolve(value());
    else if (arg === '--skip-tests') opts.skipTests = true;
    else {
      console.error(
        `未知参数：${arg}\n用法：node scripts/verify-mk-03.mjs [--out <证据根>] [--dwd <DWD JSONL>] [--skip-tests]`,
      );
      process.exit(2);
    }
  }
  return opts;
}

const failures = [];
const notes = [];

/** 记一条断言结果。 */
function check(ok, message) {
  if (ok) notes.push(`  ✓ ${message}`);
  else failures.push(`  ✗ ${message}`);
  return ok;
}

/** sha256 十六进制。 */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 读 JSONL 为数组。 */
function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));
}

/** 跑评分 CLI（返回 status/stdout）。 */
function runCli(args) {
  return spawnSync(process.execPath, [join(SCORE_DIR, 'cli.ts'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('MK-03 门禁（verify-mk-03 · 五维评分 DWS）');
  console.log(`  证据根：${opts.outDir}`);

  // 0) 依赖可用性（阻塞语义而非失败）
  const vitestBin = join(INGEST_DIR, 'node_modules', '.bin', 'vitest');
  if (!opts.skipTests && !existsSync(vitestBin)) {
    console.error(`\n阻塞：缺少 vitest（${vitestBin}）——先 pnpm install。exit 2`);
    process.exit(2);
  }

  // 1) 单元测试
  if (!opts.skipTests) {
    const run = spawnSync(vitestBin, ['run'], { cwd: INGEST_DIR, encoding: 'utf8' });
    const tail = (run.stdout ?? '')
      .split('\n')
      .filter((l) => l.includes('Test Files') || l.includes('Tests '))
      .join(' | ');
    console.log(`\n[1/5] 单元测试：${tail || '(无摘要输出)'}`);
    if (run.status !== 0) {
      console.error('  ✗ services/ingest 单测未过——先修测试再谈门禁。exit 1');
      process.exit(1);
    }
    notes.push('  ✓ 单测全绿');
  } else {
    console.log('\n[1/5] 单元测试：跳过（--skip-tests）');
  }

  // 2) CLI 端到端 × 3（确定性：三次逐字节一致）
  console.log('\n[2/5] CLI 端到端（--sample × 3 取样）');
  const runs = [];
  for (const index of [1, 2, 3]) {
    const runDir = join(opts.outDir, 'runs', `sample-${index}`);
    const run = runCli(['--sample', '--out', runDir]);
    if (run.status !== 0) {
      console.error(`  ✗ CLI 第 ${index} 遍退出码 ${run.status}（期望 0）`);
      console.error(`${(run.stdout ?? '').split('\n').slice(-12).join('\n')}`);
      if (index === 1) {
        console.error('exit 2（阻塞：评分 CLI 不可跑/输入不合契约）');
        process.exit(2);
      }
      failures.push(`  ✗ CLI 第 ${index} 遍退出码非 0`);
      continue;
    }
    const dwsPath = join(runDir, 'dws', 'asset_quality.jsonl');
    if (!existsSync(dwsPath)) {
      console.error(`  ✗ 第 ${index} 遍未产出 DWS JSONL：${dwsPath}`);
      process.exit(2);
    }
    runs.push({ dwsPath, text: readFileSync(dwsPath, 'utf8') });
  }
  const digests = runs.map((r) => sha256(r.text));
  check(
    new Set(digests).size === 1,
    `三次取样 DWS JSONL 逐字节一致（sha256 ${digests[0]?.slice(0, 16)}…）`,
  );
  const dwsText = runs[0]?.text ?? '';
  const records = readJsonl(runs[0]?.dwsPath ?? '');

  // 3) DWS 产物 schema + 独立重算（不信自述）
  console.log('\n[3/5] DWS 产物校验与独立重算');
  const { validateDwsRecord, expectedTotal, dwsJsonl, sha256Hex } = await import(
    join(SCORE_DIR, 'dws.ts')
  );
  const { scoreBatch } = await import(join(SCORE_DIR, 'batch.ts'));
  const { SAMPLE_DWD } = await import(join(SCORE_DIR, '__fixtures__', 'dwd-samples.ts'));
  const { AS_OF } = await import(join(SCORE_DIR, '__fixtures__', 'dwd.ts'));
  const { REASON_TEXT } = await import(join(SCORE_DIR, 'codes.ts'));

  const schemaIssues = records.flatMap((r) =>
    validateDwsRecord(r).map((i) => `${r.assetId}: ${i}`),
  );
  check(
    schemaIssues.length === 0,
    `DWS 逐行校验全过（问题 ${schemaIssues.length} 条：${schemaIssues.slice(0, 2).join(' / ') || '无'}）`,
  );

  // 独立重算：同一输入重跑评分器，与产物 sha256 互证（同上：重算不读产物）。
  const recomputed = `${dwsJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records)}\n`;
  check(
    sha256Hex(recomputed) === sha256(dwsText),
    `产物与重算互证（产物 ${sha256(dwsText).slice(0, 16)}… / 重算 ${sha256Hex(recomputed).slice(0, 16)}…）`,
  );

  const totalIssues = records.filter((r) => expectedTotal(r.dims) !== r.score);
  check(totalIssues.length === 0, `总分 = Σ(权重 × 维度分)（互证不符 ${totalIssues.length} 条）`);

  const twoDecimals = records.every(
    (r) => r.score === null || Math.abs(r.score - Math.round(r.score * 100) / 100) < 1e-9,
  );
  check(twoDecimals, '总分一律两位小数（规格 §5.1）');

  const explainIssues = [];
  for (const r of records) {
    for (const [dim, entry] of Object.entries(r.explain)) {
      if (!Array.isArray(entry.signals) || entry.signals.length === 0)
        explainIssues.push(`${r.assetId}.${dim} 无信号明细`);
      for (const d of entry.deductions) {
        if (!Object.hasOwn(REASON_TEXT, d.code))
          explainIssues.push(`${r.assetId}.${dim} 码 ${d.code} 不在词表`);
        if (d.code === 'L1' && d.delta !== 0)
          explainIssues.push(`${r.assetId}.${dim} L1 delta ${d.delta} ≠ 0`);
      }
    }
  }
  check(
    explainIssues.length === 0,
    `可解释输出齐备（规格 §5.3；问题 ${explainIssues.length} 条：${explainIssues.slice(0, 2).join(' / ') || '无'}）`,
  );

  // 4) 边界口径（规格 §5.4）——输入与产物按 assetId 配对核定
  console.log('\n[4/5] 边界口径（冷启动 / 许可守门 / 归档 / 超大仓）');
  const byId = new Map(records.map((r) => [r.assetId, r]));
  const inputById = new Map(SAMPLE_DWD.map((i) => [i.asset.id, i]));

  const coldIds = [...inputById.values()]
    .filter((i) => i.repo.stars === 0 && i.repo.forks === 0 && (i.trend.referencedBy ?? 0) === 0)
    .map((i) => i.asset.id);
  check(
    coldIds.length > 0 && coldIds.every((id) => byId.get(id)?.dims.ecosystem === null),
    `冷启动（零采纳）→ 生态热度空心（${coldIds.length} 条）`,
  );

  const nonLoadable = [...inputById.values()].filter((i) => i.license.gate !== 'loadable');
  const licenseOk = nonLoadable.every((i) => {
    const r = byId.get(i.asset.id);
    const positive = r?.explain.security.deductions.filter((d) => d.delta > 0) ?? [];
    return r?.dims.security === 1 && positive.length === 0;
  });
  check(
    nonLoadable.length > 0 && licenseOk,
    `无 license/NOASSERTION 不扣安全分（${nonLoadable.length} 条；仅 L1 delta 0）`,
  );

  const archivedOk = [...inputById.values()]
    .filter((i) => i.repo.archived)
    .every((i) => (byId.get(i.asset.id)?.dims.maintenance ?? 0) <= 0.3);
  check(
    [...inputById.values()].filter((i) => i.repo.archived).length === 0 || archivedOk,
    '归档仓维护活跃 ≤0.3（样本中无归档样本时按「无适用」处理）',
  );

  const truncatedIds = [...inputById.values()]
    .filter((i) => i.files.truncated)
    .map((i) => i.asset.id);
  const truncatedOk = truncatedIds.every((id) => {
    const explain = byId.get(id)?.explain;
    if (explain === undefined) return false;
    const aux = explain.spec.signals.find((s) => s.code === 'spec.aux-dirs');
    const ci = explain.maintenance.signals.find((s) => s.code === 'maintenance.ci');
    const preview = explain.docs.signals.find((s) => s.code === 'docs.preview');
    return aux?.score === null && ci?.score === null && preview?.score === null;
  });
  check(
    truncatedIds.length > 0 && truncatedOk,
    `超大仓截断 → 文件级缺失信号为 null（${truncatedIds.length} 条）`,
  );

  // 4.5) 可选：真实 DWD 产物（MK-02 落地后接）
  if (opts.dwd !== null) {
    console.log(`\n[4.5/5] 真实 DWD 产物：${opts.dwd}`);
    const realDir = join(opts.outDir, 'runs', 'real-dwd');
    const run = runCli(['--dwd', opts.dwd, '--as-of', AS_OF, '--out', realDir]);
    check(run.status === 0, `真实 DWD 跑分退出码 = 0（实际 ${run.status}）`);
    if (run.status !== 0) console.log(`${(run.stdout ?? '').split('\n').slice(-10).join('\n')}`);
  } else {
    notes.push(
      '  · 真实 DWD 未提供（--dwd）——MK-02 落地后接入；当前以固定样本集为准（如实列待办）',
    );
  }

  // 5) 证据 JSON 结构与 artifacts 复算
  console.log('\n[5/5] 证据 JSON（df.market.evidence/v1）');
  const evidencePath = join(opts.outDir, 'runs', 'sample-1', 'evidence', 'score-20261015.json');
  if (!existsSync(evidencePath)) {
    console.error(`阻塞：未发现评分证据 JSON（${evidencePath}）。exit 2`);
    process.exit(2);
  }
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  check(
    evidence.schema === 'df.market.evidence/v1',
    `schema = df.market.evidence/v1（实际 ${evidence.schema}）`,
  );
  check([0, 1, 2].includes(evidence.exitCode), `exitCode ∈ {0,1,2}（实际 ${evidence.exitCode}）`);
  check(evidence.exitCode === 0, `评分 CLI 自身 exitCode = 0（实际 ${evidence.exitCode}）`);
  const stepIds = (evidence.steps ?? []).map((s) => s.id);
  for (const id of [
    'dwd-input',
    'dws-scoring',
    'explain-completeness',
    'boundaries',
    'determinism',
    'dws-output',
  ]) {
    check(stepIds.includes(id), `判据步骤齐备：${id}`);
  }
  check(
    evidence.steps.every((s) => s.verdict !== 'fail' && s.assertions.every((a) => a.ok)),
    '证据内断言全过',
  );
  const artifacts = evidence.steps.flatMap((s) => s.artifacts ?? []);
  check(artifacts.length >= 1, `证据引用产物（${artifacts.length} 件）`);
  for (const artifact of artifacts) {
    const exists = existsSync(artifact.path);
    check(exists, `产物存在：${artifact.path}`);
    if (!exists) continue;
    const payload = readFileSync(artifact.path, 'utf8');
    check(
      sha256(payload) === artifact.sha256 && Buffer.byteLength(payload, 'utf8') === artifact.length,
      `产物 sha256/length 复算一致：${artifact.path.split('/').slice(-2).join('/')}`,
    );
  }

  // —— 自产门禁证据（本次门禁本身的证据 JSON，写本票证据根）——
  const gateRunId = `verify-mk-03-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const gateEvidence = {
    schema: 'df.market.evidence/v1',
    runId: gateRunId,
    asOf: AS_OF,
    offline: true,
    collector: { name: 'df-market-score-verify', version: '0.1.0' },
    steps: [
      {
        id: 'unit-tests',
        name: 'services/ingest 单测',
        verdict: failures.length === 0 ? 'pass' : 'fail',
        assertions: [],
        artifacts: [],
        metrics: { skipped: opts.skipTests },
      },
      {
        id: 'dws-determinism-and-boundaries',
        name: 'DWS 确定性 / 产物自证 / 边界口径',
        verdict: failures.length === 0 ? 'pass' : 'fail',
        assertions: [],
        artifacts: [
          {
            path: runs[0]?.dwsPath ?? '',
            sha256: sha256(dwsText),
            length: Buffer.byteLength(dwsText, 'utf8'),
          },
        ],
        metrics: {
          records: records.length,
          digest: sha256(dwsText),
          samples: runs.length,
          failures: failures.length,
        },
      },
      {
        id: 'score-evidence',
        name: '评分证据 JSON',
        verdict: 'pass',
        assertions: [],
        artifacts: [
          {
            path: evidencePath,
            sha256: sha256(readFileSync(evidencePath, 'utf8')),
            length: Buffer.byteLength(readFileSync(evidencePath, 'utf8'), 'utf8'),
          },
        ],
        metrics: { exitCode: evidence.exitCode },
      },
    ],
    exitCode: failures.length === 0 ? 0 : 1,
  };
  const gateDir = join(opts.outDir, 'evidence');
  mkdirSync(gateDir, { recursive: true });
  const gatePath = join(gateDir, `${gateRunId}.json`);
  writeFileSync(gatePath, `${JSON.stringify(gateEvidence, null, 2)}\n`, 'utf8');

  console.log('\n摘要：');
  for (const line of notes) console.log(line);
  console.log(`\n  门禁证据：${gatePath}`);

  if (failures.length > 0) {
    console.log('\n失败明细：');
    for (const line of failures) console.log(line);
    console.log(`\nexit 1（有产物但断言失败：${failures.length} 条）`);
    process.exit(1);
  }
  console.log('\nexit 0（MK-03 门禁全过：单测 + 确定性 ×3 + 产物自证 + 边界口径 + 证据 JSON）');
  process.exit(0);
}

await main();
