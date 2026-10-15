#!/usr/bin/env node
/**
 * verify-mk-05 —— CLI 与首批 40 仓跑通的判据链门禁（issue #34 DoD；《市场首实现》§4 六环）。
 *
 * 六环（逐环断言 + 证据索引；任一环失败即整体不通过，不做「部分通过」）：
 *   1. request-discipline  请求纪律（串行 / GET-only / 预算 / 304 / 无死信）
 *   2. identification      四类认定（四类各 ≥5；可装载 ≥31；每条认定可复现）
 *   3. scoring             评分完整（DWS 记录全过校验 / 无 NaN / 可解释 / 可对账）
 *   4. index               index 产出且 schema 过（blocked 不出现、counts 自洽）
 *   5. search              检索可命中（示例查询 ≥10 条；≥5 条 ≥3 结果；P95 基线）
 *   6. replay              证据 JSON + 离线复跑（逐层 digest 比对，列出差异）
 *
 * 退出码（规格《市场首实现》§6.1，禁止假绿）：
 *   0 = 六环全绿；1 = 有数据但断言失败；2 = 阻塞（缺产物/缺复跑批次 → 明确报告缺哪一环）。
 *
 * 用法：
 *   node scripts/verify-mk-05.mjs [--data <dir>] [--replay-data <dir>] [--out <dir>]
 *                                 [--min-repos <n>] [--skip-tests]
 *   默认 --data ~/df-evidence/mk-05/batch/data；--out ~/df-evidence/mk-05
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 参数解析。 */
function parseArgs(argv) {
  const opts = {
    data: join(homedir(), 'df-evidence', 'mk-05', 'batch', 'data'),
    replayData: join(homedir(), 'df-evidence', 'mk-05', 'replay', 'data'),
    out: join(homedir(), 'df-evidence', 'mk-05'),
    skipTests: false,
    minRepos: 40,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      return argv[index] ?? '';
    };
    if (arg === '--data') opts.data = resolve(value());
    else if (arg === '--replay-data') opts.replayData = resolve(value());
    else if (arg === '--out') opts.out = resolve(value());
    else if (arg === '--min-repos') opts.minRepos = Number(value());
    else if (arg === '--skip-tests') opts.skipTests = true;
    else {
      console.error(`未知参数：${arg}`);
      console.error(
        '用法：node scripts/verify-mk-05.mjs [--data <dir>] [--replay-data <dir>] [--out <dir>] [--min-repos <n>] [--skip-tests]',
      );
      process.exit(2);
    }
  }
  return opts;
}

const OPTS = parseArgs(process.argv.slice(2));
const sha256Of = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const artifact = (path) => ({
  path,
  sha256: `sha256:${sha256Of(readFileSync(path, 'utf8'))}`,
  length: statSync(path).size,
});
const isFile = (path) => existsSync(path) && statSync(path).isFile();

const { ads, score, transform } = await import(
  pathToFileURL(join(ROOT, 'services', 'ingest', 'src', 'index.ts')).href
);
const { loadAdsArtifacts, runQuerySet } = await import(
  pathToFileURL(join(ROOT, 'tools', 'cli', 'src', 'market', 'search-cmd.ts')).href
);
const { MARKET_EXAMPLE_QUERIES } = await import(
  pathToFileURL(join(ROOT, 'tools', 'cli', 'src', 'market', 'query-set.ts')).href
);

/** 步骤构造小工具。 */
function step(id, name, assertions, artifacts = [], metrics = {}) {
  const ok = assertions.every((a) => a.ok);
  return { id, name, verdict: ok ? 'pass' : 'fail', assertions, artifacts, metrics };
}
function assert(name, expected, actual, ok) {
  return { name, expected: String(expected), actual: String(actual), ok };
}
function blockedStep(id, name, reason) {
  return {
    id,
    name,
    verdict: 'blocked',
    assertions: [assert('可判定前提', '产物齐备', reason, false)],
    artifacts: [],
    metrics: {},
  };
}

/** 读 JSONL / jsonl.gz 行。 */
function readJsonlLines(path) {
  const raw = readFileSync(path);
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** 列出目录下匹配的 JSONL（一层分区）。 */
function listJsonl(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root).sort()) {
    const entry = join(root, name);
    if (!statSync(entry).isDirectory()) continue;
    for (const file of readdirSync(entry).sort()) {
      if (file.endsWith('.jsonl') || file.endsWith('.jsonl.gz')) out.push(join(entry, file));
    }
  }
  return out;
}

/** 定位 MK-01 采集证据（`<data>/evidence/<runId>.json`，排除 cli-/score-/index- 前缀）。 */
function findCollectEvidence(dataRoot) {
  const dir = join(dataRoot, 'evidence');
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort().reverse()) {
    if (!name.endsWith('.json')) continue;
    if (/^(cli-|score-|index-)/.test(name)) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed.schema === 'df.market.evidence/v1') {
        return { path: join(dir, name), evidence: parsed };
      }
    } catch {
      // 坏文件跳过，继续找
    }
  }
  return null;
}

/** 表目录 → 逐表 digest。 */
function digestOfTables(dir) {
  const out = {};
  for (const name of transform.TABLE_NAMES) {
    const path = join(dir, `${name}.parquet`);
    if (!isFile(path)) continue;
    out[name] = `sha256:${sha256Of(readFileSync(path).toString('latin1'))}`;
  }
  return out;
}

const steps = [];
const dataRoot = OPTS.data;
const paths = {
  ods: join(dataRoot, 'ods'),
  dwd: join(dataRoot, 'dwd'),
  dws: join(dataRoot, 'dws'),
  ads: join(dataRoot, 'ads'),
};
const qualityPath = join(paths.dws, 'asset_quality.jsonl');
const dwdManifestPath = join(paths.dwd, '_dwd_manifest.json');
const dwsManifestPath = join(paths.dws, '_dws_manifest.json');

// ── 步骤 0：单元测试（包内 vitest，可 --skip-tests 跳过）──────────────────
if (!OPTS.skipTests) {
  const results = [];
  for (const filter of ['@dforge/ingest', '@dforge/cli']) {
    const run = spawnSync('pnpm', ['--filter', filter, 'test'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    results.push({
      filter,
      status: run.status ?? 1,
      tail: (run.stdout ?? '').trim().split('\n').slice(-6).join(' | '),
    });
  }
  steps.push(
    step(
      'unit-tests',
      '包内单元测试（vitest：采集线 + CLI）',
      results.map((r) =>
        assert(`${r.filter} vitest 退出码`, '0', String(r.status), r.status === 0),
      ),
      [],
      { outputTail: results.map((r) => `${r.filter}: ${r.tail}`).join(' || ') },
    ),
  );
}

// ── 环 1：请求纪律 ────────────────────────────────────────────────────────
const eventFiles = listJsonl(join(paths.ods, 'raw_events'));
const collectEvidence = findCollectEvidence(dataRoot);
if (eventFiles.length === 0 || collectEvidence === null) {
  steps.push(
    blockedStep(
      'request-discipline',
      '请求纪律',
      `缺 ODS 事件或采集证据（${join(paths.ods, 'raw_events')} / <data>/evidence/<runId>.json）`,
    ),
  );
} else {
  const events = eventFiles.flatMap((path) => readJsonlLines(path));
  const nonGet = events.filter((e) => e.request.method !== 'GET');
  const sorted = [...events].sort((a, b) => a.startedAtMs - b.startedAtMs);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startedAtMs < sorted[i - 1].endedAtMs) overlaps += 1;
  }
  const counted = events.filter((e) => e.response.countedAgainstBudget);
  const coreCalls = counted.filter((e) => e.request.kind === 'core').length;
  const searchCalls = counted.filter((e) => e.request.kind === 'search').length;
  const hits304 = events.filter((e) => e.response.status === 304).length;
  const deadLetter = events.filter(
    (e) =>
      e.response.status === 0 ||
      e.response.status >= 500 ||
      e.response.status === 403 ||
      e.response.status === 429,
  );
  const quotaEvents = events.filter((e) => e.response.quota !== null);
  const firstQuota = quotaEvents[0]?.response?.quota ?? null;
  const lastQuota = quotaEvents.at(-1)?.response?.quota ?? null;
  steps.push(
    step(
      'request-discipline',
      '请求纪律（规格 §3：串行 / GET-only / 预算 / 304 / 无死信）',
      [
        assert(
          '一律 GET（gh api -f 坑：禁 POST）',
          '0 违规',
          String(nonGet.length),
          nonGet.length === 0,
        ),
        assert('串行（并发度 = 1，事件不重叠）', '0 重叠', String(overlaps), overlaps === 0),
        assert('core ≤ 4000/时（规格预算）', '≤4000', String(coreCalls), coreCalls <= 4000),
        assert('search ≤ 24/分（规格预算）', '≤24', String(searchCalls), searchCalls <= 24),
        assert(
          '无死信（网络错误/5xx/限速未消化）',
          '0',
          String(deadLetter.length),
          deadLetter.length === 0,
        ),
        assert(
          '限流余量留痕（首/末事件带 quota）',
          '两者皆非 null',
          `${firstQuota !== null}/${lastQuota !== null}`,
          firstQuota !== null && lastQuota !== null,
        ),
      ],
      [artifact(collectEvidence.path), ...eventFiles.slice(0, 3).map(artifact)],
      {
        events: events.length,
        coreCalls,
        searchCalls,
        cacheHits304: hits304,
        deadLetter: deadLetter.length,
        quotaStartRemaining: firstQuota?.remaining ?? null,
        quotaEndRemaining: lastQuota?.remaining ?? null,
      },
    ),
  );
}

// ── 环 2：四类认定（≥31 可装载；四类各 ≥5）───────────────────────────────
let dwdTables = null;
if (!isFile(join(paths.dwd, 'asset.parquet'))) {
  steps.push(blockedStep('identification', '四类认定', `缺 DWD 产物（${paths.dwd}）`));
} else {
  dwdTables = await transform.readDwd(paths.dwd);
  const byKind = { skill: 0, plugin: 0, 'design-system': 0, template: 0 };
  let loadable = 0;
  let reproducible = 0;
  for (const row of dwdTables.asset) {
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    if (row.license_gate === 'loadable' && row.brand_derived !== true) loadable += 1;
    if ((row.probes ?? []).length > 0 && (row.checks ?? []).length > 0) reproducible += 1;
  }
  const repos = dwdTables.repo.length;
  const queries = collectEvidence?.evidence?.steps?.find((s) => s.id === 'asset-identification')
    ?.metrics?.queries;
  steps.push(
    step(
      'identification',
      '四类认定（探针 + 内容校验；≥31 可装载）',
      [
        assert(
          `仓数 ≥ ${OPTS.minRepos}（首批构成）`,
          `≥${OPTS.minRepos}`,
          String(repos),
          repos >= OPTS.minRepos,
        ),
        assert(
          '四类各 ≥5',
          '全 ≥5',
          JSON.stringify(byKind),
          Object.values(byKind).every((n) => n >= 5),
        ),
        assert('可装载资产 ≥31', '≥31', String(loadable), loadable >= 31),
        assert(
          '每条认定可复现（探针 + 校验结论齐）',
          String(dwdTables.asset.length),
          String(reproducible),
          reproducible === dwdTables.asset.length,
        ),
      ],
      [artifact(dwdManifestPath)],
      { repos, byKind: JSON.stringify(byKind), loadable, queries: String(queries ?? '') },
    ),
  );
}

// ── 环 3：评分完整 ────────────────────────────────────────────────────────
if (!isFile(qualityPath) || !isFile(dwsManifestPath)) {
  steps.push(blockedStep('scoring', '评分完整', `缺 DWS 产物（${qualityPath}）`));
} else {
  const records = readJsonlLines(qualityPath);
  const issues = records.flatMap((record) =>
    score.validateDwsRecord(record).map((issue) => `${record.assetId}: ${issue}`),
  );
  const nanCheck = records.filter((record) => {
    const numbers = [record.score, ...score.DIMENSIONS.map((dim) => record.dims[dim])].filter(
      (value) => value !== null,
    );
    return numbers.some((value) => typeof value !== 'number' || Number.isNaN(value));
  });
  const explainGaps = records.filter((record) =>
    score.DIMENSIONS.some((dim) => record.explain?.[dim]?.signals?.length === 0),
  );
  const manifest = JSON.parse(readFileSync(dwsManifestPath, 'utf8'));
  const dimHoles = records.reduce(
    (sum, record) => sum + score.DIMENSIONS.filter((dim) => record.dims[dim] === null).length,
    0,
  );
  const jsonl = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const recomputeOk = score.sha256Hex(jsonl) === score.sha256Hex(readFileSync(qualityPath, 'utf8'));
  steps.push(
    step(
      'scoring',
      '评分完整（DWS 五维 + 可解释 + 无 NaN；规格 §5）',
      [
        assert(
          'DWS 记录全过校验（含总分与维度分互证）',
          '0 问题',
          issues.length === 0 ? '0 问题' : issues.slice(0, 2).join(' / '),
          issues.length === 0,
        ),
        assert('无 NaN / 非数值', '0', String(nanCheck.length), nanCheck.length === 0),
        assert('五维 explain 非空', '0 缺口', String(explainGaps.length), explainGaps.length === 0),
        assert(
          '输入 + 排除 = 去重后资产数（可对账）',
          String(manifest.inputs ?? -1),
          String(records.length + (manifest.excluded?.length ?? 0)),
          records.length + (manifest.excluded?.length ?? 0) === manifest.inputs,
        ),
        assert('产物字节与重算摘要一致', '一致', recomputeOk ? '一致' : '不一致', recomputeOk),
      ],
      [artifact(qualityPath), artifact(dwsManifestPath)],
      {
        records: records.length,
        inputs: manifest.inputs ?? null,
        excluded: manifest.excluded?.length ?? null,
        dimHoles,
        coldStart: manifest.summary?.coldStart ?? null,
        archived: manifest.summary?.archived ?? null,
      },
    ),
  );
}

// ── 环 4：index 产出且 schema 过 ──────────────────────────────────────────
const indexPath = join(paths.ads, ads.ADS_INDEX_FILENAME);
const searchIndexPath = join(paths.ads, ads.ADS_SEARCH_INDEX_FILENAME);
let loadedAds = null;
if (!isFile(indexPath)) {
  steps.push(blockedStep('index', 'index 产出', `缺 ADS 索引（${paths.ads}）`));
} else {
  const rawIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  const validation = ads.validateMarketplaceIndex(rawIndex);
  loadedAds = await loadAdsArtifacts(paths);
  const blockedInside = (rawIndex.assets ?? []).filter(
    (asset) => asset.installGate?.mode === 'blocked',
  );
  const excludedPath = join(paths.dws, '_index_excluded.json');
  steps.push(
    step(
      'index',
      'index 产出（`df.marketplace.index/v1` schema 校验）',
      [
        assert(
          'schema 校验（严格档）',
          '0 错误',
          validation.ok
            ? '0 错误'
            : validation.errors
                .slice(0, 2)
                .map((e) => `${e.path}:${e.code}`)
                .join(' / '),
          validation.ok,
        ),
        assert('blocked 资产不出现', '0', String(blockedInside.length), blockedInside.length === 0),
        assert(
          'counts 自洽（total = assets.length）',
          String(rawIndex.counts?.total ?? -1),
          String((rawIndex.assets ?? []).length),
          rawIndex.counts?.total === (rawIndex.assets ?? []).length,
        ),
        assert(
          '检索索引齐（BM25 倒排）',
          '存在',
          isFile(searchIndexPath) ? '存在' : '缺失',
          isFile(searchIndexPath),
        ),
      ],
      [
        artifact(indexPath),
        ...(isFile(searchIndexPath) ? [artifact(searchIndexPath)] : []),
        ...(isFile(excludedPath) ? [artifact(excludedPath)] : []),
      ],
      {
        assets: rawIndex.counts?.total ?? null,
        loadable: rawIndex.counts?.loadable ?? null,
        warnings: validation.warnings?.length ?? 0,
      },
    ),
  );
}

// ── 环 5：检索可命中 ──────────────────────────────────────────────────────
if (loadedAds === null) {
  steps.push(blockedStep('search', '检索可命中', '缺 ADS 产物（先过环 4）'));
} else {
  const { outcomes, p95Ms, withAtLeast3, failed } = runQuerySet(loadedAds, MARKET_EXAMPLE_QUERIES);
  steps.push(
    step(
      'search',
      '检索可命中（示例查询 ≥10 条；≥5 条 ≥3 结果；P95 基线）',
      [
        assert('查询集 ≥10 条', '≥10', String(outcomes.length), outcomes.length >= 10),
        assert(
          '每条查询 ≥1 结果（含语义期望）',
          '全部达标',
          failed.length === 0 ? '全部达标' : `未达标：${failed.join(',')}`,
          failed.length === 0,
        ),
        assert('≥5 条查询给出 ≥3 结果', '≥5', String(withAtLeast3), withAtLeast3 >= 5),
      ],
      [],
      {
        queries: outcomes.length,
        p95Ms,
        withAtLeast3,
        outcomes: JSON.stringify(outcomes),
      },
    ),
  );
}

// ── 环 6：证据 JSON + 离线复跑（逐层 digest 比对）──────────────────────────
const replayDwd = join(OPTS.replayData, 'dwd');
const replayQualityPath = join(OPTS.replayData, 'dws', 'asset_quality.jsonl');
const replayIndexPath = join(OPTS.replayData, 'ads', ads.ADS_INDEX_FILENAME);
if (!isFile(join(replayDwd, 'asset.parquet'))) {
  steps.push(
    blockedStep(
      'replay',
      '离线复跑（digest 一致）',
      `缺复跑批次（${OPTS.replayData}）——用 df market collect --replay 跑一遍后再验`,
    ),
  );
} else {
  const online = digestOfTables(paths.dwd);
  const replay = digestOfTables(replayDwd);
  const tableDiffs = Object.keys(online).filter((name) => online[name] !== replay[name]);
  const onlineQuality = isFile(qualityPath)
    ? `sha256:${sha256Of(readFileSync(qualityPath, 'utf8'))}`
    : null;
  const replayQuality = isFile(replayQualityPath)
    ? `sha256:${sha256Of(readFileSync(replayQualityPath, 'utf8'))}`
    : null;
  const onlineIndex = isFile(indexPath)
    ? `sha256:${sha256Of(readFileSync(indexPath, 'utf8'))}`
    : null;
  const replayIndex = isFile(replayIndexPath)
    ? `sha256:${sha256Of(readFileSync(replayIndexPath, 'utf8'))}`
    : null;
  steps.push(
    step(
      'replay',
      '离线复跑（复跑不触网，逐层 digest 一致或列出差异）',
      [
        assert(
          'DWD 四表 digest 逐表一致',
          '0 差异',
          tableDiffs.length === 0 ? '0 差异' : `差异：${tableDiffs.join(',')}`,
          tableDiffs.length === 0,
        ),
        assert(
          'DWS 质量行 digest 一致',
          '一致',
          onlineQuality !== null && onlineQuality === replayQuality ? '一致' : '不一致',
          onlineQuality !== null && onlineQuality === replayQuality,
        ),
        assert(
          'ADS 索引 digest 一致',
          '一致',
          onlineIndex !== null && onlineIndex === replayIndex ? '一致' : '不一致',
          onlineIndex !== null && onlineIndex === replayIndex,
        ),
      ],
      [artifact(qualityPath)],
      {
        onlineTables: JSON.stringify(online),
        replayTables: JSON.stringify(replay),
        onlineQuality,
        replayQuality,
        onlineIndex,
        replayIndex,
      },
    ),
  );
}

// ── 汇总：证据 JSON + 退出码 ──────────────────────────────────────────────
const exitCode = steps.some((s) => s.verdict === 'blocked')
  ? 2
  : steps.some((s) => s.verdict === 'fail')
    ? 1
    : 0;
const runId = `verify-mk-05-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const evidence = {
  schema: 'df.market.evidence/v1',
  runId,
  asOf: new Date().toISOString(),
  offline: false,
  collector: { name: 'df-market-cli', version: '0.1.0' },
  steps,
  exitCode,
};
mkdirSync(OPTS.out, { recursive: true });
const evidencePath = join(OPTS.out, 'verify-mk-05.evidence.json');
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

console.log(`MK-05 判据链门禁（data=${OPTS.data}）`);
for (const s of steps) {
  console.log(`  [${s.verdict}] ${s.id} — ${s.name}`);
  for (const a of s.assertions) {
    console.log(`      ${a.ok ? '✓' : '✗'} ${a.name}（期望 ${a.expected} / 实际 ${a.actual}）`);
  }
}
console.log(`证据：${evidencePath}`);
console.log(`exit ${exitCode}`);
process.exit(exitCode);
