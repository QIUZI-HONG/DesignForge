/**
 * JUnit XML 生成（#107 · 审计 10a · flake 遥测）。
 *
 * 用途：e2e runner 把步骤级结果写成 JUnit，便于 CI/本地用同一份格式统计
 * 「哪一步失败、失败几次」。本模块只做**如实映射**：pass → testcase；fail → failure；
 * blocked → skipped（三态语义不变，blocked 不是通过）。不做重试、不改变状态。
 *
 * 纪律：
 * - 不引入 XML 依赖（产物是固定形状的扁平结构），只做必要的转义；
 * - 所有计数从输入现算，不从 runner 的 summary 抄，避免两处数字漂移。
 */

/** XML 1.0 合法字符：去掉控制字符（保留 \t \n \r），非法码点替换为 U+FFFD。 */
function sanitize(value) {
  let out = '';
  for (const char of String(value)) {
    const code = char.codePointAt(0) ?? 0;
    const control =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f);
    if (control) continue;
    out += code === 0xfffe || code === 0xffff ? '\uFFFD' : char;
  }
  return out;
}

/** 转义 XML 文本/属性（& 必须最先替换）。 */
export function escapeXml(value) {
  return sanitize(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** 秒数（毫秒 → 3 位小数字符串）；未知时长返回 '0'。 */
function seconds(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '0';
  return (ms / 1000).toFixed(3);
}

/** 步骤计数（三态；未知状态按 fail 记账，避免静默吞掉）。 */
export function countSteps(steps) {
  const counts = { steps: 0, passed: 0, failed: 0, blocked: 0 };
  for (const step of steps) {
    counts.steps += 1;
    if (step.status === 'pass') counts.passed += 1;
    else if (step.status === 'blocked') counts.blocked += 1;
    else counts.failed += 1;
  }
  return counts;
}

/** 单个 testcase（pass 空元素；fail/blocked 带原因）。 */
function testcaseXml(className, step) {
  const name = escapeXml(step.name ?? '(未命名步骤)');
  const detail = escapeXml(step.detail ?? step.name ?? '');
  const time = seconds(step.durationMs);
  if (step.status === 'pass') {
    return `    <testcase classname="${escapeXml(className)}" name="${name}" time="${time}"/>`;
  }
  if (step.status === 'blocked') {
    return [
      `    <testcase classname="${escapeXml(className)}" name="${name}" time="${time}">`,
      `      <skipped message="${detail}"/>`,
      '    </testcase>',
    ].join('\n');
  }
  return [
    `    <testcase classname="${escapeXml(className)}" name="${name}" time="${time}">`,
    `      <failure message="${detail}"/>`,
    '    </testcase>',
  ].join('\n');
}

/** 一个场景/门禁段 → testsuite。 */
function suiteXml(className, suiteName, steps) {
  const counts = countSteps(steps);
  const time = seconds(
    steps.reduce(
      (sum, step) => sum + (typeof step.durationMs === 'number' ? step.durationMs : 0),
      0,
    ),
  );
  const cases = steps.map((step) => testcaseXml(className, step)).join('\n');
  return [
    `  <testsuite name="${escapeXml(suiteName)}" tests="${counts.steps}" failures="${counts.failed}" skipped="${counts.blocked}" errors="0" time="${time}">`,
    cases,
    '  </testsuite>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * 生成 JUnit XML。
 *
 * @param {{
 *   name?: string,
 *   startedAt?: string,
 *   finishedAt?: string,
 *   exitCode?: number,
 *   scenarios?: Array<{ id?: string, steps?: Array<{ name: string, status: string, detail?: string, durationMs?: number }> }>,
 *   editorGate?: { steps?: Array<{ name: string, status: string, detail?: string, durationMs?: number }> } | null,
 *   blockedReason?: string,
 * }} input
 * @returns {string} 完整 XML（含声明与末尾换行）
 */
export function buildJUnitXml(input = {}) {
  const name = input.name ?? 'e2e-smoke';
  const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  const suites = [];
  for (const scenario of scenarios) {
    const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
    if (steps.length === 0) continue;
    suites.push(suiteXml(`e2e.${scenario.id ?? 'scenario'}`, scenario.id ?? 'scenario', steps));
  }
  const editorSteps = Array.isArray(input.editorGate?.steps) ? input.editorGate.steps : [];
  if (editorSteps.length > 0) {
    suites.push(suiteXml('e2e.editor-gate', 'editor-gate', editorSteps));
  }

  // 早退（站点/daemon/浏览器起不来）时没有步骤：仍产出一条 runner 级结果，
  // 让 JUnit 的 skipped/failure 与三态退出码对齐，不出现「0 tests 全绿」的假象。
  if (suites.length === 0) {
    const steps = [
      {
        name: 'runner 启动',
        status: input.exitCode === 2 ? 'blocked' : input.exitCode === 0 ? 'pass' : 'fail',
        detail: input.blockedReason ?? `runner 未产出步骤（exit ${String(input.exitCode ?? '?')}）`,
      },
    ];
    suites.push(suiteXml('e2e.runner', 'runner', steps));
  }

  const allCases = scenarios.flatMap((scenario) =>
    Array.isArray(scenario.steps) ? scenario.steps : [],
  );
  const allSteps = [...allCases, ...editorSteps];
  const counts = countSteps(allSteps);
  const started = Date.parse(input.startedAt ?? '');
  const finished = Date.parse(input.finishedAt ?? '');
  const totalTime =
    Number.isFinite(started) && Number.isFinite(finished) && finished >= started
      ? seconds(finished - started)
      : '0';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(name)}" tests="${counts.steps}" failures="${counts.failed}" skipped="${counts.blocked}" errors="0" time="${totalTime}">`,
    ...suites,
    '</testsuites>',
    '',
  ].join('\n');
}
