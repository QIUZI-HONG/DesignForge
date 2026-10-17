/**
 * `scripts/guard-mcp-contract.mjs` 的**检出强度**回归测试（aud-05 契约快照接缝）。
 *
 * 为什么需要它：契约守卫是「MCP 工具集 + 跨端消息形状」的唯一机器可读声明。
 * 它必须做到三态分明：
 *   - 源与快照一致 → exit 0（正例，且报告里能读到真实工具集/路由/信封字段）；
 *   - 快照被人为改动（工具、路由、信封任一漂移）→ exit 1 并**点名**漂移位；
 *   - 快照缺失/损坏 → exit 2（阻塞，禁止当通过也禁止误报违规）。
 * 若守卫能被一个「快照复制品」骗过，CI 里的契约门禁就是假绿。
 *
 * 夹具（`scripts/tests/fixtures/mcp-contract/`）是主快照的**故意漂移副本**：
 * 主快照随契约变更由 `node scripts/guard-mcp-contract.mjs --update` 更新；
 * 夹具只需与源不同，无需跟随更新（drift 恒成立）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const guard = join(repoRoot, 'scripts', 'guard-mcp-contract.mjs');
const fixtureDir = join(here, 'fixtures', 'mcp-contract');
const fixture = (name) => join(fixtureDir, name);

/** 跑守卫（总是 --json；fixture 运行不 --update）。 */
function runGuard(extraArgs = []) {
  const result = spawnSync(process.execPath, [guard, '--json', ...extraArgs], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const stdout = (result.stdout ?? '').trim();
  assert.notEqual(stdout, '', `守卫未输出 JSON（stderr: ${result.stderr}）`);
  const report = JSON.parse(stdout);
  return { status: result.status, report, stderr: result.stderr ?? '' };
}

const violationsOf = (report) => (report.violations ?? []).join('\n');
const undeterminedOf = (report) => (report.undetermined ?? []).join('\n');

test('主快照存在于 scripts/snapshots/mcp-contract.v1.json（快照是提交物，不是运行期生成）', () => {
  assert.equal(existsSync(join(repoRoot, 'scripts', 'snapshots', 'mcp-contract.v1.json')), true);
});

test('真实契约 + 主快照 → exit 0，且报告含 MCP 工具集/路由/信封的真实形状', () => {
  const { status, report } = runGuard();

  assert.equal(violationsOf(report), '');
  assert.equal(undeterminedOf(report), '');
  assert.equal(status, 0);

  // 非空断言：固定的是**真实契约**（空快照不得骗过门禁）
  assert.deepEqual(report.snapshot.mcp.writeTools, [
    'df_apply_patch',
    'df_create_component',
    'df_swap_instance',
    'df_run_skill',
    'df_sync_tokens',
    'df_comment_add',
    'df_version_restore',
  ]);
  assert.equal(report.snapshot.mcp.ackTtlMs, 120_000);
  assert.deepEqual(report.snapshot.mcp.callers, [
    'user',
    'local-ai',
    'mcp:zcode',
    'mcp:workbuddy',
    'importer',
  ]);
  assert.equal(report.snapshot.routes.mcpPropose.method, 'POST');
  assert.equal(report.snapshot.routes.mcpPropose.path, '/mcp/proposals');
  assert.equal(report.snapshot.routes.mcpAck.path, '/mcp/ack');
  assert.equal(report.snapshot.routes.mcpAudit.path, '/mcp/audit');
  assert.deepEqual(report.snapshot.envelopes.httpSuccessFields, ['ok', 'result']);
  assert.deepEqual(report.snapshot.envelopes.httpFailureFields, ['ok', 'error']);
  assert.deepEqual(report.snapshot.envelopes.ipcRequestFields, ['id', 'method', 'params']);
  assert.ok(report.snapshot.mcp.proposalResponseFields.includes('ackToken'));
  assert.ok(report.snapshot.mcp.auditRecordFields.includes('argsDigest'));
});

test('工具集漂移（快照少一个写工具）→ exit 1 且点名 df_comment_add', () => {
  const { status, report } = runGuard([`--snapshot=${fixture('drift-tool.snapshot.json')}`]);

  assert.equal(status, 1, `未抓到工具集漂移：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /df_comment_add/);
  assert.match(violationsOf(report), /工具集/);
});

test('跨端路由漂移（mcpAck 路径改动）→ exit 1 且点名 mcpAck', () => {
  const { status, report } = runGuard([`--snapshot=${fixture('drift-route.snapshot.json')}`]);

  assert.equal(status, 1, `未抓到路由漂移：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /mcpAck/);
  assert.match(violationsOf(report), /\/mcp\/ack-v2/);
});

test('信封字段漂移（IpcRequest 少 params）→ exit 1 且点名 ipcRequestFields/params', () => {
  const { status, report } = runGuard([`--snapshot=${fixture('drift-envelope.snapshot.json')}`]);

  assert.equal(status, 1, `未抓到信封漂移：${violationsOf(report) || undeterminedOf(report)}`);
  assert.match(violationsOf(report), /IpcRequest/);
  assert.match(violationsOf(report), /params/);
});

test('快照缺失 → exit 2（阻塞，禁当通过也禁误报违规）', () => {
  const { status, report } = runGuard([`--snapshot=${fixture('does-not-exist.snapshot.json')}`]);

  assert.equal(status, 2);
  assert.equal(violationsOf(report), '');
  assert.match(undeterminedOf(report), /快照缺失/);
});

test('快照损坏（JSON 解析失败）→ exit 2 并点名文件', () => {
  const { status, report } = runGuard([`--snapshot=${fixture('corrupt.snapshot.json.bad')}`]);

  assert.equal(status, 2);
  assert.equal(violationsOf(report), '');
  assert.match(undeterminedOf(report), /快照不可读|JSON/);
});
