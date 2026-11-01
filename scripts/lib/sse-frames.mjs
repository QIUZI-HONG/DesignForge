/**
 * SSE 帧解析器（scripts/lib）：把服务器推送的 `text/event-stream` 文本还原成事件对象数组。
 *
 * 为什么要抽出来：`verify-ai-two-state` 靠它把 daemon `/ai/chat` 的流式响应还原成
 * `{ type: 'start' | 'step' | 'delta' | 'done' | 'error' }` 事件，再按 `type` 挑帧做
 * 语义判据。原内联实现有三处漏（详见 `scripts/tests/sse-frames.test.mjs` 头注释）：
 * 只按 `\n\n` 分帧、只取每块第一条 `data:`、`catch {}` 静默丢畸形帧——畸形帧既不报错
 * 也不计入观察到的帧数，等于对上游「丢帧」零感知。
 *
 * 契约（本 lib 的判据口径）：
 * - 分帧终止符：`\n\n`、`\r\n\r\n`、`\r\r` 三种都认（SSE § 9.2.5）；末尾无空行的
 *   残块也解析（流式尾部常态）。
 * - 块内多行 `data:`：值按 `\n` 拼接后再 `JSON.parse`（SSE 规范允许跨行 JSON）。
 * - `data:` 值前的一格空格剥离（SSE § 9.2.5.1）。
 * - 以 `:` 起手的行 = 注释 / keep-alive，忽略；不计入 `dataLineCount`。
 * - `event:`/`id:`/`retry:` 等字段忽略——本 lib 只关心 `data` 载荷。
 * - `data: [DONE]`（OpenAI 上游约定的收尾哨兵，本仓 daemon 不发但 mock 发）识别为
 *   `doneCount += 1`，不塞进 events，也不判畸形。
 * - 其它 `data:` 载荷非合法 JSON → **抛错**（不 catch{}）。畸形帧是契约破坏，
 *   必须让门禁判红而不是静默丢。
 * - 返回 `{ events, dataLineCount, doneCount, commentCount, malformedCount, blocks }`，
 *   调用方可用 `dataLineCount === events.length + doneCount` 断言「帧数对回线上」。
 *   `malformedCount` 恒 0（一遇畸形就抛）；保留字段方便调用方日志。
 */

/**
 * @typedef {{
 *   events: unknown[],
 *   dataLineCount: number,
 *   doneCount: number,
 *   commentCount: number,
 *   malformedCount: number,
 *   blocks: number,
 * }} SseParseResult
 */

/**
 * 解析 SSE 文本为事件对象数组。
 *
 * @param {string} text SSE 响应体原文
 * @returns {SseParseResult}
 * @throws {Error} 任一 `data:` 载荷既不是 `[DONE]` 也不是合法 JSON 时抛出；
 *   message 含「SSE」与畸形载荷前缀，方便证据定位。
 */
export function parseSseFrames(text) {
  const events = [];
  let dataLineCount = 0;
  let doneCount = 0;
  let commentCount = 0;
  let blocks = 0;
  if (typeof text !== 'string' || text.length === 0) {
    return { events, dataLineCount, doneCount, commentCount, malformedCount: 0, blocks };
  }
  // 统一行终止符：CRLF 与 CR 都归一为 LF，然后按 `\n\n` 分帧（SSE § 9.2.5）。
  const normalized = text.replace(/\r\n?/g, '\n');
  // 尾部无空行的残块也解析：split 会给出最后一块（末尾若无 `\n\n`）。
  const rawBlocks = normalized.split('\n\n');
  for (const block of rawBlocks) {
    if (block.length === 0) continue; // 纯分隔产生的空块
    blocks += 1;
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.length === 0) continue;
      if (line.startsWith(':')) {
        commentCount += 1;
        continue;
      }
      if (line.startsWith('data:')) {
        // § 9.2.5.1：`data:` 后的第一个空格属于分帧语法，剥离。
        dataLines.push(line.slice(5).replace(/^ /, ''));
        dataLineCount += 1;
      }
      // event:/id:/retry: 等字段忽略——payload 判据只吃 data。
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') {
      doneCount += 1;
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch (cause) {
      const preview = payload.slice(0, 120);
      throw new Error(
        `SSE 畸形帧：data 载荷不是合法 JSON 也非 [DONE]——${preview}（原因：${String(cause)}）`,
      );
    }
  }
  return { events, dataLineCount, doneCount, commentCount, malformedCount: 0, blocks };
}
