/**
 * JUnit 生成器回归（#107 · 审计 10a）。
 *
 * 钉住三件事：
 * 1. 三态映射：pass → testcase、fail → failure、blocked → skipped（blocked 不算通过）；
 * 2. 计数从步骤现算，拒绝「0 tests 全绿」（无步骤时产出 runner 级结果）；
 * 3. XML 属性安全：步骤名/详情里的 `<` `&` `"` 必须转义，避免证据文件损坏。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildJUnitXml, countSteps, escapeXml } from '../lib/junit.mjs';

test('三态映射：pass/fail/blocked 分别落到 testcase/failure/skipped，计数一致', () => {
  const xml = buildJUnitXml({
    name: 'e2e-smoke',
    startedAt: '2026-10-17T00:00:00.000Z',
    finishedAt: '2026-10-17T00:00:10.500Z',
    exitCode: 1,
    scenarios: [
      {
        id: 'home',
        steps: [
          { name: '首页打开', status: 'pass' },
          { name: '新建文档', status: 'fail', detail: 'HTTP 500' },
          { name: '市场夹具', status: 'blocked', detail: '索引缺失' },
        ],
      },
    ],
    editorGate: {
      steps: [{ name: '画布挂载', status: 'pass' }],
    },
  });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<testsuites name="e2e-smoke" tests="4" failures="1" skipped="1"/);
  assert.match(xml, /<testsuite name="home" tests="3" failures="1" skipped="1"/);
  assert.match(xml, /<failure message="HTTP 500"\/>/);
  assert.match(xml, /<skipped message="索引缺失"\/>/);
  assert.match(xml, /<testsuite name="editor-gate" tests="1" failures="0" skipped="0"/);
  assert.match(xml, /time="10\.500"/);
});

test('无步骤时不得产出 0 tests 全绿：runner 级按退出码记 blocked/fail', () => {
  const blocked = buildJUnitXml({ exitCode: 2, blockedReason: '站点不可达' });
  assert.match(blocked, /tests="1" failures="0" skipped="1"/);
  assert.match(blocked, /<skipped message="站点不可达"\/>/);

  const failed = buildJUnitXml({ exitCode: 1 });
  assert.match(failed, /tests="1" failures="1" skipped="0"/);
  assert.match(failed, /<failure message="runner 未产出步骤（exit 1）"\/>/);
});

test('XML 属性转义：< & " 不破坏结构', () => {
  assert.equal(escapeXml('a<b&"c\''), 'a&lt;b&amp;&quot;c&apos;');
  const xml = buildJUnitXml({
    exitCode: 1,
    scenarios: [{ id: 'x', steps: [{ name: 'a<b&"c', status: 'fail', detail: 'x > y & <z>' }] }],
  });
  assert.match(xml, /name="a&lt;b&amp;&quot;c"/);
  assert.match(xml, /message="x &gt; y &amp; &lt;z&gt;"/);
});

test('countSteps：未知状态按 fail 记账（不静默吞掉）', () => {
  assert.deepEqual(
    countSteps([
      { status: 'pass' },
      { status: 'blocked' },
      { status: 'fail' },
      { status: 'unknown' },
    ]),
    { steps: 4, passed: 1, failed: 2, blocked: 1 },
  );
});
