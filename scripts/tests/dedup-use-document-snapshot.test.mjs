/**
 * D-13 去重回归（audit-d10）：`useDocumentSnapshot` 全仓**单源**断言。
 *
 * 背景：该钩子曾在 inspector / inspect-export / editor-components 三个 feature 各存一份
 * 逐字节相同拷贝（docs/audit/DEFECTS.md D-13），已收敛为 `apps/web/src/lib/use-document-snapshot.ts`
 * 单源（依赖方向符合 ADR-0004：features/* → lib/* 允许，lib/* → features/* 禁止）。
 *
 * 本测试防止拷贝回潮：
 *  - 全仓（apps/web/src）`export function useDocumentSnapshot` 定义必须**恰好 1 处**；
 *  - feature 目录下不得再出现同名钩子文件 `useDocumentSnapshot.ts`；
 *  - 消费方导入必须经单源模块符 `@/lib/use-document-snapshot` 或自目录相对导入，
 *    即不得复活 `../hooks/useDocumentSnapshot` 形态。
 *
 * 用法：`pnpm test:scripts`（node --test + 根 glob）。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * 在 git 跟踪 + 未跟踪（新建未提交）文件内 grep（不依赖 fs 遍历，node_modules 天然排除）。
 * git grep 无命中时退出码 1 属正常语义，按「0 命中」处理；其余退出码视为环境故障。
 */
function grepTracked(pattern, pathspec) {
  const result = spawnSync(
    'git',
    ['grep', '--untracked', '-I', '--fixed-strings', '-n', pattern, '--', pathspec],
    { encoding: 'utf8', cwd: repoRoot },
  );
  if (result.status !== 0 && result.status !== 1) {
    assert.fail(`git grep 异常（exit ${String(result.status)}）：${result.stderr ?? ''}`);
  }
  const out = (result.stdout ?? '').trim();
  return out === '' ? [] : out.split('\n');
}

test('D-13：useDocumentSnapshot 定义全仓恰好 1 处（单源）', () => {
  const hits = grepTracked('export function useDocumentSnapshot', 'apps/web/src');
  assert.equal(
    hits.length,
    1,
    `useDocumentSnapshot 定义应为单源，实际 ${String(hits.length)} 处：\n${hits.join('\n')}`,
  );
  assert.match(hits[0] ?? '', /apps\/web\/src\/lib\/use-document-snapshot\.ts:1[0-9]:/);
});

test('D-13：feature 目录下不得复活 useDocumentSnapshot.ts 拷贝文件', () => {
  const hits = grepTracked('useDocumentSnapshot', 'apps/web/src/features');
  const fileDefs = hits.filter((line) => /hooks\/useDocumentSnapshot\.ts:/.test(line));
  assert.equal(
    fileDefs.length,
    0,
    `feature 内不得再存 useDocumentSnapshot.ts 拷贝：\n${fileDefs.join('\n')}`,
  );
});

test('D-13：消费方导入全部落在单源模块符上', () => {
  const imports = grepTracked('import { useDocumentSnapshot }', 'apps/web/src');
  assert.ok(imports.length >= 1, '应至少有一个消费方导入（否则单源成了死代码，需另查）');
  const offenders = imports.filter((line) => !line.includes('@/lib/use-document-snapshot'));
  assert.equal(
    offenders.length,
    0,
    `消费方必须经 @/lib/use-document-snapshot 导入，越界形态：\n${offenders.join('\n')}`,
  );
});
