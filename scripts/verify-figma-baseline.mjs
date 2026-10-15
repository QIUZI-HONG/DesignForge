#!/usr/bin/env node
/**
 * verify-figma-baseline —— 参照集**冻结元数据**门禁（收尾补族；本票范围内自管，**不接 CI**）。
 *
 * 职责（《前端验收标准 v1》§1.2 + §4.1：参照集逐页冻结——版本号 + 日期 + 截图哈希）：
 *   1. 校验 `<DF_REF_DIR>/baseline.json` 的冻结契约：`version` / `frozenAt` / `viewport` / `theme`
 *      （集合级）+ 每图 `sha256` / `theme` / `state`（逐图级）；
 *   2. 对**存在**的参照 PNG 重算 sha256，与元数据逐图核对（防「冻结后被悄悄换图」）。
 *
 * 元数据契约（REF-01 冻结时按此落盘；`--emit` 可从现成 PNG 直接生成）：
 *   {
 *     "version": "<参照集版本号，如 figma-v1>",
 *     "frozenAt": "<YYYY-MM-DD>",
 *     "viewport": { "width": 1440, "height": 900, "dpr": 1.5 },
 *     "theme": "light | dark（集合级缺省；逐图可覆盖）",
 *     "images": [
 *       { "file": "figma-C-C8-canvas-dark-default.png",
 *         "theme": "dark", "state": "default", "sha256": "<64 位十六进制>" }
 *     ]
 *   }
 *
 * 退出码（门禁三态，**禁止假绿**）：
 *   0 = 元数据齐备且全部哈希相符；
 *   1 = **违规**——元数据齐备，但有图哈希不符（冻结后被换）或元数据自身不一致；
 *   2 = **阻塞**——参照集目录/元数据缺失，或元数据字段不全（版本/日期/视口/逐图 sha256）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-figma-baseline.mjs                # 默认 ~/df-evidence/reference-v1
 *   DF_REF_DIR=/path/to/reference-v1 node scripts/verify-figma-baseline.mjs --verbose
 *   node scripts/verify-figma-baseline.mjs --emit         # 由现成 PNG 生成 baseline.json（REF-01 用）
 *   node scripts/verify-figma-baseline.mjs --self-test    # 自测夹具（验辨别力：2/1/0 三态）
 *
 * 环境变量：DF_REF_DIR（参照集根）、DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）。
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const EVIDENCE_DIR = join(EVIDENCE_ROOT, 'ref-01');
const META_NAME = 'baseline.json';
/** 验收标准 §3 主基准视口（元数据逐项对照）。 */
const EXPECTED_VIEWPORT = { width: 1440, height: 900, dpr: 1.5 };
const THEMES = ['light', 'dark'];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const emit = args.includes('--emit');
const selfTestMode = args.includes('--self-test');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const refDir = resolve(flagValue('--refs') ?? REF_DIR);

/** 文件 sha256（十六进制小写）。 */
function sha256Of(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** 列出参照集根下的 PNG（根目录直放；子目录由 panels/review/shell 各自门禁管）。 */
function listPngs(dir) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith('.png'))
        .sort()
    : [];
}

/** 布尔完整性判定（缺项即「元数据不全」→ 阻塞，而不是放行）。 */
function metadataProblems(meta) {
  const problems = [];
  if (typeof meta.version !== 'string' || meta.version.trim() === '')
    problems.push('缺 version（参照集版本号）');
  if (typeof meta.frozenAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.frozenAt))
    problems.push('缺 frozenAt（冻结日期 YYYY-MM-DD）');
  const viewport = meta.viewport;
  if (viewport === null || typeof viewport !== 'object') {
    problems.push('缺 viewport（视口字段）');
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_VIEWPORT)) {
      if (viewport[key] !== expected)
        problems.push(`viewport.${key} 应为 ${String(expected)}（实测 ${String(viewport[key])}）`);
    }
  }
  const collectionTheme = typeof meta.theme === 'string' ? meta.theme : null;
  if (collectionTheme !== null && !THEMES.includes(collectionTheme))
    problems.push(`theme 取值非法：${collectionTheme}（应为 light/dark）`);
  if (!Array.isArray(meta.images) || meta.images.length === 0) {
    problems.push('缺 images（逐图条目数组）');
  } else {
    meta.images.forEach((entry, index) => {
      const label = `images[${String(index)}]`;
      if (entry === null || typeof entry !== 'object') {
        problems.push(`${label} 不是对象`);
        return;
      }
      if (typeof entry.file !== 'string' || !entry.file.toLowerCase().endsWith('.png'))
        problems.push(`${label} 缺 file（PNG 文件名）`);
      if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256))
        problems.push(`${label}（${String(entry.file)}）缺合法 sha256`);
      const theme = typeof entry.theme === 'string' ? entry.theme : collectionTheme;
      if (theme === null || !THEMES.includes(theme))
        problems.push(`${label}（${String(entry.file)}）缺 theme（light/dark）`);
      if (typeof entry.state !== 'string' || entry.state.trim() === '')
        problems.push(`${label}（${String(entry.file)}）缺 state（状态名）`);
    });
  }
  return problems;
}

/**
 * 校验一份参照集目录（纯函数，供 CLI 与自测共用）。不写证据、不退出——由调用方决定出口。
 *
 * @param {string} dir 参照集根目录
 * @returns {{ code: 0 | 1 | 2, summary: string, problems: string[], mismatches: string[], missing: string[], extra: string[], checked: number, total: number }}
 */
export function verifyBaseline(dir) {
  const metaPath = join(dir, META_NAME);
  if (!existsSync(dir)) {
    return {
      code: 2,
      summary: `参照集目录不存在：${dir}`,
      problems: [`缺目录 ${dir}`],
      mismatches: [],
      missing: [],
      extra: [],
      checked: 0,
      total: 0,
    };
  }
  if (!existsSync(metaPath)) {
    return {
      code: 2,
      summary: `冻结元数据缺失：${metaPath}（参照集未按契约冻结）`,
      problems: [`缺 ${META_NAME}`],
      mismatches: [],
      missing: [],
      extra: [],
      checked: 0,
      total: 0,
    };
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (error) {
    return {
      code: 2,
      summary: `冻结元数据不是合法 JSON：${String(error)}`,
      problems: ['JSON 解析失败'],
      mismatches: [],
      missing: [],
      extra: [],
      checked: 0,
      total: 0,
    };
  }
  const problems = metadataProblems(meta);
  if (problems.length > 0) {
    return {
      code: 2,
      summary: `冻结元数据不全（${String(problems.length)} 项）：${problems.slice(0, 3).join('；')}`,
      problems,
      mismatches: [],
      missing: [],
      extra: [],
      checked: 0,
      total: Array.isArray(meta?.images) ? meta.images.length : 0,
    };
  }

  const entries = meta.images;
  const declared = new Set(entries.map((entry) => entry.file));
  const onDisk = listPngs(dir);
  const missing = [...declared].filter((file) => !onDisk.includes(file)).sort();
  const extra = onDisk.filter((file) => !declared.has(file));
  const mismatches = [];
  let checked = 0;
  for (const entry of entries) {
    const filePath = join(dir, entry.file);
    if (!existsSync(filePath)) continue; // 已在 missing 记账
    const actual = sha256Of(filePath);
    checked += 1;
    if (actual !== entry.sha256)
      mismatches.push(`${entry.file}（元数据 ${entry.sha256} vs 实际 ${actual}）`);
  }

  const base = { problems: [], mismatches, missing, extra, checked, total: entries.length };
  if (missing.length > 0) {
    return {
      ...base,
      code: 2,
      summary: `冻结元数据声明 ${String(missing.length)} 张图不在盘上（元数据不全）：${missing.slice(0, 3).join('、')}`,
    };
  }
  if (mismatches.length > 0) {
    return {
      ...base,
      code: 1,
      summary: `哈希不符 ${String(mismatches.length)} 张（冻结后被换图）：${mismatches.slice(0, 3).join('；')}`,
    };
  }
  return {
    ...base,
    code: 0,
    summary: `全部相符：${String(checked)}/${String(entries.length)} 张图哈希与冻结元数据一致（version=${meta.version}，frozenAt=${meta.frozenAt}）`,
  };
}

/** `--emit`：由现成 PNG 生成 baseline.json（REF-01 采集会话用；不覆盖已存在的元数据）。 */
function emitBaseline(dir) {
  const metaPath = join(dir, META_NAME);
  if (existsSync(metaPath)) {
    console.error(`拒绝覆盖已有元数据：${metaPath}（人工确认后先删旧文件再 --emit）`);
    return 2;
  }
  const pngs = listPngs(dir);
  if (pngs.length === 0) {
    console.error(`目录里没有 PNG，无法生成元数据：${dir}`);
    return 2;
  }
  const images = pngs.map((file) => ({
    file,
    // 命名规范 figma-<区段>-<ID>-<名称>-<主题>-<状态>.png：从文件名提取主题/状态
    theme: file.includes('-dark-') ? 'dark' : 'light',
    state:
      file
        .replace(/\.png$/, '')
        .split('-')
        .pop() ?? 'default',
    sha256: sha256Of(join(dir, file)),
  }));
  const meta = {
    version: `figma-${new Date().toISOString().slice(0, 10)}`,
    frozenAt: new Date().toISOString().slice(0, 10),
    viewport: { ...EXPECTED_VIEWPORT },
    images,
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.error(
    `已生成 ${metaPath}（${String(images.length)} 张；version/frozenAt 请人工核对——REF-01 会话签字后才算冻结）`,
  );
  return 0;
}

/** 自测夹具：证明门禁有辨别力（缺集/元数据不全 → 2；哈希不符 → 1；全对 → 0）。 */
export function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'df-baseline-selftest-'));
  const cases = [];
  /** 造一张 2×2 PNG（手写最小 PNG 字节，避免依赖 pngjs 之外的东西）。 */
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000020806000000f478d4fa0000000e4944415478' +
      '9c6360000002000154a24f5f0000000049454e44ae426082',
    'hex',
  );
  const writePng = (name) => writeFileSync(join(root, name), pngBytes);
  const wrap = (images, overrides = {}) => ({
    version: 'figma-v1',
    frozenAt: '2026-10-15',
    viewport: { width: 1440, height: 900, dpr: 1.5 },
    images,
    ...overrides,
  });
  const goodEntry = {
    file: 'figma-B-home-light-default.png',
    theme: 'light',
    state: 'default',
    sha256: createHash('sha256').update(pngBytes).digest('hex'),
  };

  // 1) 目录不存在 → 2
  cases.push(['缺参照集目录', verifyBaseline(join(root, 'nope')).code, 2]);
  // 2) 目录在、元数据缺 → 2
  mkdirSync(join(root, 'no-meta'), { recursive: true });
  cases.push(['缺元数据', verifyBaseline(join(root, 'no-meta')).code, 2]);
  // 3) 元数据字段不全（缺 sha256）→ 2
  mkdirSync(join(root, 'partial'), { recursive: true });
  writeFileSync(
    join(root, 'partial', META_NAME),
    JSON.stringify(wrap([{ file: 'a.png', theme: 'light', state: 'default' }])),
  );
  cases.push(['元数据不全', verifyBaseline(join(root, 'partial')).code, 2]);
  // 4) 元数据齐但哈希不符 → 1
  mkdirSync(join(root, 'mismatch'), { recursive: true });
  writePng(join('mismatch', 'figma-B-home-light-default.png'));
  writeFileSync(
    join(root, 'mismatch', META_NAME),
    JSON.stringify(wrap([{ ...goodEntry, sha256: '0'.repeat(64) }])),
  );
  cases.push(['哈希不符', verifyBaseline(join(root, 'mismatch')).code, 1]);
  // 5) 元数据齐、声明图缺盘 → 2
  mkdirSync(join(root, 'missing-image'), { recursive: true });
  writeFileSync(join(root, 'missing-image', META_NAME), JSON.stringify(wrap([goodEntry])));
  cases.push(['声明图缺盘', verifyBaseline(join(root, 'missing-image')).code, 2]);
  // 6) 全对 → 0
  mkdirSync(join(root, 'ok'), { recursive: true });
  writePng(join('ok', 'figma-B-home-light-default.png'));
  writeFileSync(join(root, 'ok', META_NAME), JSON.stringify(wrap([goodEntry])));
  cases.push(['全对', verifyBaseline(join(root, 'ok')).code, 0]);

  rmSync(root, { recursive: true, force: true });
  const failed = cases.filter(([, actual, expected]) => actual !== expected);
  for (const [name, actual, expected] of cases) {
    console.error(
      `  ${actual === expected ? '✓' : '✗'} ${name}：exit ${String(actual)}（期望 ${String(expected)}）`,
    );
  }
  return { ok: failed.length === 0, total: cases.length, failed: failed.length };
}

/** 落盘证据（与各 verify-* 同口径：字段依验收标准 §4，阻塞也落盘）。 */
function writeEvidence(result) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = join(
    EVIDENCE_DIR,
    `verify-figma-baseline-${new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')}.json`,
  );
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        ticket: 'REF-01',
        gate: 'verify-figma-baseline',
        page: '（参照集全量冻结元数据）',
        level: 'A（哈希与字段完整性；不含像素判定）',
        referenceDir: refDir,
        metadata: join(refDir, META_NAME),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ...result,
        artifacts: { ref: null, actual: null, diff: null },
        humanReview: {
          verdict: 'pending',
          reviewer: null,
          reason: '冻结元数据由 REF-01 采集会话签字',
        },
        exitCode: result.code,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return evidencePath;
}

function main() {
  if (selfTestMode) {
    const result = selfTest();
    console.error(
      result.ok
        ? `自测通过：${String(result.total)} 例（辨别力：缺集/元数据不全 → 2、哈希不符 → 1、全对 → 0）`
        : `自测失败：${String(result.failed)}/${String(result.total)} 例`,
    );
    return result.ok ? 0 : 1;
  }
  if (emit) return emitBaseline(refDir);

  // 硬自证：每次实跑先验辨别力（缺集/元数据不全 → 2，哈希不符 → 1，全对 → 0）；
  // 自测失败 = 门禁自身坏了，按违规退出（绝不带着坏门禁去判参照集）。
  const gate = selfTest();
  if (!gate.ok) {
    console.error(
      `门禁自测未通过（${String(gate.failed)}/${String(gate.total)} 例）——本门禁此刻不可信。`,
    );
    return 1;
  }

  const result = verifyBaseline(refDir);
  const evidencePath = writeEvidence(result);
  if (result.code === 2) {
    console.error(
      [
        `阻塞：参照集未冻结（元数据不全）——不得据此出任何对照结论。`,
        `原因：${result.summary}`,
        `证据：${evidencePath}`,
        `待办：REF-01 冻结时按契约落盘 ${join(refDir, META_NAME)}（可用 --emit 生成初稿）。`,
      ].join('\n'),
    );
    return 2;
  }
  if (result.code === 1) {
    console.error(
      [
        `违规：参照集与冻结元数据不一致——冻结后不得更换（验收标准 §1.2）。`,
        `明细：${result.summary}`,
        `证据：${evidencePath}`,
      ].join('\n'),
    );
    return 1;
  }
  console.error(`通过：${result.summary}`);
  if (verbose) {
    if (result.extra.length > 0)
      console.error(
        `  提示：${String(result.extra.length)} 张图未登记进元数据（不判违规，仅提示）`,
      );
    console.error(`  证据：${evidencePath}`);
  }
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) process.exit(main());
