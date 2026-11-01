/**
 * scripts/lib/sse-frames.mjs 自测：SSE 帧解析器的边界与失败判据。
 *
 * 门禁 verify-ai-two-state 用它把 daemon `/ai/chat` 流式响应还原成事件对象数组，
 * 再按 type 抽 start/done 帧做语义判据。原内联实现有三处漏：
 *   ① 只按 `\n\n` 分帧，遇 CRLF (`\r\n\r\n`) 流式源就退成一整块；
 *   ② 只取块内第一条 `data:`，多行 data（SSE 规范允许，值以 `\n` 连接）会被截断；
 *   ③ `catch {}` 丢弃未解析帧，与 `data: [DONE]` 走同一条静默路径——
 *      畸形 JSON 帧不再报错、也不计入 observed 帧数，等于对上游「丢帧」零感知。
 * 这些漏洞在生产 daemon 侧目前不会命中（routes/ai.ts 每帧单行 data 且都是合法 JSON），
 * 但门禁是消费侧最后一道判据，不能靠「上游不会这么发」的假设；因此把解析器抽成
 * 公共 lib 并用夹具把这几条钉死——畸形帧必须抛错，帧数必须能对回线上。
 *
 * 用法：`node scripts/tests/sse-frames.test.mjs`（node:test；退出码 0 全过 / 1 有失败）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSseFrames } from '../lib/sse-frames.mjs';

test('daemon 帧形（event + 单行 data + 空行分隔）解析成事件数组', () => {
  const text = [
    'event: start\ndata: {"type":"start","degraded":true}\n\n',
    'event: step\ndata: {"type":"step","step":"queued"}\n\n',
    'event: done\ndata: {"type":"done","response":{"content":""}}\n\n',
  ].join('');
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 3);
  assert.deepEqual(
    r.events.map((e) => e.type),
    ['start', 'step', 'done'],
  );
  // 线上 data: 行数必须等于解析出的事件数（帧数对回线上，杜绝「静默丢帧」）。
  assert.equal(r.dataLineCount, 3);
  assert.equal(r.doneCount, 0);
  assert.equal(r.malformedCount, 0);
});

test('CRLF 终止符（\\r\\n\\r\\n）正确分帧', () => {
  const text =
    'event: start\r\ndata: {"type":"start"}\r\n\r\nevent: done\r\ndata: {"type":"done"}\r\n\r\n';
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 2);
  assert.equal(r.dataLineCount, 2);
});

test('多行 data 载荷以换行拼接后再解析（SSE § 9.2.5）', () => {
  // 一个 JSON 字符串跨两行 data: —— 规范上等价于 `{"a":\n1}`，解析必须成功。
  const text = 'data: {"a":\ndata: 1}\n\n';
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0], { a: 1 });
  assert.equal(r.dataLineCount, 2); // 线上两条 data，但合并成一个事件
});

test('注释行 / keep-alive（以冒号开头）被忽略且不计入帧数', () => {
  const text = [
    ': keep-alive\n\n', // 纯注释块：应忽略、不产事件
    'data: {"type":"start"}\n\n',
    ': ping\ndata: {"type":"done"}\n\n', // 注释 + 数据：只有数据算一帧
  ].join('');
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 2);
  assert.equal(r.commentCount, 2);
  assert.equal(r.dataLineCount, 2);
});

test('OpenAI 风格的 `data: [DONE]` 计为 doneCount，不当作畸形帧', () => {
  const text = 'data: {"choices":[]}\n\ndata: [DONE]\n\n';
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 1);
  assert.equal(r.doneCount, 1);
  assert.equal(r.malformedCount, 0);
});

test('未闭合最后一帧（无尾随空行）仍解析（流式尾部常态）', () => {
  const text = 'data: {"type":"start"}\n\ndata: {"type":"done"}';
  const r = parseSseFrames(text);
  assert.equal(r.events.length, 2);
});

test('畸形 JSON 载荷必须抛错——不再 catch{} 静默丢帧', () => {
  const text = 'data: {"type":"start"}\n\ndata: {broken json\n\ndata: {"type":"done"}\n\n';
  assert.throws(
    () => parseSseFrames(text),
    (error) => {
      assert.ok(error instanceof Error);
      // 报错信息要能定位畸形帧载荷（门禁据此判红并写证据）。
      assert.match(error.message, /畸形|unparseable|SSE/i);
      assert.match(error.message, /broken json/);
      return true;
    },
  );
});

test('空串与纯空白文本返回零帧而不是崩溃', () => {
  assert.equal(parseSseFrames('').events.length, 0);
  assert.equal(parseSseFrames('\n\n\n').events.length, 0);
});
