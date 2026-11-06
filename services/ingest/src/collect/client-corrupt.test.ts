/**
 * parseRecordedResponses 对坏 JSONL 行的容错（audit-d05 · D-07 回归）。
 *
 * 缺陷基线（~/df-evidence/audit-2026-11/quality/q8-q9-red.log · Q9）：client.ts 对每行
 * 裸 `JSON.parse`——重放样本一行损坏文本即整批 SyntaxError，离线重放全阻。
 * 修复口径：坏行跳过 + 逐行告警（行号/原文可见），好行照常解析。
 */

import { describe, expect, it } from 'vitest';

import { parseRecordedResponses } from './client.ts';

/** 收集告警（替换缺省 stderr 出口，供断言计数与文本）。 */
function captureWarnings(): { warnings: string[]; options: { onWarning: (w: string) => void } } {
  const warnings: string[] = [];
  return { warnings, options: { onWarning: (warning) => warnings.push(warning) } };
}

describe('parseRecordedResponses 对坏行的容错（D-07）', () => {
  it('坏行跳过，好行照常解析', () => {
    const jsonl = '{"url":"https://a","status":200,"body":"{}"}\n{corrupted\n';
    const { warnings, options } = captureWarnings();
    const out = parseRecordedResponses(jsonl, options);
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe('https://a');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('第 2 行');
  });

  it('多坏行逐行计数；空行仍按既有口径跳过且不告警', () => {
    const jsonl = [
      '',
      '{"url":"https://a","status":200,"etag":null,"linkNext":null,"body":{}}',
      'not-json-at-all',
      '',
      '{"url":"https://b","status":200,"etag":null,"linkNext":null,"body":{}}',
      '{"no-url":true}',
    ].join('\n');
    const { warnings, options } = captureWarnings();
    const out = parseRecordedResponses(jsonl, options);
    expect(out).toHaveLength(2);
    expect(out[0]?.url).toBe('https://a');
    expect(out[1]?.url).toBe('https://b');
    // 坏行 2 条（第 3 行非 JSON、第 6 行缺 url）——空行不告警（既有口径）
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('不是合法 JSON');
    expect(warnings[1]).toContain('缺 url');
  });

  it('未注入 onWarning：缺省写 stderr（不许静默吞）', () => {
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = parseRecordedResponses('{"url":"https://a"}\n{corrupted\n');
      expect(out).toHaveLength(1);
    } finally {
      process.stderr.write = original;
    }
    expect(writes.some((line) => line.includes('重放样本第 2 行'))).toBe(true);
  });
});
