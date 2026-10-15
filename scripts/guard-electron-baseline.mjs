#!/usr/bin/env node
/**
 * guard-electron-baseline —— 桌面壳安全基线守卫（FE-12 落地）。
 *
 * 做什么：**静态读** `apps/desktop/src/main/window-options.ts` 的对象字面量，断言五项安全开关：
 *   contextIsolation=true / sandbox=true / nodeIntegration=false / webSecurity=true /
 *   allowRunningInsecureContent=false；
 * 并断言「基线是直接展开、不得被后置覆盖」——防「先展开基线、随后悄悄放宽」的写法；
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

/** 静态检查二：`buildWindowOptions` 的 `webPreferences` 必须是基线的直接展开且无后置覆盖。 */
function checkWindowPreferences(sourceFile) {
  const violations = [];
  const undetermined = [];
  let webPreferencesObject;

  sourceFile.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== 'buildWindowOptions' || !node.body) {
      return;
    }
    for (const statement of node.body.statements) {
      if (!ts.isReturnStatement(statement) || !statement.expression) {
        continue;
      }
      if (!ts.isObjectLiteralExpression(statement.expression)) {
        continue;
      }
      for (const property of statement.expression.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'webPreferences' &&
          ts.isObjectLiteralExpression(property.initializer)
        ) {
          webPreferencesObject = property.initializer;
        }
      }
    }
  });

  if (!webPreferencesObject) {
    undetermined.push('未找到 buildWindowOptions 里 `webPreferences` 的对象字面量（静态无法判定）');
    return { violations, undetermined };
  }

  let spreadIndex = -1;
  webPreferencesObject.properties.forEach((property, index) => {
    if (
      ts.isSpreadAssignment(property) &&
      ts.isIdentifier(property.expression) &&
      property.expression.text === BASELINE_CONST
    ) {
      spreadIndex = index;
    }
  });

  if (spreadIndex < 0) {
    violations.push(`buildWindowOptions 的 webPreferences 没有直接展开 ${BASELINE_CONST}`);
    return { violations, undetermined };
  }

  webPreferencesObject.properties.forEach((property, index) => {
    if (
      index <= spreadIndex ||
      !ts.isPropertyAssignment(property) ||
      !ts.isIdentifier(property.name)
    ) {
      return;
    }
    if (property.name.text in EXPECTED_BASELINE) {
      violations.push(
        `webPreferences 在展开 ${BASELINE_CONST} **之后**又覆盖了 ${property.name.text}（后置放宽不被允许）`,
      );
    }
  });

  return { violations, undetermined };
}

/** 静态检查三：`main.ts` 的窗口打开策略。 */
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
    const preferences = checkWindowPreferences(sourceFile);
    const mainChecks = isFixtureRun ? { violations: [], undetermined: [] } : checkMainProcess();

    report.violations.push(
      ...literal.violations,
      ...preferences.violations,
      ...mainChecks.violations,
    );
    report.undetermined.push(
      ...literal.undetermined,
      ...preferences.undetermined,
      ...mainChecks.undetermined,
    );
    report.found = literal.found;
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
