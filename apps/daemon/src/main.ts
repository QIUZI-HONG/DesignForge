/**
 * @dforge/daemon · 进程入口（`pnpm --filter @dforge/daemon dev` / 门禁脚本 spawn）。
 *
 * 环境变量（缺省全部走 dataRoot 派生路径；显式 CLI 参数优先于环境变量）：
 * - `DF_DATA_ROOT`、`DF_WORKSPACE_DIR`、`DF_PORT`、`DF_HOST`、`DF_MARKET_INDEX`；
 * - `DFORGE_CORS_ORIGINS`（CORS 白名单，逗号分隔；缺省仅本机开发来源，别名 `DF_CORS_ORIGINS`）；
 * - `DF_DEEPSEEK_API_KEY`（凭据库只读回退源；AI 供应商/模型等改走 `PUT /config`）。
 * 启动成功后向 stdout 打印一行 `[daemon] listening on http://host:port`（脚本据此取端口）。
 */

import { startDaemon } from './server.ts';

/** 解析 `--key value` / `--key=value` 形式的参数。 */
function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=');
    if (key === undefined) continue;
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = args.get('data-root') ?? process.env.DF_DATA_ROOT;
  const workspaceDir = args.get('workspace') ?? process.env.DF_WORKSPACE_DIR;
  const portRaw = args.get('port') ?? process.env.DF_PORT;
  const host = args.get('host') ?? process.env.DF_HOST;
  const marketIndexPath = args.get('market-index') ?? process.env.DF_MARKET_INDEX;

  const port = portRaw === undefined ? undefined : Number.parseInt(portRaw, 10);

  const running = await startDaemon({
    ...(dataRoot === undefined ? {} : { dataRoot }),
    ...(workspaceDir === undefined ? {} : { workspaceDir }),
    ...(host === undefined ? {} : { host }),
    ...(port === undefined || !Number.isInteger(port) ? {} : { port }),
    ...(marketIndexPath === undefined ? {} : { marketIndexPath }),
    logger: { level: 'info' },
  });

  console.log(`[daemon] listening on ${running.url}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[daemon] 收到 ${signal}，正在关闭…`);
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[daemon] 启动失败：', error);
  process.exit(1);
});
