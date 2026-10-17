/**
 * verify-resilience 自测（#53 · 审计 03 韧性接缝）。
 *
 * 只测纯函数：三态判定、故障结果分类、临时根安全断言。
 * 真实 daemon 的故障注入用例在 `node scripts/verify-resilience.mjs` 中执行（不在 CI 常规链路）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertSafeTempBase,
  classifyFaultOutcome,
  decideExitCode,
  summarizeSteps,
} from '../verify-resilience.mjs';

const step = (status) => ({ id: `s-${status}`, status, detail: '' });

test('三态退出码：全通过或只有观察项 → 0', () => {
  assert.equal(decideExitCode([]), 0);
  assert.equal(decideExitCode([step('pass'), step('observe')]), 0);
});

test('三态退出码：任一真违规 → 1（即使同时存在阻塞）', () => {
  assert.equal(decideExitCode([step('pass'), step('fail')]), 1);
  assert.equal(decideExitCode([step('blocked'), step('fail')]), 1);
});

test('三态退出码：只有阻塞 → 2（阻塞不是通过）', () => {
  assert.equal(decideExitCode([step('pass'), step('blocked')]), 2);
});

test('汇总计数与状态集合一致', () => {
  const summary = summarizeSteps([
    step('pass'),
    step('pass'),
    step('fail'),
    step('blocked'),
    step('observe'),
  ]);
  assert.deepEqual(summary, { total: 5, pass: 2, fail: 1, blocked: 1, observe: 1 });
});

const base = {
  httpStatus: 500,
  pageJson: 'valid',
  manifestJson: 'valid',
  pageState: 'old',
  manifestState: 'old',
  tempFiles: [],
  reasonLeaksPath: false,
};

test('故障分类：故障被观测且旧正文保留 → pass', () => {
  assert.equal(classifyFaultOutcome(base).status, 'pass');
});

test('故障分类：故障未生效（写成功）→ fail', () => {
  assert.deepEqual(classifyFaultOutcome({ ...base, httpStatus: 200 }), {
    status: 'fail',
    reason: 'fault-not-observed',
    observations: [],
  });
});

test('故障分类：失败响应却已应用新正文（manifest 未提交）→ fail（半提交）', () => {
  assert.deepEqual(classifyFaultOutcome({ ...base, pageState: 'new' }), {
    status: 'fail',
    reason: 'partial-apply',
    observations: [],
  });
});

test('故障分类：任一侧 JSON 损坏 → fail', () => {
  assert.equal(classifyFaultOutcome({ ...base, pageJson: 'invalid' }).reason, 'json-corrupt');
  assert.equal(classifyFaultOutcome({ ...base, manifestJson: 'invalid' }).reason, 'json-corrupt');
});

test('故障分类：残留临时文件 / 错误消息泄漏绝对路径 → 观察项', () => {
  const result = classifyFaultOutcome({
    ...base,
    tempFiles: ['pages/.abc.tmp'],
    reasonLeaksPath: true,
  });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.observations, ['temp-leftover', 'error-path-leak']);
});

test('临时根安全：拒绝 /tmp（本机 tmpfs 仅 3.9G）', () => {
  assert.throws(() => assertSafeTempBase('/tmp'), /禁用/);
  assert.throws(() => assertSafeTempBase('/tmp/df-x'), /禁用/);
  assert.doesNotThrow(() => assertSafeTempBase('/home/QIU/df-evidence/audit-50/aud-03/tmp'));
});
