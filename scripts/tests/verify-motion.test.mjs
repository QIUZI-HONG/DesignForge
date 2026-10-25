/**
 * `scripts/verify-motion.mjs` 的挂点契约测试（B 层体验门禁 · 动效实际生效）。
 *
 * 为什么需要它：三态退出码纪律的「禁假绿」必须可机器证明——真实现接入前，
 * 门禁必须恒以 exit 2 阻塞、绝不产出通过结论。挂点阶段能证明的契约就这一条，
 * 但它挡住的是最危险的回归：有人把挂点改成了「默认绿」。
 *
 * 断言的是纯函数 `verifyMotion()` 的外部契约（与 verify-figma-baseline.mjs 的
 * `verifyBaseline` 同构：纯函数判定 + main() 负责退出码与证据落盘）。
 *
 * 用法：`pnpm test:scripts`。退出码：0 全过 / 1 有失败。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyMotion } from '../verify-motion.mjs';

test('verify:motion 挂点：未实现恒阻塞（code 2，禁假绿）', () => {
  const result = verifyMotion();
  assert.equal(result.code, 2);
  assert.equal(result.implemented, false);
});

test('verify:motion 挂点：结论必须明示挂点语义，不带任何通过措辞', () => {
  const result = verifyMotion();
  assert.match(result.summary, /未实现/);
  assert.doesNotMatch(result.summary, /通过|pass/i);
});
