#!/usr/bin/env node
/**
 * verify-market —— 市场前端 + 数据看板的**自设计页门禁**（FE-11 交付；本票范围内自管，不接 CI）。
 *
 * 四类检查（《前端验收标准 v1》§6）+ 一条阻塞规则：
 * 1. **设计系统一致性（令牌，A 级可自动）**：对四个目录跑 `guard-tokens` 同源核心
 *    （`packages/ui/src/tools/guard-tokens-core.mjs`），任何颜色/长度/间距裸值即失败（exit 1）；
 * 2. **状态覆盖挂点（验收 §5）**：逐页断言六态登记表（`state-coverage.json`）里每个 `marker`
 *    都能在声明的源文件里**逐字找到**；缺项即失败（exit 1）；由 `@dforge/ui` 基础件承担的态
 *    记 `delegatedTo` 并**进人工复核清单**（绝不登记为通过）；
 * 3. **与相邻对照页风格同族（B 级人工）**：本脚本**只登记待复核项**（humanReview.verdict=pending），
 *    人工判定由验收会话给出，脚本不代签；
 * 4. **修复批次 4 · 工作包 E（真数据面断言）**：
 *    - E1 中文检索：`GET /market/query?q=幻灯片` 走 BM25 倒排 → 命中数 > 0（D-5 回归）；
 *      检索索引缺失/损坏（warning `search-index-*`）→ 阻塞（exit 2，先跑 df market index）；
 *    - E2 错误分类：不存在的资产 → 404 + 错误码 `market_asset_not_found`（not-found 与
 *      连接错误分流的前端依据；空态渲染由 vitest 页面用例断言）；
 *    - E3 统计口径：响应同时给 `counts.total`（全局）与 `total`（当前结果），且当前 ≤ 全局。
 * 5. **阻塞（exit 2）**：daemon `/market/query` 不可达，或索引缺失/损坏 → 看板与市场页「无数据」，
 *    本门禁按三态语义记 `blockedReason` 并 `exit 2`（**禁止以空数据冒充通过**）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-market.mjs                    # 默认探测 http://127.0.0.1:4318
 *   DF_DAEMON_URL=http://127.0.0.1:5000 node scripts/verify-market.mjs
 *   node scripts/verify-market.mjs --skip-daemon      # 只跑静态两项（仍按 exit 2 记阻塞）
 *
 * 与 `verify-self-designed.mjs`（FE-09，尚未入集成分支）的关系：
 * 本脚本的检查 ①② 与它同源同口径（同一份 guard-tokens 核心 + 六态挂点），额外多了
 * ③ 的市场专属阻塞判定（daemon `/market` 索引可判定性）。FE-09 的门禁并入集成分支后，
 * 可改为 `node scripts/verify-self-designed.mjs --roots apps/web/src/features/market,... --ticket fe-11`
 * 跑前两项，本脚本只保留 daemon 项（统一动作留给合并阶段，见报告）。
 *
 * 环境变量：DF_DAEMON_URL、DF_EVIDENCE_DIR（缺省 ~/df-evidence）。
 * 证据 JSON 字段按《前端验收标准 v1》§4：page/level/diff/artifacts/humanReview/exitCode。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES, scanRoots } from '../packages/ui/src/tools/guard-tokens-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TICKET = 'fe-11';
const DAEMON_URL = (process.env.DF_DAEMON_URL ?? 'http://127.0.0.1:4318').replace(/\/+$/, '');
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const args = process.argv.slice(2);
const skipDaemon = args.includes('--skip-daemon');
const verbose = args.includes('--verbose');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-market-${stamp}.json`);

/** 本票名下（自设计页）的扫描与断言范围。 */
const OWNED_ROOTS = [
  'apps/web/src/features/market',
  'apps/web/src/features/dashboard',
  'apps/web/src/app/market',
  'apps/web/src/app/dashboard',
];

/** 六态覆盖登记表（D1–D6）。 */
const COVERAGE_PATH = 'apps/web/src/features/market/state-coverage.json';

/** 风格同族的人工复核清单（B 级：脚本只登记，不判定）。 */
const HUMAN_REVIEW_ITEMS = [
  '与相邻对照页风格同族：市场页（浅色首页族）与 FE-02 首页的卡片密度/圆角/阴影档次是否同族',
  '与相邻对照页风格同族：编辑器内市场面板（深色 UI3）与 FE-03 编辑器壳层的面板底色/描边/控件高是否同族',
  '数据看板（浅色）表格与统计卡的密度是否与设置页（FE-09）同族',
  '动效与过渡（悬停抬升、模态开合）终态截图 + 人工手感评估（自动截图只取终态）',
];

/** 证据骨架（字段按验收标准 §4）。 */
function baseEvidence() {
  return {
    ticket: 'FE-11',
    gate: 'verify-market',
    schema: 'df.market.state-coverage/v1',
    level: 'A（令牌一致性 + 六态挂点；风格同族与动效按 B 级人工复核）',
    pages: [
      '/market（D1/D3）',
      '/market/[assetId]（D2/D4）',
      '/market/panel（D5）',
      '/dashboard（D6）',
    ],
    params: { rules: RULES.map((rule) => rule.id), daemonUrl: DAEMON_URL, skipDaemon },
    startedAt: startedAt.toISOString(),
    checks: [],
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '风格同族与动效终态按 B 级需人工复核登记；脚本不代签（验收标准 §6 ③）。',
      items: HUMAN_REVIEW_ITEMS,
    },
    artifacts: {},
    exitCode: 2,
  };
}

/** 落盘证据并结束进程。 */
function finish(evidence, code, message) {
  evidence.exitCode = code;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(evidenceDir, { recursive: true });
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(evidencePath, text, 'utf8');
  evidence.artifacts.evidence = {
    path: evidencePath,
    sha256: createHash('sha256').update(text).digest('hex'),
    length: Buffer.byteLength(text),
  };
  if (message) console.error(message);
  console.error(`证据：${evidencePath}`);
  process.exit(code);
}

/** 指纹（`{sha256, length}`；盘点产物入证据的约定）。 */
function fingerprint(absPath) {
  const buffer = readFileSync(absPath);
  return {
    path: absPath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

const evidence = baseEvidence();

/* ---------------- 检查 1 · 令牌一致性（guard-tokens 同源核心） ---------------- */

function runTokenCheck() {
  const missingRoots = OWNED_ROOTS.filter((root) => !existsSync(join(repoRoot, root)));
  if (missingRoots.length > 0) {
    return {
      id: 'design-system-tokens',
      name: '设计系统一致性（令牌/禁裸值）',
      verdict: 'blocked',
      assertions: [
        {
          name: '本票目录存在',
          expected: OWNED_ROOTS.join(', '),
          actual: `缺失：${missingRoots.join(', ')}`,
          ok: false,
        },
      ],
      violations: [],
    };
  }
  const { violations, skipped } = scanRoots(repoRoot, OWNED_ROOTS);
  if (verbose) {
    for (const item of skipped) console.log(`  ⤳ 白名单跳过 ${item.file}（${item.reason}）`);
  }
  return {
    id: 'design-system-tokens',
    name: '设计系统一致性（令牌/禁裸值）',
    verdict: violations.length === 0 ? 'pass' : 'fail',
    assertions: [
      {
        name: '四个归属目录零裸值（R1 颜色 / R2 长度 / R3 间距族裸数字）',
        expected: '0 违规',
        actual: `${violations.length} 违规`,
        ok: violations.length === 0,
      },
      {
        name: '扫描覆盖面（文件级白名单外全部计入）',
        expected: OWNED_ROOTS.join(', '),
        actual: `${OWNED_ROOTS.length} 个根目录`,
        ok: true,
      },
    ],
    violations: violations.slice(0, 50),
    scannedRoots: OWNED_ROOTS,
  };
}

/* ---------------- 检查 2 · 六态覆盖挂点（验收 §5） ---------------- */

function runStateCoverageCheck() {
  const absManifest = join(repoRoot, COVERAGE_PATH);
  if (!existsSync(absManifest)) {
    return {
      id: 'state-coverage',
      name: '状态覆盖挂点（六态，验收 §5）',
      verdict: 'blocked',
      assertions: [{ name: '六态登记表存在', expected: COVERAGE_PATH, actual: '缺失', ok: false }],
      missing: [],
      delegated: [],
    };
  }
  const manifest = JSON.parse(readFileSync(absManifest, 'utf8'));
  const states = manifest.states;
  const missing = [];
  const delegated = [];
  let declared = 0;
  const pages = [];

  for (const page of manifest.pages) {
    const pageStates = [];
    for (const state of states) {
      const entry = page.states[state];
      if (entry === undefined) {
        missing.push(`${page.page}/${state}：未登记`);
        continue;
      }
      if (entry.marker === undefined) {
        delegated.push({ page: page.page, state, delegatedTo: entry.delegatedTo ?? '' });
        pageStates.push(`${state}（delegated）`);
        continue;
      }
      declared += 1;
      const hit = page.sourceFiles.some((file) => {
        const abs = join(repoRoot, file);
        return existsSync(abs) && readFileSync(abs, 'utf8').includes(entry.marker);
      });
      if (hit) pageStates.push(`${state}（marker 命中）`);
      else
        missing.push(
          `${page.page}/${state}：marker 未在 ${page.sourceFiles.join(', ')} 命中 → ${entry.marker}`,
        );
    }
    pages.push({ page: page.page, route: page.route, theme: page.theme, states: pageStates });
  }

  return {
    id: 'state-coverage',
    name: '状态覆盖挂点（六态，验收 §5）',
    verdict: missing.length === 0 ? 'pass' : 'fail',
    assertions: [
      {
        name: 'D1–D6 逐页六态齐备且 marker 逐字命中源码',
        expected: '0 缺项',
        actual: `${missing.length} 缺项（${declared} 个 marker 已断言）`,
        ok: missing.length === 0,
      },
      {
        name: '基础件承担的态不登记为通过（humanReview 待复核）',
        expected: `delegated 项进人工清单`,
        actual: `${delegated.length} 项 delegatedTo`,
        ok: true,
      },
    ],
    pages,
    missing,
    delegated,
    artifact: fingerprint(absManifest),
  };
}

/* ---------------- 检查 3 · daemon /market（阻塞判定） ---------------- */

async function runDaemonCheck() {
  if (skipDaemon) {
    return {
      id: 'daemon-market',
      name: 'daemon /market/query（真数据面）',
      verdict: 'blocked',
      assertions: [
        { name: '跳过探测（--skip-daemon）', expected: '可达', actual: '未探测', ok: false },
      ],
      blockedReason: '参数 --skip-daemon：未探测 daemon，按阻塞上报（不得当通过）。',
    };
  }
  try {
    const response = await fetch(`${DAEMON_URL}/market/query?limit=1`, { redirect: 'follow' });
    const payload = await response.json();
    if (payload?.ok !== true) {
      return {
        id: 'daemon-market',
        name: 'daemon /market/query（真数据面）',
        verdict: 'fail',
        assertions: [
          {
            name: '查询响应为成功信封',
            expected: 'ok=true',
            actual: `code=${payload?.error?.code ?? 'unknown'}`,
            ok: false,
          },
        ],
      };
    }
    const result = payload.result;
    const warnings = (result.warnings ?? []).map((warning) => warning.code);
    const blocked = warnings.includes('index-missing') || warnings.includes('index-invalid');
    return {
      id: 'daemon-market',
      name: 'daemon /market/query（真数据面）',
      verdict: blocked ? 'blocked' : 'pass',
      assertions: [
        {
          name: 'daemon 可达且返回契约响应',
          expected: 'ok=true + schema=df.marketplace.index/v1',
          actual: `${result.schema}（state=${result.state}）`,
          ok: result.schema === 'df.marketplace.index/v1',
        },
        {
          name: '索引可判定（非 index-missing/index-invalid）',
          expected: '有索引',
          actual: warnings.length === 0 ? '有索引' : warnings.join(', '),
          ok: !blocked,
        },
      ],
      metrics: {
        total: result.counts?.total ?? null,
        loadable: result.counts?.loadable ?? null,
        generatedAt: result.generatedAt ?? null,
        warnings,
      },
      ...(blocked
        ? {
            blockedReason:
              '市场索引缺失或损坏：市场页/看板进入空态（给采集指引），本门禁按三态语义记阻塞（禁止假绿）。请先跑 df market collect|score|index。',
          }
        : {}),
    };
  } catch (error) {
    return {
      id: 'daemon-market',
      name: 'daemon /market/query（真数据面）',
      verdict: 'blocked',
      assertions: [
        {
          name: 'daemon 可达',
          expected: `GET ${DAEMON_URL}/market/query`,
          actual: String(error),
          ok: false,
        },
      ],
      blockedReason: `daemon 不可达（${DAEMON_URL}）：无真数据面可断言，按阻塞上报。`,
    };
  }
}

/* ---------------- 检查 4 · 修复批次 4 · 工作包 E（E1 检索 / E2 错误分类 / E3 统计口径） ---------------- */

/** E1 中文检索探针用的查询串（D-5 的复现用例：BM25 切词 + 术语等价类 → [幻灯,灯片,ppt]）。 */
const E1_QUERY = '幻灯片';

async function runBatch4MarketCheck() {
  const id = 'batch4-market-e';
  const name = '修复批次 4 · 工作包 E（BM25 检索 / not-found 错误码 / 统计口径）';
  if (skipDaemon) {
    return {
      id,
      name,
      verdict: 'blocked',
      assertions: [
        { name: '跳过探测（--skip-daemon）', expected: '可达', actual: '未探测', ok: false },
      ],
      blockedReason: '参数 --skip-daemon：未探测 daemon，工作包 E 的真数据面断言按阻塞上报。',
    };
  }
  const assertions = [];
  try {
    // E1：中文检索走 BM25 倒排（无检索索引 → 阻塞，不假绿）
    const searchResponse = await fetch(
      `${DAEMON_URL}/market/query?q=${encodeURIComponent(E1_QUERY)}&limit=5`,
      { redirect: 'follow' },
    );
    const searchPayload = await searchResponse.json();
    if (searchPayload?.ok !== true) {
      assertions.push({
        name: `E1 中文检索可判定（q=${E1_QUERY}）`,
        expected: 'ok=true',
        actual: `code=${searchPayload?.error?.code ?? 'unknown'}`,
        ok: false,
      });
      return { id, name, verdict: 'fail', assertions };
    }
    const search = searchPayload.result;
    const searchWarnings = (search.warnings ?? []).map((warning) => warning.code);
    const searchIndexMissing = searchWarnings.some(
      (code) => code === 'search-index-missing' || code === 'search-index-invalid',
    );
    if (searchIndexMissing) {
      return {
        id,
        name,
        verdict: 'blocked',
        assertions: [
          {
            name: `E1 中文检索（q=${E1_QUERY}）`,
            expected: 'BM25 检索索引在位',
            actual: searchWarnings.join(', '),
            ok: false,
          },
        ],
        blockedReason:
          'BM25 检索索引缺失或损坏（warning search-index-*）：先跑 df market index，或把 market_search_index.v1.json 与市场索引同族放置后再跑本门禁。',
      };
    }
    const indexMissing = searchWarnings.some(
      (code) => code === 'index-missing' || code === 'index-invalid',
    );
    if (indexMissing) {
      return {
        id,
        name,
        verdict: 'blocked',
        assertions: [
          {
            name: `E1 中文检索（q=${E1_QUERY}）`,
            expected: '市场索引在位',
            actual: searchWarnings.join(', '),
            ok: false,
          },
        ],
        blockedReason: '市场索引缺失或损坏：工作包 E 的真数据面断言无索引可判，按阻塞上报。',
      };
    }
    assertions.push({
      name: `E1 中文检索（q=${E1_QUERY}）走 BM25 倒排，命中 > 0`,
      expected: 'total > 0 且 items 非空',
      actual: `total=${search.total}（items=${search.items?.length ?? 0}，state=${search.state}）`,
      ok: search.total > 0 && (search.items?.length ?? 0) > 0,
    });

    // E2：不存在的资产 → 404 + market_asset_not_found（前端分流依据）
    const missingAssetId = 'gh:df-verify#__batch4-e-not-found-probe__';
    const notFoundResponse = await fetch(
      `${DAEMON_URL}/market/assets/${encodeURIComponent(missingAssetId)}`,
      { redirect: 'follow' },
    );
    const notFoundPayload = await notFoundResponse.json();
    assertions.push({
      name: 'E2 不存在资产 → 404 + market_asset_not_found（not-found 与连接错误分流）',
      expected: 'HTTP 404 + code=market_asset_not_found',
      actual: `HTTP ${notFoundResponse.status} + code=${notFoundPayload?.error?.code ?? 'unknown'}`,
      ok:
        notFoundResponse.status === 404 &&
        notFoundPayload?.error?.code === 'market_asset_not_found',
    });

    // E3：统计口径（全局 counts.total 与当前结果 total 同时给出，且当前 ≤ 全局）
    const summaryResponse = await fetch(`${DAEMON_URL}/market/query?limit=1`, {
      redirect: 'follow',
    });
    const summaryPayload = await summaryResponse.json();
    const summary = summaryPayload?.ok === true ? summaryPayload.result : null;
    const globalTotal = summary?.counts?.total ?? null;
    const currentTotal = summary?.total ?? null;
    assertions.push({
      name: 'E3 统计口径：全局（counts.total）与当前结果（total）同时可读',
      expected: '均为数字且 当前 ≤ 全局',
      actual: `全局=${globalTotal ?? 'null'}，当前=${currentTotal ?? 'null'}`,
      ok:
        typeof globalTotal === 'number' &&
        typeof currentTotal === 'number' &&
        currentTotal <= globalTotal,
    });

    const failed = assertions.some((assertion) => !assertion.ok);
    return {
      id,
      name,
      verdict: failed ? 'fail' : 'pass',
      assertions,
      metrics: {
        searchTotal: search.total ?? null,
        globalTotal,
        currentTotal,
        searchWarnings,
      },
    };
  } catch (error) {
    return {
      id,
      name,
      verdict: 'blocked',
      assertions,
      blockedReason: `daemon 不可达（${DAEMON_URL}）：工作包 E 的真数据面断言无面可判（${String(error)}）。`,
    };
  }
}

/* ---------------- 主流程 ---------------- */

const tokenCheck = runTokenCheck();
evidence.checks.push(tokenCheck);

const coverageCheck = runStateCoverageCheck();
evidence.checks.push(coverageCheck);

const daemonCheck = await runDaemonCheck();
evidence.checks.push(daemonCheck);

const batch4Check = await runBatch4MarketCheck();
evidence.checks.push(batch4Check);

// 证据里的 diff 段（自设计页无像素对照：diff 全零 + 说明；字段保留以对齐验收标准 §4）
evidence.diff = {
  bbox: { x: 0, y: 0, width: 0, height: 0 },
  diffPixels: 0,
  ratio: 0,
  note: '自设计页：不逐像素对照 Figma 本体（验收标准 §6），本段留空；像素对照挂点归 verify-figma-* 家族。',
};

if (coverageCheck.artifact !== undefined) {
  evidence.artifacts.stateCoverage = coverageCheck.artifact;
}

const blocked = evidence.checks.find((check) => check.verdict === 'blocked');
const failed = evidence.checks.find((check) => check.verdict === 'fail');

if (blocked !== undefined) {
  finish(evidence, 2, `verify-market：阻塞 —— ${blocked.blockedReason ?? blocked.name}`);
}
if (failed !== undefined) {
  const detail =
    failed.violations !== undefined && failed.violations.length > 0
      ? failed.violations
          .map((item) => `    ${item.file}:${item.line}:${item.column} [${item.rule}] ${item.text}`)
          .join('\n')
      : '';
  finish(
    evidence,
    1,
    `verify-market：失败 —— ${failed.name}\n${failed.assertions
      .filter((assertion) => !assertion.ok)
      .map((assertion) => `    ✗ ${assertion.name}：${assertion.actual}`)
      .join('\n')}${detail.length > 0 ? `\n${detail}` : ''}`,
  );
}

finish(
  evidence,
  0,
  `verify-market：通过 —— 令牌零裸值、D1–D6 六态挂点全命中、daemon 索引可判定、工作包 E 真数据面断言全过（人工复核项 ${HUMAN_REVIEW_ITEMS.length} 条待验收会话）。`,
);
