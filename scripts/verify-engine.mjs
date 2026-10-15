#!/usr/bin/env node
/**
 * verify-engine —— ENG-01（编辑器内核）门禁脚本。
 *
 * 与本票 DoD 对应（不依赖参照集，故正常态只有 0/1）：
 *   1) 跑包内全量测试：`pnpm --filter @dforge/engine test`（几何/命令栈/吸附/序列化…）
 *   2) **独立复核**快照哈希回归产物：
 *      sha256(packages/engine/__snapshots__/fixed-document.json) === fixed-document.sha256
 *      （哈希由测试内用同一份稳定序列化产物算出；脚本侧再算一遍，防止「只改 JSON 没改哈希」这类假绿）
 *   3) 校验快照信封（$format/$version/pages）存在且非空
 *
 * 退出码语义（docs/agents/implementation-workflow.md）：
 *   0 = 通过；1 = 违规（测试红 / 哈希不符 / 产物缺失或损坏）；2 = 阻塞（本脚本无前置阻塞项）。
 *
 * 用法：`node scripts/verify-engine.mjs`（有意更新行为基线时先跑
 * `UPDATE_SNAPSHOT=1 pnpm --filter @dforge/engine test`，并审阅 fixed-document.json 的 diff）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_DIR = resolve(ROOT, 'packages/engine/__snapshots__');
const DOC_PATH = resolve(SNAPSHOT_DIR, 'fixed-document.json');
const HASH_PATH = resolve(SNAPSHOT_DIR, 'fixed-document.sha256');

/** 统一的失败输出（exit 1 = 违规）。 */
function fail(message) {
  console.error(`\n[verify-engine] 违规：${message}`);
  process.exit(1);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

console.log('[verify-engine] 1/3 运行 @dforge/engine 全量测试…');
const test = spawnSync('pnpm', ['--filter', '@dforge/engine', 'test'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const testOut = `${test.stdout ?? ''}${test.stderr ?? ''}`;
process.stdout.write(testOut);
if (test.error) fail(`无法启动测试进程：${test.error.message}`);
if (test.status !== 0) {
  fail(`包内测试未通过（退出码 ${test.status}）`);
}
const passed = /Tests\s+(\d+) passed/.exec(testOut)?.[1] ?? '?';
const files = /Test Files\s+(\d+) passed/.exec(testOut)?.[1] ?? '?';

console.log('\n[verify-engine] 2/3 复核快照哈希回归产物…');
if (!existsSync(DOC_PATH) || !existsSync(HASH_PATH)) {
  fail(
    '快照产物缺失：packages/engine/__snapshots__/fixed-document.{json,sha256}。' +
      '请在包内跑一次测试以生成（首次落库），并随提交一并入库。',
  );
}
const docJson = readFileSync(DOC_PATH, 'utf8');
const expectedHash = readFileSync(HASH_PATH, 'utf8').trim();
const actualHash = sha256(docJson);
if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
  fail(`哈希文件内容不是 sha256：${expectedHash}`);
}
if (actualHash !== expectedHash) {
  fail(
    `哈希不符：期望 ${expectedHash}，实际 ${actualHash}。` +
      '说明 fixed-document.json 与哈希文件不同步（禁止只改其一）。',
  );
}

console.log('[verify-engine] 3/3 校验快照信封与内容…');
let parsed;
try {
  parsed = JSON.parse(docJson);
} catch (error) {
  fail(`快照 JSON 不可解析：${error.message}`);
}
if (parsed.$format !== 'dforge.designir' || typeof parsed.$version !== 'number') {
  fail('快照缺少 $format/$version 信封');
}
const pages = parsed.document?.pages;
if (!Array.isArray(pages) || pages.length === 0) {
  fail('快照文档没有任何页面');
}
const nodeCount = pages.reduce((sum, page) => sum + Object.keys(page.nodes ?? {}).length, 0);
if (nodeCount === 0) fail('快照文档没有任何节点（夹具疑似失效）');

console.log(
  `\n[verify-engine] 通过：测试文件 ${files} 个 / 用例 ${passed} 例全绿；` +
    `快照哈希一致（${actualHash.slice(0, 12)}…，节点 ${nodeCount} 个）。`,
);
process.exit(0);
