#!/usr/bin/env node
/**
 * MK-01 采集器 CLI（独立可跑，不依赖编辑器/桌面壳；规格《市场首实现》§2.2）。
 *
 * 用法（经 Node 原生 TS 类型擦除直跑）：
 * ```
 * node services/ingest/src/collect/cli.ts --limit 5 --seeds anthropics/skills,nexu-io/open-design \
 *   --topics agent-skill --out ~/df-evidence/mk-01
 * node services/ingest/src/collect/cli.ts --replay ~/df-evidence/mk-01/replay/<runId>   # 离线复跑（不触网）
 * ```
 * 退出码（规格 §6.1）：0 通过 / 1 断言失败 / 2 阻塞（无凭据、无网络、样本缺失）——禁止假绿。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_TOPICS } from './candidates.ts';
import type { CollectOptions } from './run.ts';
import { runCollect } from './run.ts';

export interface CliOptions {
  outDir: string;
  runId: string | null;
  asOf: string | null;
  seeds: string[];
  topics: string[];
  sorts: ('stars' | 'updated')[];
  perTopic: number;
  maxPagesPerQuery: number;
  limit: number | null;
  since: string | null;
  maxContentPerRepo: number;
  replayDir: string | null;
  help: boolean;
}

export class CliUsageError extends Error {}

/** 默认输出目录：`~/df-evidence/mk-01`（产物出库，测试夹具才入库）。 */
export function defaultOutDir(): string {
  return join(homedir(), 'df-evidence', 'mk-01');
}

/** 由 asOf 生成 runId（`YYYYMMDD-HHmmss`）。 */
export function runIdOf(asOfMs: number): string {
  const iso = new Date(asOfMs).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export const USAGE = `MK-01 采集器（四类资产候选发现 + 结构探针 + 内容校验）

用法：
  node services/ingest/src/collect/cli.ts [选项]

选项：
  --limit <n>          总仓上限（首批小跑：--limit 5）
  --seeds <列表>       种子白名单仓（owner/name，逗号分隔）
  --topics <列表>      topic 查询集（默认 8 个；传 "none" 关闭搜索发现）
  --sorts <列表>       排序版本：stars,updated（默认两者都取，规格 §2.1 双版本合并）
  --per-topic <n>      每 topic 取条目上限（默认 20）
  --max-pages <n>      每查询最多翻页数（默认 1；深翻页不做，规格 §3.5）
  --since <ISO>        增量水位（进 pushed:>= 查询，规格 §3.3）
  --max-content <n>    每仓内容取回预算（默认 32；超出如实标 deferred）
  --out <dir>          输出目录（默认 ~/df-evidence/mk-01）
  --run-id <id>       批次 id（默认由 asOf 生成；复现用）
  --as-of <ISO>        抓取时刻（排名冻结依据；复现用）
  --replay <dir>       离线复跑目录（responses.jsonl；不触网）
  --help               本帮助

退出码：0 通过 / 1 断言失败 / 2 阻塞（无凭据、无网络、样本缺失）。`;

/** 解析命令行（抛出 CliUsageError = 参数错误）。 */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    outDir: defaultOutDir(),
    runId: null,
    asOf: null,
    seeds: [],
    topics: [...DEFAULT_TOPICS],
    sorts: ['stars', 'updated'],
    perTopic: 20,
    maxPagesPerQuery: 1,
    limit: null,
    since: null,
    maxContentPerRepo: 32,
    replayDir: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new CliUsageError(`选项 ${arg} 缺参数值`);
      }
      i += 1;
      return next;
    };
    switch (arg) {
      case '--limit':
        opts.limit = Number(value());
        break;
      case '--seeds':
        opts.seeds = value()
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        break;
      case '--topics': {
        const raw = value().trim();
        opts.topics = raw === 'none' || raw === '' ? [] : raw.split(',').map((s) => s.trim());
        break;
      }
      case '--sorts': {
        const sorts = value()
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is 'stars' | 'updated' => s === 'stars' || s === 'updated');
        if (sorts.length === 0) throw new CliUsageError('--sorts 仅支持 stars,updated');
        opts.sorts = sorts;
        break;
      }
      case '--per-topic':
        opts.perTopic = Number(value());
        break;
      case '--max-pages':
        opts.maxPagesPerQuery = Number(value());
        break;
      case '--since':
        opts.since = value();
        break;
      case '--max-content':
        opts.maxContentPerRepo = Number(value());
        break;
      case '--out':
        opts.outDir = value();
        break;
      case '--run-id':
        opts.runId = value();
        break;
      case '--as-of':
        opts.asOf = value();
        break;
      case '--replay':
        opts.replayDir = value();
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new CliUsageError(`未知选项：${arg}（--help 查看用法）`);
    }
  }

  if (opts.limit !== null && (!Number.isFinite(opts.limit) || opts.limit <= 0)) {
    throw new CliUsageError('--limit 必须为正整数');
  }
  if (opts.perTopic <= 0) throw new CliUsageError('--per-topic 必须为正整数');
  if (opts.maxContentPerRepo < 0) throw new CliUsageError('--max-content 不能为负');
  return opts;
}

/** 主入口：返回退出码（0/1/2）。 */
export async function main(
  argv: string[],
  log: (line: string) => void = console.log,
): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    log(`参数错误：${error instanceof Error ? error.message : String(error)}`);
    log(USAGE);
    return 2; // 未进入可判定状态 → 阻塞语义（禁止假绿）
  }
  if (opts.help) {
    log(USAGE);
    return 0;
  }

  const asOfMs = opts.asOf !== null ? Date.parse(opts.asOf) : Date.now();
  if (Number.isNaN(asOfMs)) {
    log(`参数错误：--as-of 不是合法时间：${String(opts.asOf)}`);
    return 2;
  }
  const runId = opts.runId ?? runIdOf(asOfMs);

  log(`MK-01 采集器 · runId=${runId} · asOf=${new Date(asOfMs).toISOString()}`);
  log(`输出：${opts.outDir}${opts.replayDir !== null ? ` · 离线重放：${opts.replayDir}` : ''}`);

  const collectOptions: CollectOptions = {
    outDir: opts.outDir,
    runId,
    asOfMs,
    seeds: opts.seeds,
    topics: opts.topics,
    sorts: opts.sorts,
    perTopic: opts.perTopic,
    maxPagesPerQuery: opts.maxPagesPerQuery,
    limit: opts.limit,
    since: opts.since,
    maxContentPerRepo: opts.maxContentPerRepo,
    replayDir: opts.replayDir,
    log,
  };

  try {
    const result = await runCollect(collectOptions);
    log('');
    log(
      `结果：exitCode=${result.exitCode} · 仓库 ${result.counts.repos} · 资产 ` +
        `skill=${result.counts.byKind.skill} plugin=${result.counts.byKind.plugin} ` +
        `design-system=${result.counts.byKind['design-system']} template=${result.counts.byKind.template}`,
    );
    log(
      `守门：loadable=${result.counts.byGate.loadable} view-only=${result.counts.byGate['view-only']} ` +
        `blocked=${result.counts.byGate.blocked} · deferred 资产=${result.counts.deferredAssets} · 品牌复刻=${result.counts.brandDerivedAssets}`,
    );
    log(`证据：${result.evidencePath}`);
    if (result.blockedReason !== null) log(`阻塞：${result.blockedReason}`);
    for (const skip of result.counts.skippedRepos) log(`跳过：${skip.repo}（${skip.reason}）`);
    return result.exitCode;
  } catch (error) {
    // 未预期异常：明确阻塞（不吞错、不假绿）
    log(
      `阻塞：采集流程异常退出：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return 2;
  }
}

// 直接执行（而非被 import）时才跑主流程。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
