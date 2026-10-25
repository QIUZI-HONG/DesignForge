#!/usr/bin/env node
/**
 * verify:motion —— B 层体验门禁 · 动效实际生效（**阶段 0 挂点**；断言实现待阶段 1 接入）。
 *
 * 职责（《前端改造总纲 v1》§3 B 层 + 工单 01 blocker）：对关键流转（菜单/弹窗/抽屉/Toast
 * 入场、悬停过渡）断言**计算样式**里的 animation/transition 时长为有效 ms 且 ≠ 0——
 * F-1（时长令牌落盘 `150px` 致全部组件动效被浏览器静默丢弃）的回归守卫。
 *
 * 数据源（spec「Testing Decisions」）：真 daemon + Next 生产构建 + 真 Chromium，
 * `getComputedStyle` 读计算后的动效值（取计算值而非源码文本，防同类静默失效）；门禁层
 * 单 seam 家族（既有 verify-* 惯例），不测组件内部实现。
 *
 * 现状（挂点语义，禁假绿）：真实现前**恒以 exit 2 阻塞**——不产出任何通过结论。
 * 阶段 1「设计系统底座」票接入真实断言时按 verify-figma-baseline.mjs 的三态模式扩展：
 * 自测夹具证明辨别力 → 导出纯函数判定 → main() 定退出码并落盘证据，届时把本文件的
 * `implemented` 翻 true 并替换 `verifyMotion()` 的判定体。
 *
 * 退出码（门禁三态，**禁止假绿**）：
 *   0 = 通过（挂点阶段不可达——真实现接入前恒不为 0）；
 *   1 = 违规（挂点阶段仅当门禁自证失败——门禁自身坏了绝不装睡）；
 *   2 = 阻塞（挂点阶段恒定值：断言未实现，显式阻塞 CI，禁假绿）。
 *
 * 主模块判定用 `realpath` 比较（非 basename 匹配）：经**符号链接**调用时必须与直调同结论，
 * 否则链接调用会让 `main()` 不执行而以 exit 0 假装通过。
 * 证据落盘沿用 `df.*.evidence/v1` 模式（阻塞也落盘），字段族对照验收标准 §4。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-motion.mjs             # 挂点：恒 exit 2 + 落盘阻塞证据
 *   node scripts/verify-motion.mjs --self-test # 自测夹具（验挂点契约：恒 2、不假绿）
 *
 * 环境变量：DF_EVIDENCE_DIR（证据根，默认 ~/df-evidence）。
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));
const EVIDENCE_DIR = join(EVIDENCE_ROOT, 'frontend-rework-01');

/**
 * 挂点判定（纯函数，供 CLI 与自测/契约测试共用）。
 *
 * 挂点阶段恒「阻塞」：不读环境、不碰浏览器、不产出通过结论。真实现接入时替换本函数体
 * （计算样式断言），并把 `implemented` 翻 true——契约测试
 * `scripts/tests/verify-motion.test.mjs` 锁死「未实现必须 code 2」不变式。
 *
 * @returns {{ code: 0 | 1 | 2, implemented: boolean, summary: string, next: string }}
 */
export function verifyMotion() {
  return {
    code: 2,
    implemented: false,
    summary: '动效实际生效断言未实现（阶段 0 挂点）：不产出任何结论',
    next: '阶段 1「设计系统底座」接入真 Chromium + getComputedStyle 断言（animation/transition 时长为有效 ms 且 ≠ 0）',
  };
}

/** 自测夹具：证明挂点契约（未实现恒 2、明示挂点语义、绝不假绿）。 */
export function selfTest() {
  const result = verifyMotion();
  const cases = [
    ['未实现恒阻塞（code 2）', result.code, 2],
    ['implemented 显式为 false', result.implemented, false],
  ];
  const failed = cases.filter(([, actual, expected]) => actual !== expected);
  for (const [name, actual, expected] of cases) {
    console.error(
      `  ${actual === expected ? '✓' : '✗'} ${name}（实际 ${String(actual)} / 期望 ${String(expected)}）`,
    );
  }
  return { ok: failed.length === 0, total: cases.length, failed: failed.length };
}

/** 落盘证据（与各 verify-* 同口径：阻塞也落盘）。 */
function writeEvidence(result) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = join(
    EVIDENCE_DIR,
    `verify-motion-${new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')}.json`,
  );
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        ticket: 'RW-01',
        gate: 'verify-motion',
        page: '（关键流转：菜单/弹窗/抽屉/Toast 入场、悬停过渡）',
        level: 'B（动效实际生效：计算样式时长为有效 ms 且 ≠ 0）',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ...result,
        // 验收标准 §4 字段族：挂点阶段无浏览器产物 → 三项 null + 说明
        diff: {
          bbox: null,
          diffPixels: null,
          ratio: null,
          note: '挂点阶段：断言未实现，不跑浏览器、不产截图（真实现接入后按 getComputedStyle 断言落盘）',
        },
        artifacts: { ref: null, actual: null, diff: null },
        humanReview: {
          verdict: 'pending',
          reviewer: null,
          reason: '挂点阻塞（exit 2）：动效断言待阶段 1 接入，此证据仅记录门禁状态',
        },
        exitCode: result.code,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return evidencePath;
}

function main() {
  if (process.argv.slice(2).includes('--self-test')) {
    const result = selfTest();
    console.error(
      result.ok
        ? `自测通过：${String(result.total)} 例（挂点契约：未实现恒 2、不假绿）`
        : `自测失败：${String(result.failed)}/${String(result.total)} 例`,
    );
    return result.ok ? 0 : 1;
  }

  // 硬自证：每次实跑先验挂点契约；自测失败 = 门禁自身坏了，按违规退出（绝不带着坏门禁装睡）。
  const gate = selfTest();
  if (!gate.ok) {
    console.error(
      `门禁自测未通过（${String(gate.failed)}/${String(gate.total)} 例）——本门禁此刻不可信。`,
    );
    return 1;
  }

  const result = verifyMotion();
  const evidencePath = writeEvidence(result);
  console.error(
    [
      `阻塞：${result.summary}（挂点恒 exit 2，禁假绿——CI 不得据此视为通过）。`,
      `待办：${result.next}`,
      `证据：${evidencePath}`,
    ].join('\n'),
  );
  return result.code;
}

/**
 * 是否作为主模块直跑。
 *
 * 为什么用 `realpath` 比较而不是 basename 后缀匹配：basename 匹配在**经符号链接调用**时
 * 会判 false（`argv[1]` 是链接名，与真实文件名不同）→ `main()` 整个不执行、进程以 exit 0 结束，
 * 表现为「零校验的假绿」。realpath 把两侧都解析到真实文件再比较，链接调用与直调行为一致。
 */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main());
