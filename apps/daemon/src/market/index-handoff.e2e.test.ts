/**
 * 市场索引落点交接（票 #15）——CLI 缺省参数产物 → daemon 缺省候选探测命中。
 *
 * 为什么必须端到端：两侧单方测试都绿（CLI 断言自己把索引写到 `<data>/ads/`，daemon 断言
 * 自己按 `<dataRoot>/market[/ads]/` 探测），但「同一数据根」这一跳此前**没有任何用例**——
 * 这正是用户照空态指令跑完采集三连、市场页却永远空态的缺口（证据 §C2）。
 *
 * 本用例跨真实进程：
 * 1. 子进程跑 `df market collect --stage ods|dwd` → `score` → `index`，**一律缺省 `--data`**
 *    （产物落 `<临时工作目录>/data/ads/`，与用户照指令执行时完全一致）；
 * 2. daemon 用应用工厂起在**同一数据根**（显式临时目录，绝不碰 `~/.dforge`），不给
 *    `marketIndexPath` 覆盖 → 走缺省候选探测；
 * 3. 断言 `/market/query` 脱离空态、拿到卡片，且无 `index-missing` 告警。
 *
 * 同时锚定 CLI 的交接指引：缺省产物落点、`DF_MARKET_INDEX` 逃生口、复制到 daemon
 * 数据根的命令都在 stdout 里可见（票 #15 方案 2 的可发现性要求）。
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDaemonApp } from '../app.ts';
import { injectJson } from '../testing/harness.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLI_BIN = join(REPO_ROOT, 'tools', 'cli', 'bin', 'df.mjs');
const ODS_FIXTURE = join(
  REPO_ROOT,
  'services',
  'ingest',
  'src',
  'transform',
  '__fixtures__',
  'ods-source',
);

/** 子进程跑 CLI（缺省工作目录 = 临时目录，刻意不传 `--data`）。 */
function runCli(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  // 逃生口与数据根变量不参与 CLI 解析，这里显式清掉，防止外部环境改变「缺省」语义
  delete env.DF_MARKET_INDEX;
  delete env.DF_DATA_ROOT;
  return new Promise((resolvePromise, reject) => {
    // Node 22.6–22.17 需显式开类型擦除（22.18+/24 默认开，该开关仍兼容）
    const child = spawn(process.execPath, ['--experimental-strip-types', CLI_BIN, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe('市场索引落点交接（CLI 缺省产物 → daemon 缺省探测）', () => {
  let workDir = '';
  let dataRoot = '';
  let app: FastifyInstance | null = null;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'df-market-handoff-'));
    dataRoot = join(workDir, 'data');
    // 夹具即 MK-01 形状的 ODS 源（与 CLI pipeline.test 同一份，离线、不触网）
    await cp(ODS_FIXTURE, dataRoot, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    if (app !== null) await app.close();
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('缺省参数跑完三连后，daemon 缺省候选探测命中（市场页脱离空态）', async () => {
    const ods = await runCli(workDir, ['market', 'collect', '--stage', 'ods']);
    expect(ods.code, `collect --stage ods 失败：${ods.stderr || ods.stdout}`).toBe(0);
    const dwd = await runCli(workDir, ['market', 'collect', '--stage', 'dwd']);
    expect(dwd.code, `collect --stage dwd 失败：${dwd.stderr || dwd.stdout}`).toBe(0);
    const score = await runCli(workDir, ['market', 'score']);
    expect(score.code, `score 失败：${score.stderr || score.stdout}`).toBe(0);
    const index = await runCli(workDir, ['market', 'index']);
    expect(index.code, `index 失败：${index.stderr || index.stdout}`).toBe(0);

    const indexPath = join(dataRoot, 'ads', 'df.marketplace.index.v1.json');
    // 方案 2（票 #15）：缺省产物落点与接线方式必须在命令输出里可发现
    expect(index.stdout).toContain(`索引落点：${indexPath}`);
    expect(index.stdout).toContain(`DF_MARKET_INDEX=${indexPath}`);
    expect(index.stdout).toContain(`cp ${dataRoot}/ads/*.json ~/.dforge/market/ads/`);

    // daemon 缺省探测：显式给临时数据根（测试纪律），不给索引路径覆盖
    app = await createDaemonApp({
      dataRoot,
      workspaceDir: join(workDir, 'workspace'),
      envApiKey: null,
      fetchImpl: (async () => {
        throw new Error('交接用例不允许出网');
      }) as typeof fetch,
    });
    const { statusCode, payload } = await injectJson(app, {
      method: 'GET',
      url: '/market/query',
    });
    expect(statusCode).toBe(200);
    const result = (
      payload as {
        result: { state: string; items: unknown[]; warnings: { code: string }[] };
      }
    ).result;
    expect(result.warnings.map((warning) => warning.code)).not.toContain('index-missing');
    expect(result.state).toBe('ok');
    expect(result.items.length).toBeGreaterThan(0);
  }, 180_000);
});
