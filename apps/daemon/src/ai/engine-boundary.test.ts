/**
 * @dforge/daemon · AI→IR 编译路径不存在的静态守护（TC-AI-04 ② / 票 tp1-02）。
 *
 * 契约：daemon 的 AI 模块只产出**文本响应**（content + suggestions，见 client.ts 头注释），
 * 不 import `@dforge/engine`——Design IR 编译归引擎侧，「AI 文本 → Design IR」编译路径
 * 当前不存在（现状契约）。「校验/编译」是 P5 网关扩展位：接入时随**新票**改写本断言，
 * 不得静默绕过（改写即登记）。
 *
 * 扫描口径（用例真源 TC-AI-04 ②）：正则 = `from` + 引号包裹的模块 id，窗口限定
 * `apps/daemon/src/ai/**`；另覆盖动态 import() 与 require() 两种 import 变体。
 * 三个模式只匹配 import 语法形态，不匹配裸字符串——注释里提及模块名不属编译路径。
 *
 * 自扫描纪律：本测试文件也在扫描窗口内，因此**源码文本不得出现完整的 import 序列字面量**
 * （模式样本一律运行时拼装，见下方自检用例的拼装注释）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** 扫描窗口：daemon AI 模块目录（TC-AI-04 ② 口径）。 */
const AI_MODULE_DIR = resolve(process.cwd(), 'src/ai');

/** AI→IR 编译路径的三种 import 形态（只匹配 import 语法，不匹配注释/裸字符串）。 */
const ENGINE_IMPORT_PATTERNS = [
  /from\s*['"]@dforge\/engine['"]/,
  /import\(\s*['"]@dforge\/engine['"]\s*\)/,
  /require\(\s*['"]@dforge\/engine['"]\s*\)/,
] as const;

/** 递归收集窗口内源码文件（含测试文件：测试同样不得引引擎）。 */
function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(path));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('AI→IR 编译路径静态守护（TC-AI-04 ②：daemon AI 模块无 @dforge/engine import）', () => {
  it('apps/daemon/src/ai/** 全部源码不含任何引擎 import（静态源码扫描）', () => {
    const files = collectSourceFiles(AI_MODULE_DIR);
    // 窗口非空：目录失守（移动/改名）按失败处理，不允许空扫描假绿
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of ENGINE_IMPORT_PATTERNS) {
        if (pattern.test(text)) violations.push(`${file} :: ${String(pattern)}`);
      }
    }
    expect(
      violations,
      `AI 模块出现引擎 import（AI→IR 编译路径不存在=现状契约；P5 接入须随新票改写本断言）：${violations.join('；')}`,
    ).toEqual([]);
  });

  it('扫描器自检：三种 import 形态对人工样本可命中（防模式失效假绿）', () => {
    // 样本运行时拼装：源码文本不得含完整 import 序列（否则上一用例自命中）——
    // 模块 id 带引号成常量，前缀（from / import( / require( )经模板插值接入。
    const quotedId = "'@dforge/engine'";
    const staticForm = `import { compileDesign } ${'from'} ${quotedId};`;
    const dynamicForm = `const m = await import(${quotedId});`;
    const requireForm = `const m = require(${quotedId});`;

    const [staticPattern, dynamicPattern, requirePattern] = ENGINE_IMPORT_PATTERNS;
    expect(staticPattern?.test(staticForm)).toBe(true);
    expect(dynamicPattern?.test(dynamicForm)).toBe(true);
    expect(requirePattern?.test(requireForm)).toBe(true);
    // 同源防呆：拼装后的样本确实含完整序列（拼装本身没写错）
    expect(staticForm).toContain(`${'from'} ${quotedId}`);
  });
});
