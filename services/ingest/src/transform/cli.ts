#!/usr/bin/env node
/**
 * MK-02 规整与四层仓 CLI（独立可跑；规格《市场首实现》§2.2 形态，命令前缀留给 MK-05 的 `df market`）。
 *
 * 用法（经 Node 原生 TS 类型擦除直跑）：
 * ```
 * node services/ingest/src/transform/cli.ts ods     --source <MK-01 产物根> --out <data/ods>
 * node services/ingest/src/transform/cli.ts dwd     --ods <data/ods> --out <data/dwd> [--asOf <ISO>]
 * node services/ingest/src/transform/cli.ts rebuild --data <dataRoot> [--asOf <ISO>]
 * node services/ingest/src/transform/cli.ts validate --ods <data/ods> [--dwd <data/dwd>]
 * ```
 * 退出码（规格 §6.1，禁止假绿）：0 通过 / 1 断言失败（有数据但校验不过） / 2 阻塞（无输入、不可读）。
 * stdout 输出一行 JSON 摘要（供门禁脚本与证据 JSON 复用）；诊断走 stderr。
 */

import { pathToFileURL } from 'node:url';

import { buildDwd } from './dwd/build.ts';
import { readDwd } from './dwd/store.ts';
import { validateDwd } from './dwd/validate.ts';
import { materializeOds } from './ods/materialize.ts';
import { readOds, readOdsSource } from './ods/read.ts';
import { rebuildDwd } from './rebuild.ts';

export interface CliOutcome {
  command: string;
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  problems: { path: string; rule: string; detail: string }[];
}

class UsageError extends Error {}

function parseFlags(argv: string[], allowed: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) throw new UsageError(`未知位置参数：${arg}`);
    const name = arg.slice(2);
    if (!allowed.includes(name)) throw new UsageError(`未知参数：${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`参数 ${arg} 缺值`);
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

/** 规整 ODS（MK-01 形状 → 规格 §4.1 形状）。 */
async function runOds(flags: Map<string, string>): Promise<CliOutcome> {
  const source = flags.get('source');
  const out = flags.get('out');
  if (source === undefined || out === undefined) {
    throw new UsageError('ods 需要 --source <MK-01 产物根> 与 --out <data/ods>');
  }
  const result = await materializeOds({ source, out });
  const blocking = result.issues.filter((issue) =>
    ['snapshot-parse', 'files-listing-missing', 'blob-corrupt'].includes(issue.rule),
  );
  const exitCode: 0 | 1 | 2 = blocking.length > 0 ? 1 : 0;
  return {
    command: 'ods',
    exitCode,
    summary: {
      odsRoot: result.odsRoot,
      events: result.eventFiles.length,
      snapshots: result.snapshotFiles.length,
      blobs: result.blobFiles.length,
      blobsWritten: result.blobsWritten,
      blobsDeduped: result.blobsDeduped,
      filesWritten: result.filesWritten,
      filesSkipped: result.filesSkipped,
      conflicts: result.conflicts.length,
      sources: result.sources.length,
      artifacts: result.artifacts.length,
    },
    problems: result.issues,
  };
}

/** 构建 DWD（DWD = f(ODS)）。 */
async function runDwd(flags: Map<string, string>): Promise<CliOutcome> {
  const odsRoot = flags.get('ods');
  const out = flags.get('out');
  if (odsRoot === undefined || out === undefined) {
    throw new UsageError('dwd 需要 --ods <data/ods> 与 --out <data/dwd>');
  }
  const result = await buildDwd(
    flags.has('asOf') ? { odsRoot, out, asOf: flags.get('asOf') ?? '' } : { odsRoot, out },
  );
  return {
    command: 'dwd',
    exitCode: result.issues.length > 0 ? 1 : 0,
    summary: {
      odsRoot,
      dwdRoot: out,
      asOf: result.manifest.asOf,
      rows: Object.fromEntries(result.manifest.tables.map((table) => [table.name, table.rows])),
      tables: result.manifest.tables.map((table) => ({
        name: table.name,
        sha256: table.sha256,
        length: table.length,
      })),
      clusters: result.manifest.clusters,
      manifestPath: result.manifestPath,
    },
    problems: result.issues,
  };
}

/** 重建 DWD（删 DWD → 从 ODS 重跑 → 比对）。 */
async function runRebuild(flags: Map<string, string>): Promise<CliOutcome> {
  const dataRoot = flags.get('data');
  if (dataRoot === undefined)
    throw new UsageError('rebuild 需要 --data <dataRoot>（含 ods/ 与 dwd/）');
  const result = await rebuildDwd(
    flags.has('asOf') ? { dataRoot, asOf: flags.get('asOf') ?? '' } : { dataRoot },
  );
  return {
    command: 'rebuild',
    exitCode: result.consistent ? 0 : 1,
    summary: {
      dataRoot,
      consistent: result.consistent,
      before: result.before,
      after: result.after,
      rows: Object.fromEntries(result.manifest.tables.map((table) => [table.name, table.rows])),
    },
    problems: result.differences.map((detail) => ({
      path: dataRoot,
      rule: 'rebuild-diff',
      detail,
    })),
  };
}

/** 校验 ODS 与（可选）DWD 层。 */
async function runValidate(flags: Map<string, string>): Promise<CliOutcome> {
  const odsRoot = flags.get('ods');
  if (odsRoot === undefined) throw new UsageError('validate 需要 --ods <data/ods>（--dwd 可选）');
  const problems: { path: string; rule: string; detail: string }[] = [];
  const bundle = await readOds(odsRoot);
  problems.push(...bundle.issues);
  const summary: Record<string, unknown> = {
    odsRoot,
    records: bundle.records.length,
    snapshots: bundle.snapshots.length,
    events: bundle.events.length,
    blobs: bundle.blobs.size,
  };
  const dwdRoot = flags.get('dwd');
  if (dwdRoot !== undefined) {
    const tables = await readDwd(dwdRoot);
    problems.push(...validateDwd(tables));
    summary.dwd = {
      repo: tables.repo.length,
      asset: tables.asset.length,
      asset_file: tables.asset_file.length,
      license: tables.license.length,
    };
  }
  return { command: 'validate', exitCode: problems.length > 0 ? 1 : 0, summary, problems };
}

/** 只读探测：ODS 源是否可读（用于门禁区分「阻塞」与「失败」）。 */
async function probeSource(source: string): Promise<void> {
  await readOdsSource(source);
}

/** 执行 CLI；返回退出码（便于测试与门禁脚本复用）。 */
export async function runTransformCli(argv: string[]): Promise<CliOutcome> {
  const command = argv[0] ?? 'help';
  const rest = argv.slice(1);
  try {
    if (command === 'help' || command === '--help') {
      return {
        command: 'help',
        exitCode: 0,
        summary: {
          usage: [
            'ods --source <MK-01 产物根> --out <data/ods>',
            'dwd --ods <data/ods> --out <data/dwd> [--asOf <ISO>]',
            'rebuild --data <dataRoot> [--asOf <ISO>]',
            'validate --ods <data/ods> [--dwd <data/dwd>]',
          ],
        },
        problems: [],
      };
    }
    if (command === 'ods') {
      const flags = parseFlags(rest, ['source', 'out']);
      const source = flags.get('source');
      if (source !== undefined) await probeSource(source);
      return await runOds(flags);
    }
    if (command === 'dwd') return await runDwd(parseFlags(rest, ['ods', 'out', 'asOf']));
    if (command === 'rebuild') return await runRebuild(parseFlags(rest, ['data', 'asOf']));
    if (command === 'validate') return await runValidate(parseFlags(rest, ['ods', 'dwd']));
    throw new UsageError(`未知子命令：${command}`);
  } catch (error) {
    // 输入缺失/不可读 → 阻塞（2）；用法错误与数据问题 → 失败（1）
    const detail = (error as Error).message;
    const blocked = !(error instanceof UsageError);
    return {
      command,
      exitCode: blocked ? 2 : 1,
      summary: { blocked },
      problems: [{ path: argv.join(' '), rule: blocked ? 'blocked' : 'usage', detail }],
    };
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const outcome = await runTransformCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.problems.length > 0) {
    for (const problem of outcome.problems.slice(0, 20)) {
      process.stderr.write(`  - [${problem.rule}] ${problem.path}：${problem.detail}\n`);
    }
    if (outcome.problems.length > 20) {
      process.stderr.write(`  … 另有 ${outcome.problems.length - 20} 条问题\n`);
    }
  }
  process.exit(outcome.exitCode);
}
