#!/usr/bin/env node
/**
 * MK-03 评分 CLI（独立可跑，规格《市场首实现》§2.2；无网络、无时钟依赖）。
 *
 * 用法（经 Node 原生 TS 类型擦除直跑）：
 * ```
 * node services/ingest/src/score/cli.ts --sample --out ~/df-evidence/mk-03
 * node services/ingest/src/score/cli.ts --dwd <DWD JSONL> --as-of <ISO> [--out <dir>] [--run-id <id>]
 * ```
 * 退出码（规格 §6.1）：0 通过 / 1 断言失败 / 2 阻塞（输入缺失或不合契约）——禁止假绿。
 * 确定性（规格 §4.3.2）：`asOf` 必须注入（--sample 用夹具固定时点）；同输入 → 同产物字节。
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AS_OF as SAMPLE_AS_OF } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';
import { REASON_TEXT } from './codes.ts';
import { DwdShapeError, normalizeDwdAsset, validateDwdAsset } from './dwd.ts';
import {
  DWS_COLLECTOR,
  dwsJsonl,
  sha256Hex,
  validateDwsRecord,
  writeDwsJsonl,
  writeJsonFile,
} from './dws.ts';
import type { EvidenceAssertion, EvidenceStep } from './evidence.ts';
import { buildEvidence } from './evidence.ts';
import { type AssetQualityRecord, DIM_WEIGHTS, DIMENSIONS, type DwdAsset } from './types.ts';

export interface CliOptions {
  sample: boolean;
  dwdPath: string | null;
  asOf: string | null;
  outDir: string;
  runId: string | null;
  help: boolean;
}

/** CLI 用法错误（参数不对，非断言失败）。 */
export class CliUsageError extends Error {}

/** 默认输出目录：`~/df-evidence/mk-03`（产物出库，测试夹具才入库）。 */
export function defaultOutDir(): string {
  return join(homedir(), 'df-evidence', 'mk-03');
}

/** 由 asOf 生成 runId（`score-YYYYMMDD`；确定性，不含时钟）。 */
export function runIdOf(asOf: string): string {
  return `score-${asOf.slice(0, 10).replace(/-/g, '')}`;
}

export const USAGE = `MK-03 五维评分（DWS）

用法：
  node services/ingest/src/score/cli.ts [选项]

选项：
  --sample            用内置样本集跑（四类各 1 + 边界 2；离线、确定性）
  --dwd <文件>        DWD JSONL 输入（每条 = 一个资产的 DWD 记录；与 --sample 二选一）
  --as-of <ISO>       批次时点（必填注入；--sample 缺省用夹具固定时点）
  --out <dir>         输出目录（默认 ~/df-evidence/mk-03）
  --run-id <id>       批次 id（默认由 asOf 生成）
  --help              本帮助

退出码：0 通过 / 1 断言失败 / 2 阻塞（输入缺失或不合契约）。`;

/** 解析命令行（抛出 CliUsageError = 参数错误）。 */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    sample: false,
    dwdPath: null,
    asOf: null,
    outDir: defaultOutDir(),
    runId: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (): string => {
      i += 1;
      const next = argv[i];
      if (next === undefined) throw new CliUsageError(`选项 ${String(arg)} 缺参数`);
      return next;
    };
    if (arg === '--sample') opts.sample = true;
    else if (arg === '--dwd') opts.dwdPath = value();
    else if (arg === '--as-of') opts.asOf = value();
    else if (arg === '--out') opts.outDir = value();
    else if (arg === '--run-id') opts.runId = value();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new CliUsageError(`未知选项：${String(arg)}`);
  }
  if (opts.sample && opts.dwdPath !== null) throw new CliUsageError('--sample 与 --dwd 不能同时给');
  return opts;
}

/** 读 DWD JSONL（空行跳过；非 JSON 行即抛）。 */
export function parseDwdJsonl(text: string): unknown[] {
  const records: unknown[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      throw new DwdShapeError([`第 ${index + 1} 行不是合法 JSON`]);
    }
  }
  return records;
}

/** 断言构造小工具（证据 JSON 口径）。 */
function assert(name: string, ok: boolean, expected: string, actual: string): EvidenceAssertion {
  return { name, expected, actual, ok };
}

/**
 * 跑一批评分并组装判据步骤（纯函数：不落盘、不打日志——CLI 与验证脚本共用）。
 */
export function evaluate(
  inputs: readonly DwdAsset[],
  asOf: string,
): { records: AssetQualityRecord[]; steps: EvidenceStep[] } {
  const first = scoreBatch(inputs, { asOf });
  const second = scoreBatch(inputs, { asOf });
  const records = first.records;
  const jsonlFirst = dwsJsonl(first.records);
  const jsonlSecond = dwsJsonl(second.records);

  // —— 输入契约：对**实际进入评分的对象**再验一遍（样本与归一化产物同标准）——
  const inputIssues = inputs.flatMap((input, index) =>
    validateDwdAsset(input).map((issue) => `#${index + 1} ${issue}`),
  );

  // —— 产物自证：记录校验含「总分与维度分互证」——
  const recordIssues = records.flatMap((r) =>
    validateDwsRecord(r).map((issue) => `${r.assetId}: ${issue}`),
  );

  const weightOk =
    DIM_WEIGHTS.spec === 0.25 &&
    DIM_WEIGHTS.maintenance === 0.2 &&
    DIM_WEIGHTS.docs === 0.2 &&
    DIM_WEIGHTS.security === 0.2 &&
    DIM_WEIGHTS.ecosystem === 0.15;
  const weightSum = DIMENSIONS.reduce((sum, key) => sum + DIM_WEIGHTS[key], 0);

  // —— 可解释输出（规格 §5.3）——
  const explainIssues: string[] = [];
  let signalCount = 0;
  let deductionCount = 0;
  for (const record of records) {
    for (const dim of DIMENSIONS) {
      const entry = record.explain[dim];
      if (entry.signals.length === 0)
        explainIssues.push(`${record.assetId}: explain.${dim} 无信号明细`);
      for (const d of entry.deductions) {
        deductionCount += 1;
        if (!Object.hasOwn(REASON_TEXT, d.code))
          explainIssues.push(`${record.assetId}: 码 ${d.code} 不在词表`);
        if (d.code === 'L1' && d.delta !== 0)
          explainIssues.push(`${record.assetId}: L1 出现正扣分 ${d.delta}（应恒 0）`);
      }
      signalCount += entry.signals.length;
    }
  }
  const issueOf = (keyword: string): string =>
    explainIssues
      .filter((i) => i.includes(keyword))
      .slice(0, 3)
      .join(' / ') || 'ok';

  // —— 冷启动与许可守门（规格 §5.4）——
  const boundaryIssues: string[] = [];
  inputs.forEach((input, index) => {
    const record = records[index];
    if (record === undefined) return;
    if (record.flags.coldStart && record.dims.ecosystem !== null)
      boundaryIssues.push(`${record.assetId}: 冷启动但生态热度非空`);
    if (record.flags.archived && (record.dims.maintenance ?? 0) > 0.3)
      boundaryIssues.push(
        `${record.assetId}: 归档仓维护活跃未封顶（${String(record.dims.maintenance)}）`,
      );
    if (input.license.gate !== 'loadable') {
      const penalty = record.explain.security.deductions.find((d) => d.delta > 0);
      if (penalty !== undefined)
        boundaryIssues.push(
          `${record.assetId}: 非可装载许可却扣安全分（${penalty.code} ${String(penalty.delta)}）`,
        );
    }
  });
  const boundaryOf = (keyword: string): string =>
    boundaryIssues
      .filter((i) => i.includes(keyword))
      .slice(0, 3)
      .join(' / ') || 'ok';

  const steps: EvidenceStep[] = [
    {
      id: 'dwd-input',
      name: 'DWD 输入契约',
      verdict: 'pass',
      assertions: [
        assert('记录数 > 0', inputs.length > 0, '>0', String(inputs.length)),
        assert(
          '必填字段齐（asset/repo/license/files/text）',
          inputIssues.length === 0,
          '0 问题',
          inputIssues.slice(0, 3).join(' / ') || '0 问题',
        ),
      ],
      artifacts: [],
      metrics: { records: inputs.length },
    },
    {
      id: 'dws-scoring',
      name: '五维评分与总分',
      verdict: 'pass',
      assertions: [
        assert(
          'DWS 记录全过校验（含总分与维度分互证）',
          recordIssues.length === 0,
          '0 问题',
          recordIssues.slice(0, 3).join(' / ') || '0 问题',
        ),
        assert(
          '权重 = .25/.20/.20/.20/.15（规格 §5.1）',
          weightOk,
          '规格值',
          JSON.stringify(DIM_WEIGHTS),
        ),
        assert('权重和 = 1', Math.abs(weightSum - 1) < 1e-9, '1', String(weightSum)),
        assert(
          '记录数 = 输入数',
          records.length === inputs.length,
          String(inputs.length),
          String(records.length),
        ),
      ],
      artifacts: [],
      metrics: {
        records: records.length,
        fullyScored: first.summary.fullyScored,
        coldStart: first.summary.coldStart,
        nonCompliant: first.summary.nonCompliant,
      },
    },
    {
      id: 'explain-completeness',
      name: '可解释输出（规格 §5.3）',
      verdict: 'pass',
      assertions: [
        assert(
          '每维均有信号明细',
          explainIssues.every((i) => !i.includes('无信号明细')),
          '五维齐',
          issueOf('无信号明细'),
        ),
        assert(
          '扣分码全部在词表内',
          explainIssues.every((i) => !i.includes('不在词表')),
          '词表内',
          issueOf('不在词表'),
        ),
        assert(
          'L1 恒不扣分（delta 0）',
          explainIssues.every((i) => !i.includes('L1')),
          'delta=0',
          issueOf('L1'),
        ),
      ],
      artifacts: [],
      metrics: { records: records.length, signals: signalCount, deductions: deductionCount },
    },
    {
      id: 'boundaries',
      name: '冷启动与许可守门口径（规格 §5.4）',
      verdict: 'pass',
      assertions: [
        assert(
          '冷启动 → 生态热度空心',
          boundaryIssues.every((i) => !i.includes('生态热度非空')),
          'null',
          boundaryOf('生态热度非空'),
        ),
        assert(
          '归档仓维护活跃 ≤0.3',
          boundaryIssues.every((i) => !i.includes('未封顶')),
          '≤0.3',
          boundaryOf('未封顶'),
        ),
        assert(
          '非可装载许可不扣安全分（走 L1/守门）',
          boundaryIssues.every((i) => !i.includes('扣安全分')),
          '无正扣分',
          boundaryOf('扣安全分'),
        ),
      ],
      artifacts: [],
      metrics: { coldStart: first.summary.coldStart, archived: first.summary.archived },
    },
    {
      id: 'determinism',
      name: '确定性（两遍逐字节一致）',
      verdict: 'pass',
      assertions: [
        assert(
          '同输入两次评分 JSONL 逐字节一致',
          jsonlFirst === jsonlSecond,
          '一致',
          jsonlFirst === jsonlSecond ? '一致' : '不一致',
        ),
        assert(
          'sha256 一致',
          sha256Hex(jsonlFirst) === sha256Hex(jsonlSecond),
          '相同',
          sha256Hex(jsonlFirst) === sha256Hex(jsonlSecond) ? '相同' : '不同',
        ),
      ],
      artifacts: [],
      metrics: { sha256: sha256Hex(jsonlFirst), bytes: Buffer.byteLength(jsonlFirst, 'utf8') },
    },
  ];

  return { records, steps };
}

/** CLI 入口：跑分 → 落盘 → 证据 JSON；返回退出码。 */
export function main(argv: string[]): number {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const asOf = opts.asOf ?? (opts.sample ? SAMPLE_AS_OF : null);
  if (asOf === null) {
    console.error('阻塞：--dwd 模式必须显式注入 --as-of（确定性纪律，规格 §4.3.2）。exit 2');
    return 2;
  }
  const runId = opts.runId ?? runIdOf(asOf);

  // —— 输入 ——
  let inputs: DwdAsset[];
  if (opts.sample) {
    inputs = SAMPLE_DWD;
  } else if (opts.dwdPath !== null) {
    let raw: unknown[];
    try {
      raw = parseDwdJsonl(readFileSync(opts.dwdPath, 'utf8'));
    } catch (error) {
      console.error(
        `阻塞：读 DWD 失败（${opts.dwdPath}）：${error instanceof Error ? error.message : String(error)}`,
      );
      console.error('exit 2');
      return 2;
    }
    const issues = raw.flatMap((record, index) =>
      validateDwdAsset(record).map((issue) => `#${index + 1} ${issue}`),
    );
    if (issues.length > 0) {
      console.error(`阻塞：DWD 不合评分契约（${opts.dwdPath}）——先修上游产物。`);
      for (const issue of issues.slice(0, 20)) console.error(`  ✗ ${issue}`);
      console.error('exit 2（阻塞：依赖产物不可用——禁止假绿）');
      return 2;
    }
    inputs = raw.map((record) => normalizeDwdAsset(record));
  } else {
    console.error(`阻塞：未指定输入（--sample 或 --dwd <文件>）。\n\n${USAGE}`);
    return 2;
  }

  // —— 评分与判据 ——
  const { records, steps } = evaluate(inputs, asOf);

  // —— 落盘：DWS JSONL + 证据 JSON（先写产物，产物信息进证据 step）——
  const dwsArtifact = writeDwsJsonl(join(opts.outDir, 'dws', 'asset_quality.jsonl'), records);
  const outputStep: EvidenceStep = {
    id: 'dws-output',
    name: 'DWS 层产物与证据互证',
    verdict: 'pass',
    assertions: [
      assert(
        '记录数 = 输入数',
        records.length === inputs.length,
        String(inputs.length),
        String(records.length),
      ),
      assert(
        '产物 sha256 与内存内容互证',
        dwsArtifact.sha256 === sha256Hex(`${dwsJsonl(records)}\n`),
        dwsArtifact.sha256,
        sha256Hex(`${dwsJsonl(records)}\n`),
      ),
    ],
    artifacts: [dwsArtifact],
    metrics: { records: records.length },
  };

  const evidence = buildEvidence({
    runId,
    asOf,
    offline: true,
    collector: DWS_COLLECTOR,
    steps: [...steps, outputStep],
  });
  const evidenceArtifact = writeJsonFile(join(opts.outDir, 'evidence', `${runId}.json`), evidence);

  // —— 汇报（证据即报告：逐 step 逐断言）——
  console.log(`MK-03 评分（runId=${runId}，asOf=${asOf}，输入 ${inputs.length} 条）`);
  for (const step of evidence.steps) {
    console.log(`  [${step.verdict}] ${step.id} — ${step.name}`);
    for (const a of step.assertions) {
      console.log(`      ${a.ok ? '✓' : '✗'} ${a.name}（期望 ${a.expected} / 实际 ${a.actual}）`);
    }
  }
  console.log(
    `  DWS：${dwsArtifact.path}（sha256 ${dwsArtifact.sha256.slice(0, 16)}…，${dwsArtifact.length} 字节）`,
  );
  console.log(
    `  证据：${evidenceArtifact.path}（sha256 ${evidenceArtifact.sha256.slice(0, 16)}…）`,
  );
  console.log(`exit ${evidence.exitCode}`);
  return evidence.exitCode;
}

// 直跑入口（被 import 时不执行）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
