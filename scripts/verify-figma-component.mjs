#!/usr/bin/env node
/**
 * verify-figma-component —— 组件级对照门禁（FE-01 交付；本票范围内自管，**不接 CI**）。
 *
 * 对照面：`/_design` 预览页里每个带 `data-df-preview="<组件>/<变体>/<状态>"` 的单元。
 * 参照集：`~/df-evidence/reference-v1/`（REF-01 冻结，逐单元 PNG；文件名 = 取样名把 `/` 换成 `_`）。
 * 判定：pixelmatch 8.0.0（threshold 0.1，默认忽略抗锯齿像素；研究 #5 口径）逐单元比对，
 *       差异像素率 ≤ `--max-ratio`（默认 0.001，即 A 级 0.1%）为通过。
 * 状态覆盖：验收标准 §5 六态逐项挂点；无参照集时全部记 `pending` 并整体 exit 2（禁止假绿）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-component.mjs                 # 默认 http://127.0.0.1:3210/_design
 *   DF_WEB_URL=http://127.0.0.1:3000 node scripts/verify-figma-component.mjs
 *   node scripts/verify-figma-component.mjs --only button/primary/default --verbose
 *
 * 环境变量：DF_WEB_URL（站点）、DF_REF_DIR（参照集）、DF_EVIDENCE_DIR（证据根）、
 *           BENCH_CHROME_EXECUTABLE（Chromium 可执行文件；否则自动探测缓存）。
 *
 * 退出码（门禁三态，禁止假绿）：0 全部通过 / 1 有单元超差 / 2 **阻塞**
 * （参照集未冻结 / 站点不可达 / Chromium 或依赖缺失）——`2` 绝不等价于通过。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { resolveChromeExecutable as resolveChrome } from './lib/browser-toolchain.mjs';
import { bboxOfDiff } from './lib/pixels.mjs';

const WEB_URL = process.env.DF_WEB_URL ?? 'http://127.0.0.1:3210';
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const TICKET = 'fe-01';
const THRESHOLD = 0.1;
const STATES = ['hover', 'active', 'disabled', 'loading', 'empty', 'error'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flagValue('--only');
const maxRatio = Number(flagValue('--max-ratio') ?? '0.001');

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidenceDir = join(EVIDENCE_ROOT, TICKET);
const evidencePath = join(evidenceDir, `verify-figma-component-${stamp}.json`);

/** 证据骨架（字段按《前端验收标准 v1》§4；阻塞时也落盘，记录待办）。 */
function baseEvidence() {
  return {
    ticket: 'FE-01',
    gate: 'verify-figma-component',
    page: '/_design',
    level: 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）',
    params: {
      threshold: THRESHOLD,
      maxRatio,
      engine: 'pixelmatch@8.0.0',
      aaIgnore: true,
      engineVersionNote: '升级比对库 = 重定基线（研究 #5 §3.4）',
    },
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    startedAt: startedAt.toISOString(),
    webUrl: WEB_URL,
    referenceDir: REF_DIR,
    units: [],
    stateCoverage: STATES.map((state) => ({ state, units: [], status: 'pending' })),
    artifacts: {},
    humanReview: {
      verdict: 'pending',
      reviewer: null,
      reason: '自动判定只给 A 级结论；字形/阴影/动效终态按 B 级需人工复核登记。',
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
  if (message) console.error(message);
  console.error(`证据：${evidencePath}`);
  process.exit(code);
}

/** `{sha256, length}` 指纹（大件入证据的约定）。 */
function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 参照集探测：目录存在且有 PNG 才算「已冻结」。 */
function inspectReferenceDir() {
  if (!existsSync(REF_DIR)) return { ready: false, reason: `参照集目录不存在：${REF_DIR}` };
  const files = readdirSync(REF_DIR).filter((name) => name.endsWith('.png'));
  if (files.length === 0) return { ready: false, reason: `参照集为空（无 PNG）：${REF_DIR}` };
  return { ready: true, files };
}

/** 站点探测（不可达即阻塞，不猜）。 */
async function probeSite() {
  try {
    const response = await fetch(`${WEB_URL}/_design`, { redirect: 'follow' });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

const evidence = baseEvidence();
const reference = inspectReferenceDir();

if (!reference.ready) {
  evidence.blockedReason = reference.reason;
  evidence.units = [];
  evidence.stateCoverage = evidence.stateCoverage.map((item) => ({
    ...item,
    status: 'pending',
    note: 'REF-01（Figma 参照集冻结）未完成；本门禁按三态退出码记阻塞，禁止以近似图判绿。',
  }));
  finish(
    evidence,
    2,
    [
      '阻塞：REF-01 未完成（Figma 参照集未冻结）。',
      `原因：${reference.reason}`,
      '待办：冻结参照集后运行本门禁逐单元取证；在此之前任何「通过」都是假绿。',
    ].join('\n'),
  );
}

const site = await probeSite();
if (!site.reachable) {
  evidence.blockedReason = `站点不可达：${WEB_URL}/_design（HTTP ${String(site.status)}）`;
  finish(
    evidence,
    2,
    [
      '阻塞：预览站点不可达（本门禁需 `/_design` 可访问）。',
      `提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），`,
      '或设置 DF_WEB_URL 指向已运行实例。',
    ].join('\n'),
  );
}

const chrome = resolveChrome();
if (chrome === undefined) {
  evidence.blockedReason = '未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）';
  finish(
    evidence,
    2,
    '阻塞：未找到 Chromium 可执行文件（研究 #5：playwright-core 需显式 executablePath）。',
  );
}

const { chromium } = await import('playwright-core');
const { PNG } = await import('pngjs');
const pixelmatch = (await import('pixelmatch')).default;

const actualDir = join(evidenceDir, 'actual');
const diffDir = join(evidenceDir, 'diff');
mkdirSync(actualDir, { recursive: true });
mkdirSync(diffDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: evidence.viewport.width, height: evidence.viewport.height },
  deviceScaleFactor: evidence.viewport.dpr,
});
const page = await context.newPage();
await page.goto(`${WEB_URL}/_design`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-df-preview]');
// 字体就绪后再取样（ADR-0003：禁止静默回退；字体未就绪的截图一律不可作判据）
await page.evaluate(() => document.fonts.ready);

const ids = await page.$$eval('[data-df-preview]', (nodes) =>
  nodes.map((node) => node.getAttribute('data-df-preview') ?? '').filter((id) => id !== ''),
);
const targets = only === undefined ? ids : ids.filter((id) => id === only);

for (const state of STATES) {
  evidence.stateCoverage = evidence.stateCoverage.map((item) =>
    item.state === state
      ? {
          ...item,
          units: ids.filter((id) => id.endsWith(`/${state}`)),
          status: 'pending',
          note: '有取样单元；待参照集冻结后逐单元出 A 级结论（缺项即缺陷）。',
        }
      : item,
  );
}

let failures = 0;
for (const id of targets) {
  const safeName = id.replaceAll('/', '_');
  const refPath = join(REF_DIR, `${safeName}.png`);
  const element = page.locator(`[data-df-preview="${id}"]`);
  const actualPath = join(actualDir, `${safeName}.png`);
  await element.screenshot({ path: actualPath, animations: 'disabled' });

  if (!existsSync(refPath)) {
    failures += 1;
    evidence.units.push({ id, status: 'missing-reference', reference: refPath });
    if (verbose) console.error(`  ✗ ${id}：参照图缺失（${basename(refPath)}）`);
    continue;
  }

  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    failures += 1;
    evidence.units.push({
      id,
      status: 'size-mismatch',
      reference: { width: refPng.width, height: refPng.height },
      actual: { width: actualPng.width, height: actualPng.height },
    });
    continue;
  }

  const diffPng = new PNG({ width: refPng.width, height: refPng.height });
  const diffPixels = pixelmatch(
    refPng.data,
    actualPng.data,
    diffPng.data,
    refPng.width,
    refPng.height,
    {
      threshold: THRESHOLD,
      includeAA: false,
    },
  );
  const total = refPng.width * refPng.height;
  const ratio = total === 0 ? 0 : diffPixels / total;
  const diffPath = join(diffDir, `${safeName}.png`);
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  const status = ratio <= maxRatio ? 'pass' : 'fail';
  if (status === 'fail') failures += 1;
  evidence.units.push({
    id,
    status,
    diff: {
      diffPixels,
      totalPixels: total,
      ratio: Number(ratio.toFixed(6)),
      bbox: bboxOfDiff(diffPng),
    },
    artifacts: {
      ref: fingerprint(refPath),
      actual: fingerprint(actualPath),
      diff: fingerprint(diffPath),
    },
  });
  if (verbose)
    console.error(`  ${status === 'pass' ? '✓' : '✗'} ${id}：差异率 ${(ratio * 100).toFixed(4)}%`);
}

await browser.close();

const code = failures === 0 ? 0 : 1;
finish(
  evidence,
  code,
  failures === 0
    ? `通过：${String(targets.length)} 个单元全部在容差内（≤ ${(maxRatio * 100).toFixed(2)}%）。`
    : `违规：${String(failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`,
);
