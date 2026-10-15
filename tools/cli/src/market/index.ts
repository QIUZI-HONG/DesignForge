/**
 * `df market` 子命令分发（CLI 形态见《市场首实现》§2.2：四条子命令独立可跑，不依赖编辑器/桌面壳）。
 *
 * 用法与退出码（规格 §6.1）：
 * ```
 * df market collect [--data <dir>] [--limit n] [--seeds a/b,c/d] [--topics t1,t2|none]
 *                   [--sorts stars,updated] [--per-topic n] [--max-pages n] [--since ISO]
 *                   [--max-content n] [--stars-history] [--as-of ISO] [--run-id id]
 *                   [--replay <dir>] [--stage raw|ods|dwd|all]
 * df market score   [--data <dir>] [--as-of ISO] [--run-id id]
 * df market index   [--data <dir>] [--generated-at ISO] [--collector-name name] [--run-id id]
 * df market search  [--data <dir>] (--q <串> | --query-set) [--limit n]
 * ```
 * 退出码：`0` 通过 / `1` 断言失败（有数据但不达标）/ `2` 阻塞（缺依赖产物、无凭据、参数错误）。
 */

import { collect } from '@dforge/ingest';
import { CliUsageError, intOption, listOption, parseArgv } from './args.ts';
import { runCollectCommand } from './collect-cmd.ts';
import { runIndexCommand } from './index-cmd.ts';
import { runScoreCommand } from './score-cmd.ts';
import { runSearchCommand } from './search-cmd.ts';

export const MARKET_USAGE = `df market —— 市场采集线（首批 40 仓判据链）

用法：
  df market collect [选项]    采集 → ODS 规整 → DWD 四表（判据链第 1→2 环）
  df market score   [选项]    DWD → 五维评分（DWS，第 3 环）
  df market index   [选项]    DWS → 市场索引 + 检索索引（ADS，第 4 环）
  df market search  [选项]    检索 ADS 产物（第 5 环）

collect 选项：
  --data <dir>          数据面根目录（默认 data；内含 ods/ dwd/ dws/ ads/ evidence/）
  --limit <n>           总仓上限（首批 40）
  --seeds <列表>        种子白名单仓（owner/name，逗号分隔）
  --topics <列表>       topic 查询集（默认 8 个；"none" 关闭搜索发现）
  --sorts <列表>        排序版本：stars,updated（默认两者都取）
  --per-topic <n>       每 topic 取条目上限（默认 20）
  --max-pages <n>       每查询最多翻页数（默认 1）
  --since <ISO>         增量水位（进 pushed:>= 查询）
  --max-content <n>     每仓内容取回预算（默认 32）
  --stars-history       取星标历史水位（90 天前；额外 stargazers 调用）
  --as-of <ISO>         抓取时刻注入（排名冻结依据；复现用）
  --run-id <id>         批次 id（复现用）
  --replay <dir>        离线复跑目录（不触网）
  --stage <段>          raw | ods | dwd | all（默认 all）

score 选项：
  --data <dir>          数据面根目录（默认 data）
  --as-of <ISO>         批次时点（缺省取 DWD 清单 asOf；注入保证确定性）
  --run-id <id>         批次 id（默认 score-YYYYMMDD）

index 选项：
  --data <dir>          数据面根目录（默认 data）
  --generated-at <ISO>  索引生成时刻（缺省取 DWD 清单 asOf）
  --collector-name <s>  collector.name（默认 df-market）
  --run-id <id>         批次 id（默认 index-YYYYMMDD）

search 选项：
  --data <dir>          数据面根目录（默认 data）
  --q <串>              单查询
  --query-set           跑内置示例查询集（≥10 条，逐条断言 + P95 基线）
  --limit <n>           单查询返回条数（默认 10）

退出码：0 通过 / 1 断言失败 / 2 阻塞（缺依赖产物、无凭据、参数错误；禁止假绿）。`;

export interface MarketCliOutcome {
  command: string;
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** 执行 `df market <子命令>`（argv 不含 `market`）。 */
export async function runMarketCli(
  argv: readonly string[],
  log: (line: string) => void = console.log,
): Promise<MarketCliOutcome> {
  const sub = argv[0] ?? 'help';
  const rest = argv.slice(1);

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    log(MARKET_USAGE);
    return { command: 'market help', exitCode: 0, summary: {}, blockedReason: null };
  }

  if (sub === 'collect') {
    const parsed = parseArgv(rest, {
      value: [
        'data',
        'limit',
        'seeds',
        'topics',
        'sorts',
        'per-topic',
        'max-pages',
        'since',
        'max-content',
        'as-of',
        'run-id',
        'replay',
        'stage',
      ],
      flags: ['stars-history'],
    });
    if (parsed.help) {
      log(MARKET_USAGE);
      return { command: 'market collect', exitCode: 0, summary: {}, blockedReason: null };
    }
    const stage = (parsed.value('stage') ?? 'all') as 'raw' | 'ods' | 'dwd' | 'all';
    if (!['raw', 'ods', 'dwd', 'all'].includes(stage)) {
      throw new CliUsageError(`--stage 仅支持 raw|ods|dwd|all（实际：${stage}）`);
    }
    const topicsRaw = parsed.value('topics');
    const sortsRaw = listOption(parsed, 'sorts') ?? ['stars', 'updated'];
    const sorts = sortsRaw.filter(
      (s): s is 'stars' | 'updated' => s === 'stars' || s === 'updated',
    );
    if (sorts.length !== sortsRaw.length) throw new CliUsageError('--sorts 仅支持 stars,updated');
    const result = await runCollectCommand(
      {
        dataRoot: parsed.value('data') ?? 'data',
        limit: intOption(parsed, 'limit', null),
        seeds: listOption(parsed, 'seeds') ?? [],
        topics:
          topicsRaw === null
            ? [...collect.DEFAULT_TOPICS]
            : topicsRaw.trim() === 'none' || topicsRaw.trim() === ''
              ? []
              : topicsRaw.split(',').map((t) => t.trim()),
        sorts,
        perTopic: intOption(parsed, 'per-topic', 20) ?? 20,
        maxPagesPerQuery: intOption(parsed, 'max-pages', 1) ?? 1,
        since: parsed.value('since'),
        maxContent: intOption(parsed, 'max-content', 32) ?? 32,
        starsHistory: parsed.flag('stars-history'),
        asOf: parsed.value('as-of'),
        runId: parsed.value('run-id'),
        replayDir: parsed.value('replay'),
        stage,
      },
      log,
    );
    return { command: 'market collect', ...result };
  }

  if (sub === 'score') {
    const parsed = parseArgv(rest, { value: ['data', 'as-of', 'run-id'] });
    if (parsed.help) {
      log(MARKET_USAGE);
      return { command: 'market score', exitCode: 0, summary: {}, blockedReason: null };
    }
    const result = await runScoreCommand(
      {
        dataRoot: parsed.value('data') ?? 'data',
        asOf: parsed.value('as-of'),
        runId: parsed.value('run-id'),
      },
      log,
    );
    return { command: 'market score', ...result };
  }

  if (sub === 'index') {
    const parsed = parseArgv(rest, { value: ['data', 'generated-at', 'collector-name', 'run-id'] });
    if (parsed.help) {
      log(MARKET_USAGE);
      return { command: 'market index', exitCode: 0, summary: {}, blockedReason: null };
    }
    const result = await runIndexCommand(
      {
        dataRoot: parsed.value('data') ?? 'data',
        generatedAt: parsed.value('generated-at'),
        collectorName: parsed.value('collector-name') ?? 'df-market',
        runId: parsed.value('run-id'),
      },
      log,
    );
    return { command: 'market index', ...result };
  }

  if (sub === 'search') {
    const parsed = parseArgv(rest, { value: ['data', 'q', 'limit'], flags: ['query-set'] });
    if (parsed.help) {
      log(MARKET_USAGE);
      return { command: 'market search', exitCode: 0, summary: {}, blockedReason: null };
    }
    const result = await runSearchCommand(
      {
        dataRoot: parsed.value('data') ?? 'data',
        q: parsed.value('q'),
        limit: intOption(parsed, 'limit', 10) ?? 10,
        querySet: parsed.flag('query-set'),
      },
      log,
    );
    return { command: 'market search', ...result };
  }

  throw new CliUsageError(`未知子命令：market ${sub}（支持 collect|score|index|search）`);
}
