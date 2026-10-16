#!/usr/bin/env node
/**
 * guard-electron-baseline —— 桌面壳安全基线守卫（FE-12 落地）。
 *
 * 做什么：**静态读** `apps/desktop/src/main/window-options.ts` 的对象字面量，断言五项安全开关：
 *   contextIsolation=true / sandbox=true / nodeIntegration=false / webSecurity=true /
 *   allowRunningInsecureContent=false；
 * 并断言基线的**声明点纪律**（防「先展开基线、随后悄悄放宽」这类可绕过写法）：
 *   1. 全文件 `webPreferences` 声明点唯一（多声明点 = 宽松分支可绕过静态判定 → exit 1）；
 *   2. 声明点必须**直接展开** `SECURITY_BASELINE`；
 *   3. 展开之后不得以**任意语法**再引入基线键——标识符键 / 字符串键 / 计算字符串键 /
 *      简写属性 / 展开对象字面量 / 展开局部常量（含多跳展开链，递归解析）；
 *   4. 展开的目标若**静态判不出**（外部对象、重名定义、展开成环）→ 记「无法判定」→ exit 2（阻塞），
 *      既不放行也不误报。
 * 再看 `main.ts`：必须有 `setWindowOpenHandler` 且一律 deny（外链走白名单，见 external-links.ts）。
 *
 * 为什么静态优先：静态读能给出点位级违规信息且不必起窗；只有当某项**静态判不出来**时，才退到运行时
 * 探针（`electron . --df-baseline-probe`：读 preload 侧 sandbox/contextIsolation、页面侧无 Node 全局、
 * 跨源 CORS 探针）。Electron 44 已无 `getLastWebPreferences()`（票面写法对不上实现，已记录）。
 *
 * 用法：node scripts/guard-electron-baseline.mjs [--json] [--source=<窗口选项文件>] [--probe|--no-probe]
 * 退出码：**0 = 通过 / 1 = 违规 / 2 = 阻塞（无法判定或前置条件不成立）**。
 * 说明：给了 `--source`（fixture 反例测试）时**自动禁用**运行时探针——fixture 不是可运行的壳。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = join(REPO_ROOT, 'apps', 'desktop', 'src', 'main', 'window-options.ts');
const MAIN_SOURCE = join(REPO_ROOT, 'apps', 'desktop', 'src', 'main', 'main.ts');
const ELECTRON_APP_DIR = join(REPO_ROOT, 'apps', 'desktop');

/** 期望值：五项硬断言——本守卫是它的唯一机器可读声明，改动必须走票面。 */
const EXPECTED_BASELINE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
};

const BASELINE_CONST = 'SECURITY_BASELINE';
const PROBE_PREFIX = 'DFORGE_BASELINE_PROBE:';

/** 从 argv 取 `--name=value`。 */
function readArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

const sourceArg = readArg('source');
const sourcePath = sourceArg ? resolve(sourceArg) : DEFAULT_SOURCE;
const isFixtureRun = sourcePath !== DEFAULT_SOURCE;
const jsonMode = process.argv.includes('--json');
const probeFlag = process.argv.includes('--probe');
const probeDisabled = process.argv.includes('--no-probe') || isFixtureRun;

/** 读取源码文本；失败返回 `{ error }`。 */
function readSource(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `读取不到 ${path}：${String(error)}` };
  }
}

/** 解析出 AST（纯语法 + 字面量求值，不做类型检查）。 */
function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** 取对象字面量里某个属性的字面量值；非字面量或缺失返回 undefined（= 静态判不出）。 */
function literalPropertyValue(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      continue;
    }
    if (property.name.text !== name) {
      continue;
    }
    const initializer = property.initializer;
    if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) {
      return initializer.text;
    }
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }
    return undefined;
  }
  return undefined;
}

/** 找 `export const <name> = <对象字面量>`。 */
function findExportedObjectLiteral(sourceFile, name) {
  let found;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== name ||
        !declaration.initializer
      ) {
        continue;
      }
      // 兼容 `as const` / `satisfies X` 包裹：基线常量常用它们约束形状，静态读须先剥壳。
      let initializer = declaration.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (ts.isObjectLiteralExpression(initializer)) {
        found = initializer;
      }
    }
  });
  return found;
}

/** 静态检查一：基线常量五项取值。 */
function checkBaselineLiteral(sourceFile) {
  const violations = [];
  const undetermined = [];
  const undeterminedKeys = [];
  const objectLiteral = findExportedObjectLiteral(sourceFile, BASELINE_CONST);

  if (!objectLiteral) {
    undetermined.push(`未找到 ${BASELINE_CONST} 对象字面量（静态无法判定五项取值）`);
    undeterminedKeys.push(...Object.keys(EXPECTED_BASELINE));
    return { violations, undetermined, undeterminedKeys, found: {} };
  }

  const found = {};
  for (const [key, expected] of Object.entries(EXPECTED_BASELINE)) {
    const actual = literalPropertyValue(objectLiteral, key);
    if (actual === undefined) {
      undeterminedKeys.push(key);
      undetermined.push(
        `${BASELINE_CONST}.${key} 非字面量或缺失（静态无法判定，期望 ${String(expected)}）`,
      );
      continue;
    }
    found[key] = actual;
    if (actual !== expected) {
      violations.push(`${BASELINE_CONST}.${key} = ${String(actual)}，期望 ${String(expected)}`);
    }
  }
  return { violations, undetermined, undeterminedKeys, found };
}

/**
 * 静态属性名：标识符 / 字符串字面量 / 数字字面量 / 计算属性里的字符串字面量。
 * 返回 `string` = 静态可判的名字；`null` = 不是数据属性（方法/存取器/展开）；`undefined` = 动态键（判不出）。
 */
function propertyKeyName(property) {
  if (ts.isSpreadAssignment(property)) return null;
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
    return null;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/** 收集同文件内的「变量名 → 初始值表达式」（任意作用域）；重名进 ambiguous（判不出即阻塞，禁瞎猜）。 */
function collectVariableInitializers(sourceFile) {
  const initializers = new Map();
  const ambiguous = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (initializers.has(name)) ambiguous.add(name);
      else initializers.set(name, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { initializers, ambiguous };
}

/** 剥掉 `as const` / `satisfies X` 裹壳（静态取值只看里层表达式；同 findExportedObjectLiteral 口径）。 */
function unwrapWrappers(expression) {
  let target = expression;
  while (ts.isAsExpression(target) || ts.isSatisfiesExpression(target)) {
    target = target.expression;
  }
  return target;
}

/**
 * 解析「展开表达式」可能引入的键集合（递归跟进同文件常量与多跳展开链）。
 * 返回 `{ ok: true, keys, unresolved }` 或 `{ ok: false, reason }`；不可判定一律交给调用方记阻塞。
 */
function resolveSpreadKeys(expression, context, visited = new Set()) {
  const target = unwrapWrappers(expression);
  if (ts.isObjectLiteralExpression(target)) {
    return collectObjectKeys(target, context, visited);
  }
  if (ts.isIdentifier(target)) {
    const name = target.text;
    if (context.ambiguous.has(name)) {
      return { ok: false, reason: `...${name} 重名定义，无法静态确定指向` };
    }
    const initializer = context.initializers.get(name);
    if (initializer === undefined) {
      return { ok: false, reason: `...${name} 无同文件字面量定义（外部/动态对象）` };
    }
    if (visited.has(name)) return { ok: false, reason: `...${name} 展开成环` };
    return resolveSpreadKeys(initializer, context, new Set(visited).add(name));
  }
  return { ok: false, reason: `${expression.getText()} 非字面量展开（静态判不出）` };
}

/** 对象字面量是否**直接**展开了基线常量（只看本层，不跟进变量）。 */
function hasDirectBaselineSpread(objectLiteral) {
  return objectLiteral.properties.some(
    (property) =>
      ts.isSpreadAssignment(property) &&
      ts.isIdentifier(property.expression) &&
      property.expression.text === BASELINE_CONST,
  );
}

/** 对象字面量引入的键集合（含嵌套展开，递归）；`unresolved` 收集判不出的子项。 */
function collectObjectKeys(objectLiteral, context, visited) {
  const keys = new Set();
  const unresolved = [];
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const resolved = resolveSpreadKeys(property.expression, context, visited);
      if (!resolved.ok) {
        unresolved.push(resolved.reason);
        continue;
      }
      for (const key of resolved.keys) keys.add(key);
      for (const item of resolved.unresolved) unresolved.push(item);
      continue;
    }
    const key = propertyKeyName(property);
    if (typeof key === 'string') keys.add(key);
    else if (key === undefined) unresolved.push('展开对象内出现动态计算属性名');
  }
  return { ok: true, keys, unresolved };
}

/**
 * 静态检查二：全文件 `webPreferences` 声明点唯一（宽松分支/变量返回均可绕过单点检查）。
 */
function checkWebPreferencesUniqueness(sourceFile) {
  const violations = [];
  const undetermined = [];
  const declarationPoints = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && propertyKeyName(node) === 'webPreferences') {
      declarationPoints.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (declarationPoints.length === 0) {
    undetermined.push(
      '未找到 `webPreferences` 声明点（静态无法判定；动态键或另一文件写入即钻空子）',
    );
    return { violations, undetermined, declarationPoints };
  }
  if (declarationPoints.length > 1) {
    const lines = declarationPoints
      .map((node) =>
        String(node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1),
      )
      .join('、');
    violations.push(
      `webPreferences 声明点不唯一（${String(declarationPoints.length)} 处：行 ${lines}）——` +
        '安全基线必须只有一处声明，多余声明点可让宽松配置绕过静态判定',
    );
  }
  return { violations, undetermined, declarationPoints };
}

/**
 * 静态检查三：单个 `webPreferences` 声明点必须是基线的直接展开且展开后不得再引入基线键。
 * 键写法（标识符/字符串/计算字符串/简写）与展开放宽（字面量/局部常量/多跳链）一视同仁。
 */
function checkWebPreferencesObject(declaration, context) {
  const violations = [];
  const undetermined = [];
  const line =
    declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1;
  const label = `webPreferences（行 ${String(line)}）`;
  const initializer = unwrapWrappers(declaration.initializer);

  // 声明点取值经「标识符」间接化：**违规**（基线必须就地直接展开），且要把「间接但确实
  // 展开了」与「压根没展开」分开说；间接目标仍按同一套展开/覆盖规则复核，避免漏报。
  if (ts.isIdentifier(initializer)) {
    const name = initializer.text;
    const resolved = resolveSpreadKeys(initializer, context);
    if (!resolved.ok) {
      undetermined.push(`${label}：取值 ${resolved.reason}`);
      return { violations, undetermined };
    }
    const target = context.initializers.get(name);
    const targetLiteral = target === undefined ? undefined : unwrapWrappers(target);
    const directlySpread =
      targetLiteral !== undefined &&
      ts.isObjectLiteralExpression(targetLiteral) &&
      hasDirectBaselineSpread(targetLiteral);
    violations.push(
      directlySpread
        ? `${label}：取值经变量 ${name} 间接展开 ${BASELINE_CONST}——安全基线必须就地直接展开，禁止间接化`
        : `${label}：经变量 ${name} 指向的对象没有展开 ${BASELINE_CONST}`,
    );
    if (targetLiteral !== undefined && ts.isObjectLiteralExpression(targetLiteral)) {
      const inner = checkPreferencesLiteral(targetLiteral, `${label} · 经变量 ${name}`, context);
      violations.push(...inner.violations);
      undetermined.push(...inner.undetermined);
    }
    return { violations, undetermined };
  }
  if (!ts.isObjectLiteralExpression(initializer)) {
    undetermined.push(`${label}：取值非对象字面量（${initializer.getText()}）——静态判不出`);
    return { violations, undetermined };
  }

  const literal = checkPreferencesLiteral(initializer, label, context);
  return { violations: literal.violations, undetermined: literal.undetermined };
}

/** 对象字面量级检查：直接展开基线 + 展开后不得再引入基线键（任意键语法/任意展开源）。 */
function checkPreferencesLiteral(objectLiteral, label, context) {
  const violations = [];
  const undetermined = [];
  let baselineSpreadIndex = -1;
  objectLiteral.properties.forEach((property, index) => {
    if (
      ts.isSpreadAssignment(property) &&
      ts.isIdentifier(property.expression) &&
      property.expression.text === BASELINE_CONST
    ) {
      baselineSpreadIndex = index;
    }
  });

  if (baselineSpreadIndex < 0) {
    violations.push(`${label}：没有直接展开 ${BASELINE_CONST}（安全基线必须就地唯一展开）`);
    return { violations, undetermined };
  }

  objectLiteral.properties.forEach((property, index) => {
    if (index <= baselineSpreadIndex) return;
    if (ts.isSpreadAssignment(property)) {
      const resolved = resolveSpreadKeys(property.expression, context);
      if (!resolved.ok) {
        undetermined.push(
          `${label} 在展开 ${BASELINE_CONST} 之后又展开：${resolved.reason}——无法确认是否覆盖基线键`,
        );
        return;
      }
      for (const key of resolved.keys) {
        if (key in EXPECTED_BASELINE) {
          violations.push(
            `${label} 在展开 ${BASELINE_CONST} **之后**经展开又覆盖了 ${key}（后置放宽不被允许）`,
          );
        }
      }
      for (const item of resolved.unresolved) {
        undetermined.push(`${label} 内的展开存在无法判定的键：${item}`);
      }
      return;
    }
    const key = propertyKeyName(property);
    if (key === undefined) {
      undetermined.push(
        `${label} 在展开 ${BASELINE_CONST} 之后出现动态计算属性名——静态判不出，禁止当作合规`,
      );
      return;
    }
    if (key === null) return; // 方法/存取器：不对基线五项构成数据覆盖
    if (key in EXPECTED_BASELINE) {
      violations.push(
        `${label} 在展开 ${BASELINE_CONST} **之后**又覆盖了 ${key}（后置放宽不被允许）`,
      );
    }
  });

  return { violations, undetermined };
}

/** 静态检查四：`main.ts` 的窗口打开策略。 */
function checkMainProcess() {
  const violations = [];
  const undetermined = [];
  const text = readSource(MAIN_SOURCE);
  if (typeof text === 'object') {
    undetermined.push(text.error);
    return { violations, undetermined };
  }

  if (!text.includes('setWindowOpenHandler')) {
    violations.push('main.ts 未调用 setWindowOpenHandler（新窗口策略缺失）');
  } else if (!/action:\s*'deny'/.test(text)) {
    violations.push("main.ts 的 setWindowOpenHandler 未硬性返回 { action: 'deny' }");
  }
  if (/\bnodeIntegration:\s*true\b/.test(text)) {
    violations.push('main.ts 中出现 nodeIntegration: true');
  }
  if (/\benableRemoteModule\b/.test(text) || /from\s+'electron\/remote'/.test(text)) {
    violations.push('main.ts 出现 remote 模块用法（早期 Electron 的越权通道）');
  }
  return { violations, undetermined };
}

/** 运行时探针：跑一次壳读实测值（仅当静态判不出、或显式 --probe 时用）。 */
function runRuntimeProbe() {
  const electronBinary = join(ELECTRON_APP_DIR, 'node_modules', 'electron', 'dist', 'electron');
  const builtMain = join(ELECTRON_APP_DIR, 'dist', 'main', 'main.js');
  if (!existsSync(electronBinary)) {
    return {
      blocked: `Electron 二进制缺失（${electronBinary}）：跑 pnpm --filter @dforge/desktop fetch-electron 落地`,
    };
  }
  if (!existsSync(builtMain)) {
    return { blocked: `壳未构建（${builtMain}）：跑 pnpm --filter @dforge/desktop build` };
  }

  const result = spawnSync(electronBinary, [ELECTRON_APP_DIR, '--df-baseline-probe'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: process.env,
  });
  const line = (result.stdout ?? '')
    .split('\n')
    .find((candidate) => candidate.startsWith(PROBE_PREFIX));
  if (!line) {
    const tail = (result.stderr ?? '').trim().split('\n').slice(-2).join(' | ');
    return { blocked: `运行时探针未产出结果（exit=${String(result.status)}）：${tail}` };
  }
  return { probe: JSON.parse(line.slice(PROBE_PREFIX.length)) };
}

/** 主流程。 */
function main() {
  const text = readSource(sourcePath);
  const report = {
    source: sourcePath,
    expected: EXPECTED_BASELINE,
    found: {},
    violations: [],
    undetermined: [],
    probeNotes: [],
    probe: null,
  };

  const staticallyUndeterminedKeys = new Set();

  if (typeof text === 'object') {
    report.undetermined.push(text.error);
  } else {
    const sourceFile = parse(sourcePath, text);
    const literal = checkBaselineLiteral(sourceFile);
    const uniqueness = checkWebPreferencesUniqueness(sourceFile);
    const context = collectVariableInitializers(sourceFile);
    const preferencesViolations = [];
    const preferencesUndetermined = [];
    for (const declaration of uniqueness.declarationPoints) {
      const result = checkWebPreferencesObject(declaration, context);
      preferencesViolations.push(...result.violations);
      preferencesUndetermined.push(...result.undetermined);
    }
    const mainChecks = isFixtureRun ? { violations: [], undetermined: [] } : checkMainProcess();

    report.violations.push(
      ...literal.violations,
      ...uniqueness.violations,
      ...preferencesViolations,
      ...mainChecks.violations,
    );
    report.undetermined.push(
      ...literal.undetermined,
      ...uniqueness.undetermined,
      ...preferencesUndetermined,
      ...mainChecks.undetermined,
    );
    report.found = literal.found;
    report.declarationPoints = uniqueness.declarationPoints.length;
    for (const key of literal.undeterminedKeys ?? []) {
      staticallyUndeterminedKeys.add(key);
    }
  }

  // 静态判不出（或显式 --probe 要求交叉验证）→ 跑一次运行时探针
  const wantProbe = probeFlag && !probeDisabled;
  if (
    report.violations.length === 0 &&
    (wantProbe || report.undetermined.length > 0) &&
    !probeDisabled
  ) {
    const probe = runRuntimeProbe();
    if (probe.blocked) {
      report.undetermined.push(probe.blocked);
    } else {
      report.probe = probe.probe;
      report.violations.push(...(probe.probe.violations ?? []));
      // 逐键并集：**静态判不出的键**由运行时补；静态已判定的键即便运行时也测不到，也不得翻盘成阻塞。
      for (const item of probe.probe.undetermined ?? []) {
        const key = String(item).replace(/^安全基线 ([\w]+) .*/, '$1');
        if (staticallyUndeterminedKeys.has(key)) {
          report.undetermined.push(item);
        } else {
          report.probeNotes.push(item);
        }
      }
    }
  }

  const exitCode = report.violations.length > 0 ? 1 : report.undetermined.length > 0 ? 2 : 0;
  report.exitCode = exitCode;

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [`guard-electron-baseline：源 ${report.source}`];
    for (const violation of report.violations) {
      lines.push(`  ✗ ${violation}`);
    }
    for (const item of report.undetermined) {
      lines.push(`  ? ${item}`);
    }
    lines.push(
      exitCode === 0
        ? '  ✓ 安全基线五项静态判定通过'
        : exitCode === 1
          ? '  结论：违规（exit 1）'
          : '  结论：阻塞——无法判定（exit 2，禁止当作通过）',
    );
    process.stderr.write(`${lines.join('\n')}\n`);
  }

  process.exit(exitCode);
}

main();
