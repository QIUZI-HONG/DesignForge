#!/usr/bin/env node
/**
 * verify-mk-04 —— MK-04 门禁：ADS 索引产出 → schema 校验 → 检索命中/排序 → P95 基线（issue #33 DoD）。
 *
 * 判据链（《市场首实现》§4 第 4/5 环；脚本为其中两环的可机器判定版）：
 *   4. index 产出（schema 校验）：`df.marketplace.index/v1` 通过校验器（必填/枚举/digest 格式/
 *      counts 自洽）；`blocked` 资产不出现；**校验器有辨别力**（变异样本必须被拦下，防橡皮章）。
 *   5. 检索可命中：示例查询集 ≥10 条逐条执行；每条 ≥1 结果、≥5 条查询 ≥3 结果；
 *      排序 = 质量分 × 相关度（可解释）；P95 基线记录入库（首版不设硬门槛）。
 *
 * 数据源：默认 MK-04 自造 DWS 夹具（`services/ingest/src/index/__fixtures__/dws-assets.sample.json`，
 * 含质量分与原因码——MK-03 落地前按简报口径先跑通）；`--dws <file>` 可指向真实 DWS 产物。
 *
 * 退出码（《市场首实现》§6.1，禁止假绿）：`0 = 判据成立`；`1 = 断言失败（真失败）`；
 * `2 = 阻塞`（夹具缺失 / 模块不可导入 / 测试不可运行）。
 * 证据落仓库外：`~/df-evidence/mk-04/verify-mk-04.evidence.json`（同副本落 `artifacts/`，已 gitignore）。
 *
 * 用法：node scripts/verify-mk-04.mjs [--dws <file>] [--skip-tests] [--out <dir>]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INGEST_DIR = join(REPO_ROOT, 'services', 'ingest');
const DEFAULT_DWS = join(INGEST_DIR, 'src', 'index', '__fixtures__', 'dws-assets.sample.json');
const DEFAULT_OUT = join(homedir(), 'df-evidence', 'mk-04');
const ARTIFACTS_DIR = join(REPO_ROOT, 'artifacts', 'verify-mk-04');

/** P95 基线采样：每条查询重复次数（首版只记基线，不设硬门槛，采样要够定 p95）。 */
const LATENCY_ROUNDS = 20;

function parseArgs(argv) {
  const opts = { dws: DEFAULT_DWS, out: DEFAULT_OUT, skipTests: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      return argv[i] ?? '';
    };
    if (arg === '--dws') opts.dws = resolve(value());
    else if (arg === '--out') opts.out = resolve(value());
    else if (arg === '--skip-tests') opts.skipTests = true;
    else {
      console.error(
        `未知参数：${arg}\n用法：node scripts/verify-mk-04.mjs [--dws <file>] [--out <dir>] [--skip-tests]`,
      );
      process.exit(2);
    }
  }
  return opts;
}

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** 步骤工厂（证据字段：id/name/verdict/assertions/artifacts/metrics，§6.2）。 */
function createStep(id, name) {
  return { id, name, verdict: 'pass', assertions: [], artifacts: [], metrics: {} };
}

/** 记录一条断言（ok 由调用方给出，避免「重算一遍」的自我确认）。 */
function track(step, name, expected, actual, ok) {
  step.assertions.push({ name, expected: String(expected), actual: String(actual), ok });
  if (!ok) step.verdict = 'fail';
}

const steps = [];

function sha256Of(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

async function writeArtifact(dir, filename, text) {
  const path = join(dir, filename);
  await mkdir(dir, { recursive: true });
  await writeFile(path, text, 'utf8');
  return { path, sha256: sha256Of(text), length: Buffer.byteLength(text) };
}

/** 读取 DWS 输入（默认夹具；`--dws` 可覆盖为真实产物）。 */
function readDwsInput(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return raw;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 每次运行重置本地产物目录（避免上一轮残留冒充本轮证据）
  await rm(ARTIFACTS_DIR, { recursive: true, force: true });
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  const adsDir = join(opts.out, 'ads');
  const snapshotDir = join(opts.out, 'snapshots');

  // ── 步骤 0：单元测试（包内 vitest 全量）─────────────────────────────
  if (!opts.skipTests) {
    const testStep = createStep('unit-tests', '包内单元测试（vitest）');
    steps.push(testStep);
    const vitestBin = join(INGEST_DIR, 'node_modules', '.bin', 'vitest');
    if (!existsSync(vitestBin)) {
      throw new BlockedError(`vitest 不可用（${vitestBin} 不存在）——先 pnpm install`);
    }
    const run = spawnSync(vitestBin, ['run', '--reporter=dot'], {
      cwd: INGEST_DIR,
      encoding: 'utf8',
    });
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ');
    track(testStep, 'vitest 退出码', 0, run.status, run.status === 0);
    testStep.metrics.outputTail = tail;
  }

  // ── 依赖导入（阻塞条件：模块/夹具不可用）────────────────────────────
  let pipelineModule;
  let searchModule;
  let dwsModule;
  let schemaModule;
  try {
    pipelineModule = await import(join(INGEST_DIR, 'src', 'index', 'pipeline.ts'));
    searchModule = await import(join(INGEST_DIR, 'src', 'index', 'search.ts'));
    dwsModule = await import(join(INGEST_DIR, 'src', 'index', 'dws.ts'));
    schemaModule = await import(join(INGEST_DIR, 'src', 'index', 'schema.ts'));
  } catch (error) {
    throw new BlockedError(`MK-04 模块不可导入：${String(error)}`);
  }
  const { EXAMPLE_QUERIES } = await import(join(INGEST_DIR, 'src', 'index', 'query-set.ts'));

  if (!existsSync(opts.dws)) {
    throw new BlockedError(`DWS 输入不存在：${opts.dws}（自带夹具或 --dws 指定真实产物）`);
  }

  // ── 步骤 1：索引产出（DWS → df.marketplace.index/v1 + 倒排）────────
  const buildStep = createStep('index-build', '索引产出（ADS）');
  steps.push(buildStep);
  const dwsRaw = readDwsInput(opts.dws);
  const read = dwsModule.readDwsSample(dwsRaw);
  const generatedAt = typeof dwsRaw?.asOf === 'string' ? dwsRaw.asOf : startedAt.toISOString();
  const collector = {
    name: 'df-market',
    version: '0.1.0',
    runId,
    odsWatermark: typeof dwsRaw?.asOf === 'string' ? dwsRaw.asOf : generatedAt,
  };
  const artifacts = pipelineModule.buildAdsArtifacts(read.assets, { generatedAt, collector });

  track(buildStep, 'DWS 坏行计数（应为 0）', 0, read.skipped, read.skipped === 0);
  track(
    buildStep,
    '入库资产数（语义：夹具 18 行 - 2 条 blocked）',
    read.assets.length - 2,
    artifacts.index.assets.length,
    artifacts.index.assets.length === read.assets.length - 2,
  );
  const blockedIds = read.assets
    .filter(
      (record) =>
        record.source.brandDerived ||
        record.yanked != null ||
        record.source.license.gate === 'blocked',
    )
    .map((record) => record.id);
  const leaked = blockedIds.filter((id) => artifacts.index.assets.some((asset) => asset.id === id));
  track(
    buildStep,
    'blocked 资产不出现（brandDerived/yank/license）',
    0,
    leaked.length,
    leaked.length === 0,
  );
  track(
    buildStep,
    'counts 自洽（total = Σ byKind = assets.length）',
    artifacts.index.assets.length,
    artifacts.index.counts.total,
    artifacts.index.counts.total === artifacts.index.assets.length &&
      artifacts.index.counts.byKind.skill +
        artifacts.index.counts.byKind.plugin +
        artifacts.index.counts.byKind['design-system'] +
        artifacts.index.counts.byKind.template ===
        artifacts.index.counts.total,
  );
  track(
    buildStep,
    'embeddingRef 恒 null（向量检索圈外）',
    'true',
    artifacts.index.assets.every((asset) => asset.embeddingRef === null),
    artifacts.index.assets.every((asset) => asset.embeddingRef === null),
  );

  // 确定性：同输入二次构建逐字节一致（§4.3）
  const again = pipelineModule.buildAdsArtifacts(read.assets, { generatedAt, collector });
  const deterministic =
    JSON.stringify(again.index) === JSON.stringify(artifacts.index) &&
    JSON.stringify(again.searchIndex) === JSON.stringify(artifacts.searchIndex);
  track(buildStep, '幂等：同输入两次构建逐字节一致（§4.3）', 'true', deterministic, deterministic);

  const written = {};
  if (artifacts.validation.ok) {
    const indexText = `${JSON.stringify(artifacts.index, null, 2)}\n`;
    const searchText = `${JSON.stringify(artifacts.searchIndex, null, 2)}\n`;
    written.index = await writeArtifact(adsDir, pipelineModule.ADS_INDEX_FILENAME, indexText);
    written.search = await writeArtifact(
      adsDir,
      pipelineModule.ADS_SEARCH_INDEX_FILENAME,
      searchText,
    );
    buildStep.artifacts.push(written.index, written.search);
  }
  buildStep.metrics.records = read.assets.length;
  buildStep.metrics.assets = artifacts.index.assets.length;
  buildStep.metrics.loadable = artifacts.index.counts.loadable;
  buildStep.metrics.byKind = artifacts.index.counts.byKind;

  // ── 步骤 2：schema 校验（判据链第 4 环）─────────────────────────────
  const schemaStep = createStep('index-schema', 'index schema 校验');
  steps.push(schemaStep);
  const validation = schemaModule.validateMarketplaceIndex(artifacts.index);
  track(schemaStep, '严格模式 error 数', 0, validation.errors.length, validation.ok);
  track(
    schemaStep,
    '警告清单（如实记录，不拦截）',
    '记录',
    validation.warnings.map((w) => `${w.path}:${w.code}`).join(',') || '(无)',
    true,
  );

  // 辨别力（反例）：三种变异必须被拦下——校验器不能是橡皮章
  const mutations = [
    [
      'digest 格式',
      (idx) => {
        idx.assets[0].digest = 'sha1:bad';
      },
    ],
    [
      'counts 不自洽',
      (idx) => {
        idx.counts.total += 1;
      },
    ],
    [
      'blocked 混入',
      (idx) => {
        const clone = JSON.parse(JSON.stringify(idx.assets[0]));
        clone.id = `${clone.id}-x`;
        clone.installGate.mode = 'blocked';
        clone.installGate.licenseGate = 'blocked';
        idx.assets.push(clone);
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const copy = JSON.parse(JSON.stringify(artifacts.index));
    mutate(copy);
    const result = schemaModule.validateMarketplaceIndex(copy);
    track(
      schemaStep,
      `变异样本必须被拦下：${label}`,
      'ok=false',
      `ok=${result.ok}`,
      result.ok === false,
    );
  }
  const lenient = schemaModule.validateMarketplaceIndex(
    (() => {
      const copy = JSON.parse(JSON.stringify(artifacts.index));
      copy.assets[0].facets.category = '未来品类';
      return copy;
    })(),
    { mode: 'forward-compatible' },
  );
  track(
    schemaStep,
    '前向兼容：未知枚举在宽松模式不报错（§1.5.2）',
    'ok=true',
    `ok=${lenient.ok}`,
    lenient.ok === true,
  );
  schemaStep.metrics.warnings = validation.warnings.length;
  if (!validation.ok) {
    // 有数据但产物无效 = 真失败（exit 1）；检索步骤对无效索引无意义，不再继续
    throw new FailedError(
      `索引未通过 schema 校验（${validation.errors.length} 条 error）——检索步骤无意义`,
    );
  }

  // ── 步骤 3：检索可命中（判据链第 5 环）─────────────────────────────
  const hitStep = createStep('search-hit', '检索命中（示例查询集）');
  steps.push(hitStep);
  // 从**落盘产物**回读再检索（证明产物本身可用，而非内存态自证）
  const indexFromDisk = JSON.parse(readFileSync(written.index.path, 'utf8'));
  const searchIndexFromDisk = JSON.parse(readFileSync(written.search.path, 'utf8'));
  const cardsById = new Map(indexFromDisk.assets.map((asset) => [asset.id, asset]));

  const queryRuns = [];
  const rankSnapshot = {};
  for (const example of EXAMPLE_QUERIES) {
    const response = searchModule.searchMarketIndex(searchIndexFromDisk, example.q, { limit: 10 });
    const ids = response.hits.map((hit) => hit.id);
    queryRuns.push({ example, ids, total: response.total, terms: response.terms });
    rankSnapshot[example.id] = {
      q: example.q,
      terms: response.terms,
      total: response.total,
      top: ids,
    };
  }

  track(hitStep, '查询集条数（≥10）', '>=10', EXAMPLE_QUERIES.length, EXAMPLE_QUERIES.length >= 10);
  const zeroHit = queryRuns.filter((run) => run.total < 1).map((run) => run.example.id);
  track(
    hitStep,
    '每条查询 ≥1 结果',
    '0 条空命中',
    zeroHit.length === 0 ? '0 条空命中' : zeroHit.join(','),
    zeroHit.length === 0,
  );
  const rich = queryRuns.filter((run) => run.total >= 3).map((run) => run.example.id);
  track(hitStep, '≥3 结果的查询数（≥5 条）', '>=5', rich.length, rich.length >= 5);

  const missingMust = [];
  for (const run of queryRuns) {
    for (const required of run.example.mustInclude ?? []) {
      if (!run.ids.includes(required)) missingMust.push(`${run.example.id}→${required}`);
    }
  }
  track(
    hitStep,
    'mustInclude 逐条满足（人写期望，非实现回推）',
    '0 缺失',
    missingMust.length,
    missingMust.length === 0,
  );

  const badTop = queryRuns.filter(
    (run) => run.example.topWithin !== undefined && !run.example.topWithin.includes(run.ids[0]),
  );
  track(hitStep, 'Top-1 落在期望集合内（topWithin）', '0 违规', badTop.length, badTop.length === 0);

  // 命中为什么：Top-1 的 matchedTerms 必须非空（可解释）
  const unexplained = queryRuns.filter((run) => {
    const response = searchModule.searchMarketIndex(searchIndexFromDisk, run.example.q, {
      limit: 1,
    });
    const hit = response.hits[0];
    return hit === undefined || hit.matchedTerms.length === 0 || !cardsById.has(hit.id);
  });
  track(
    hitStep,
    'Top-1 命中可解释（matchedTerms 非空且可回填卡片）',
    '0 违规',
    unexplained.length,
    unexplained.length === 0,
  );

  const hitArtifact = await writeArtifact(
    snapshotDir,
    'query-set-results.v1.json',
    `${JSON.stringify({ schema: 'df.mk04.query-results/v1', generatedAt, queries: rankSnapshot }, null, 2)}\n`,
  );
  hitStep.artifacts.push(hitArtifact);
  hitStep.metrics.queries = queryRuns.length;
  hitStep.metrics.queriesWith3Plus = rich.length;
  hitStep.metrics.hitsPerQuery = Object.fromEntries(
    queryRuns.map((run) => [run.example.id, run.total]),
  );

  // ── 步骤 4：排序 = 质量分 × 相关度（可解释）────────────────────────
  const rankStep = createStep('search-ranking', '排序键（质量分 × 相关度）');
  steps.push(rankStep);
  let sortViolations = 0;
  let formulaViolations = 0;
  let qualityOverride = 0;
  for (const example of EXAMPLE_QUERIES) {
    const response = searchModule.searchMarketIndex(searchIndexFromDisk, example.q, { limit: 50 });
    for (let i = 1; i < response.hits.length; i += 1) {
      if (response.hits[i - 1].score < response.hits[i].score) sortViolations += 1;
    }
    for (const hit of response.hits) {
      if (Math.abs(hit.score - hit.quality * hit.relevance) > 1e-6) formulaViolations += 1;
    }
    // 相关度并非恒为 1：乘法在起作用（存在非满分相关度的命中）
    if (response.hits.some((hit) => hit.relevance < 1)) qualityOverride += 1;
  }
  track(rankStep, '命中按 score 降序（无倒序对）', 0, sortViolations, sortViolations === 0);
  track(
    rankStep,
    'score = 质量分 × 归一相关度（逐条复核）',
    0,
    formulaViolations,
    formulaViolations === 0,
  );
  track(
    rankStep,
    '归一相关度确有区分度（存在 relevance<1 的查询）',
    '>=5',
    qualityOverride,
    qualityOverride >= 5,
  );

  // ── 步骤 5：P95 基线（只记基线，不设硬门槛）────────────────────────
  const latencyStep = createStep('latency-p95', '检索延迟基线（P95）');
  steps.push(latencyStep);
  const buildStart = process.hrtime.bigint();
  searchModule.buildSearchIndex(indexFromDisk.assets);
  const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
  const samples = [];
  for (let round = 0; round < LATENCY_ROUNDS; round += 1) {
    for (const example of EXAMPLE_QUERIES) {
      const start = process.hrtime.bigint();
      searchModule.searchMarketIndex(searchIndexFromDisk, example.q, { limit: 10 });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
  }
  const p50 = searchModule.percentile(samples, 0.5);
  const p95 = searchModule.percentile(samples, 0.95);
  const max = Math.max(...samples);
  track(latencyStep, 'P95 有测量值（首版不设硬门槛，基线入库）', '>0', p95.toFixed(3), p95 > 0);
  latencyStep.metrics = {
    rounds: LATENCY_ROUNDS,
    samples: samples.length,
    queries: EXAMPLE_QUERIES.length,
    p50Ms: Number(p50.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    maxMs: Number(max.toFixed(3)),
    buildMs: Number(buildMs.toFixed(3)),
    p95Policy: 'baseline-only（远期口径 v1.1 P3：P95 <300ms；首版不设门槛）',
    docs: indexFromDisk.assets.length,
  };

  const evidence = {
    schema: 'df.market.evidence/v1',
    runId,
    asOf: startedAt.toISOString(),
    offline: true,
    collector: { name: 'df-market', version: '0.1.0' },
    steps,
    exitCode: 0,
    meta: {
      finishedAt: new Date().toISOString(),
      dwsSource: opts.dws,
      dwsKind:
        opts.dws === DEFAULT_DWS
          ? 'fixture（自造样本；MK-03 落地后可 --dws 指向真实 DWS）'
          : 'external',
      generatedAt,
      node: process.version,
      route: 'DWS 夹具 → buildAdsArtifacts → 落盘 → 产物回读检索（searchMarketIndex）',
      articles: written,
    },
  };
  return evidence;
}

/** 阻塞错误（退出码 2：无数据/依赖不可用；不得以空数据冒充通过）。 */
class BlockedError extends Error {}

/** 真失败（退出码 1：有数据但断言不成立——例如产物未通过 schema 校验）。 */
class FailedError extends Error {}

const evidence = await main().catch(async (error) => {
  const blocked = error instanceof BlockedError;
  console.error(`[verify-mk-04] ${blocked ? '阻塞' : '异常'}：${String(error)}`);
  steps.push({
    id: 'pipeline',
    name: '管线可运行性',
    verdict: blocked ? 'blocked' : 'fail',
    assertions: [{ name: '管线可运行', expected: 'true', actual: String(error), ok: false }],
    artifacts: [],
    metrics: {},
  });
  return {
    schema: 'df.market.evidence/v1',
    runId,
    asOf: startedAt.toISOString(),
    offline: true,
    collector: { name: 'df-market', version: '0.1.0' },
    steps,
    exitCode: blocked ? 2 : 1,
    meta: { finishedAt: new Date().toISOString(), blockedReason: String(error) },
  };
});

const failedSteps = evidence.steps.filter((step) => step.verdict === 'fail');
if (evidence.exitCode === 0 && failedSteps.length > 0) evidence.exitCode = 1;
const blockedSteps = evidence.steps.filter((step) => step.verdict === 'blocked');
if (blockedSteps.length > 0) evidence.exitCode = 2;

const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
const outsidePath = join(DEFAULT_OUT, 'verify-mk-04.evidence.json');
await mkdir(dirname(outsidePath), { recursive: true });
await writeFile(outsidePath, evidenceText, 'utf8');
await mkdir(ARTIFACTS_DIR, { recursive: true });
await writeFile(join(ARTIFACTS_DIR, 'evidence.json'), evidenceText, 'utf8');

for (const step of evidence.steps) {
  const mark = step.verdict === 'pass' ? 'ok' : step.verdict.toUpperCase();
  console.log(`  [${mark}] ${step.id} —— ${step.name}（断言 ${step.assertions.length} 项）`);
  for (const assertion of step.assertions.filter((item) => !item.ok)) {
    console.error(
      `      × ${assertion.name}：期望 ${assertion.expected}，实际 ${assertion.actual}`,
    );
  }
}
const latency = evidence.steps.find((step) => step.id === 'latency-p95');
if (latency !== undefined) {
  console.log(
    `[verify-mk-04] P95 基线：${latency.metrics.p95Ms} ms（P50 ${latency.metrics.p50Ms} / max ${latency.metrics.maxMs}；样本 ${latency.metrics.samples}）`,
  );
}
console.log(
  `[verify-mk-04] 步骤 ${evidence.steps.length} 项、失败 ${failedSteps.length} 项；证据：${outsidePath}；退出码 ${evidence.exitCode}`,
);
process.exit(evidence.exitCode);
