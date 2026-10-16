#!/usr/bin/env node
/**
 * guard-feature-boundaries —— feature 边界守卫（工作包 E · ADR-0004 ② 的机检化）。
 *
 * 做什么：断言 `apps/web/src` 的**跨 feature 深导入归零**——消费方（其它 feature 与
 * `app/**` 路由层）对 feature 的引用只能落在公开面 `@/features/<name>`（= `features/<name>/index.ts`）上：
 *
 *   双侧判据（两个根，取批次 2 独立复核脚本 `check-feature-imports.mjs` 的实现思路）：
 *     - **features 根**（feature→feature）：`features/<own>/**` 里引 `@/features/<other>/<深路径>` → 违规；
 *       自身 feature 的深路径（`@/features/<own>/…`）是 feature 内部事，放行；
 *     - **app 根**（app→feature）：`app/**` 里引 `@/features/<name>/<深路径>` → 违规。
 *   「深于公开面」= `@/features/<name>` 之后再有任何一段路径（`index` 也算深，只是等价写法，
 *   报错会给公开面提示）；`@/features/<name>` 本身即公开面。
 *
 * 登记例外（REGISTERED_EXCEPTIONS，评审可见；**只对 app 根生效**）：
 *   ① `register` 注册接缝——ADR-0004 ②「唯一第二入口（具名例外）」：FE-03 插槽约定的挂载接缝
 *      `features/<name>/register` 只允许 `app/**` 路由层引其引导组件（`setWorkspaceBootstrap` /
 *      `createReviewSession` 一类模块级副作用，故刻意不经 index.ts 转出）。**feature 之间禁引**
 *      （ADR 原文）——feature 引他 feature 的 register 仍判违规，报错注明依据。
 *   ② 样式入口 `*.css`——ADR-0004 ② 的公开面只导出「组件 / 工厂 / hook / 类型 / 页面级纯逻辑」，
 *      样式资源无从 `index.ts` 转出（转出即等于给所有公开面消费方带上全局样式副作用，与本仓
 *      对 register 的处理同理）；Next 路由层直引 feature 样式是既有接线
 *      （`app/page.tsx` → `home.css`、`app/editor/layout.tsx` → `editor-shell.css`）。**限 app 根**：
 *      feature→feature 引他 feature 样式仍判违规（避免把别人的全局样式带进本 feature 包体）。
 *   除这两类外，任何深路径都不得放行（brief 工作包 E 口径）。判据实现与 prior art 一致采用
 *   「字面量模块符」静态读；本守卫把范围**写明**而不是静默：未判读的形态见「局限」。
 *
 * 判读的模块符形态（超出 prior art 的 `from '…'` 单一形态，防「换写法即绕过」）：
 *   - 静态 import（含无绑定的副作用导入 `import '@/features/x/y';`）与 `export … from`；
 *   - 动态 `import('…')` 与 `require('…')`：实参是字符串字面量（或无插值模板）时按同一判据判；
 *     实参判不出（含插值模板 / 表达式）但**可能指向 `@/features`** 时 → 记「无法判定」→ exit 2（阻塞）；
 *   - 相对模块符（`../../<other>/…`）：按导入方所在目录解析后，若落进 features 根的某个 feature
 *     再按同一判据判（只有 `@/…` 一种写法才判 = 留一个换写法就绕过的洞）。
 *
 * 局限（诚实声明，勿当已覆盖）：
 *   - 判据只覆盖**双侧根**（`features/**` 与 `app/**`）。`verify/`（白盒对抗套件，按设计直取内部件）、
 *     `lib/`、`i18n/` 不在判据内——报告 `scope.excluded` 会逐项列出，不静默缺席（其深导入现状见票面记录）。
 *   - 完全判不出目标、且文本不含 `@/features` 的动态导入（如 `import(someVar)`）不计入；真指向
 *     feature 的写法（模板 / 拼接含 `@/features`）会被记「无法判定」而阻塞。
 *   - 测试内的 mock 路径（`vi.mock('@/features/…')` 一类）不判——它不是导入，且主要出现在
 *     测试缝内；如成为绕过面，按同族规则并入即可。
 *
 * 用法：node scripts/guard-feature-boundaries.mjs [--json] [--root=<web-src 根>]
 * 退出码（门禁三态，禁止假绿）：0 通过 / 1 违规（跨 feature 深导入）/ 2 阻塞（前置不成立 / 判不出）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

import { collectFiles, displayPath, REPO_ROOT, readArg, readText } from './lib/guard-io.mjs';

const DEFAULT_ROOT = join(REPO_ROOT, 'apps', 'web', 'src');
/** 公开面别名前缀（tsconfig paths：`@/*` → `./src/*`）。 */
const ALIAS_PREFIX = '@/features/';
const FEATURES_DIR = 'features';
const APP_DIR = 'app';
/** 判读的源码后缀（含无绑定副作用导入可能出现的 JS 变体）。 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * 登记例外（本守卫的**唯一放行清单**，改动走评审）：`match` 判「公开面之后的路径段」，
 * `importers` 列出例外适用的导入方根，`basis` 是放行依据（写进报错，供评审对照 ADR）。
 */
const REGISTERED_EXCEPTIONS = [
  {
    id: 'register 注册接缝',
    match: (rest) => rest === 'register',
    importers: [APP_DIR],
    basis:
      'ADR-0004 ②「唯一第二入口（具名例外）」：features/<name>/register 是 FE-03 插槽约定的挂载接缝，' +
      '带模块级副作用（setWorkspaceBootstrap / createReviewSession），只允许 app/** 路由层引其引导组件，' +
      'feature 之间禁引',
  },
  {
    id: '样式入口（*.css）',
    match: (rest) => rest.endsWith('.css'),
    importers: [APP_DIR],
    basis:
      'ADR-0004 ② 公开面只导出「组件 / 工厂 / hook / 类型 / 页面级纯逻辑」，样式无从 index.ts 转出' +
      '（转出即全局副作用）；Next 路由层直引 feature 样式为既有接线（app/page.tsx、app/editor/layout.tsx）',
  },
];

/** 按后缀取 TS 解析 kind（.tsx/.jsx/.js 走 TSX，允许 JSX）。 */
function scriptKindOf(path) {
  if (path.endsWith('.tsx') || path.endsWith('.jsx') || path.endsWith('.js')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

/** 递归收集源码文件（按名排序，输出确定）。 */
function collectSourceFiles(root) {
  return collectFiles(root, {
    isTarget: (name) => SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)),
  });
}

/**
 * 收集模块符引用：`{ text, line, form, unknown }`。
 * unknown = 判不出（动态导入实参含插值 / 表达式）但文本可能指向 `@/features` → 后续记「无法判定」。
 */
function collectModuleRefs(sourceFile) {
  const refs = [];
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const record = (atNode, specifier, form) => {
    if (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) {
      refs.push({ text: specifier.text, line: lineOf(atNode), form, unknown: false });
      return;
    }
    const text = specifier.getText(sourceFile);
    const head = ts.isTemplateExpression(specifier)
      ? specifier.head.text
      : text.replace(/^['"`]/, '');
    if (head.startsWith('@/features') || text.includes('@/features')) {
      refs.push({ text, line: lineOf(atNode), form, unknown: true });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(
        node,
        node.moduleSpecifier,
        node.importClause === undefined ? 'import（副作用）' : 'import',
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(node, node.moduleSpecifier, 'export … from');
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const first = node.arguments[0];
      if (callee.kind === ts.SyntaxKind.ImportKeyword && first !== undefined) {
        record(node, first, 'import()');
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && first !== undefined) {
        record(node, first, 'require()');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return refs;
}

/**
 * 把模块符落成 feature 坐标：返回 `{ target, rest, via }` 或 null（不指向任何 feature）。
 * via：`别名`（@/features/…）或 `相对路径`（解析后落进 features 根）。
 */
function locateFeaturePath(specifier, file, featuresRoot) {
  if (specifier.startsWith(ALIAS_PREFIX)) {
    const segments = specifier.slice(ALIAS_PREFIX.length).split('/');
    const target = segments[0] ?? '';
    if (target === '') return null;
    return { target, rest: segments.slice(1).join('/'), via: '别名' };
  }
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(file), specifier);
    const rel = relative(featuresRoot, resolved);
    if (rel === '' || rel.startsWith('..') || rel.startsWith(sep)) return null;
    const segments = rel.split(sep).filter((segment) => segment !== '');
    const target = segments[0] ?? '';
    if (target === '') return null;
    return { target, rest: segments.slice(1).join('/'), via: '相对路径' };
  }
  return null;
}

/** 判一条引用：返回 `{ ok }` / `{ violation }` / `{ exception }` / `{ undetermined }`。 */
function judgeRef(ref, context) {
  const at = `${displayPath(context.file)}:${ref.line}`;
  if (ref.unknown) {
    return {
      undetermined:
        `${at} 动态导入目标静态判不出（${ref.form}：${ref.text}）——` +
        '静态读无法证明它不指向 feature 内部，阻塞，禁当通过',
    };
  }
  const located = locateFeaturePath(ref.text, context.file, context.featuresRoot);
  if (located === null) return { ok: true };
  const { target, rest, via } = located;
  if (rest === '') return { ok: true }; // 公开面本体

  // 自身 feature 的深路径是 feature 内部事（只有 features 根判据有「自身」概念）。
  if (context.importerKind === FEATURES_DIR && target === context.own) return { ok: true };

  const importerLabel =
    context.importerKind === APP_DIR
      ? 'app 路由层'
      : `feature「${context.own ?? '(features 根直属文件)'}」`;
  const exception = REGISTERED_EXCEPTIONS.find((entry) => entry.match(rest));
  if (exception?.importers.includes(context.importerKind)) {
    return {
      exception: `${at} 登记例外「${exception.id}」：'${ref.text}'（${importerLabel}）——依据：${exception.basis}`,
    };
  }
  if (exception !== undefined) {
    return {
      violation:
        `${at} 越出登记例外范围：'${ref.text}'（${via}）→「${exception.id}」只对 ${exception.importers.join('、')} 根适用，` +
        `${importerLabel}不许引——依据：${exception.basis}`,
    };
  }
  const hint = rest === 'index' ? `（公开面写法就是 '@/features/${target}'，不要写 /index）` : '';
  return {
    violation:
      `${at} 跨 feature 深导入：'${ref.text}'（${via}）→ 目标 feature「${target}」内部「${rest}」，` +
      `${importerLabel}只能经公开面 '@/features/${target}' 导入（ADR-0004 ②：禁深导入内部路径）${hint}`,
  };
}

/** 主流程。 */
function main() {
  const jsonMode = process.argv.includes('--json');
  const rootArg = readArg('root');
  const root = rootArg ? resolve(rootArg) : DEFAULT_ROOT;
  const featuresRoot = join(root, FEATURES_DIR);
  const appRoot = join(root, APP_DIR);

  const report = {
    root: displayPath(root),
    roots: { features: displayPath(featuresRoot), app: displayPath(appRoot) },
    scope: {
      judged: [
        `${displayPath(featuresRoot)}/**（features 根判据：feature→feature）`,
        `${displayPath(appRoot)}/**（app 根判据：app→feature）`,
      ],
      excluded: [],
      exceptions: REGISTERED_EXCEPTIONS.map((entry) => ({
        id: entry.id,
        importers: entry.importers,
        basis: entry.basis,
      })),
    },
    checked: [],
    violations: [],
    undetermined: [],
    exceptions: [],
    exitCode: 0,
  };

  // 前置：双侧判据的两个根都必须读得到，否则「阻塞」而不是「通过」（禁止假绿）。
  const rootExists = existsSync(root) && statSync(root).isDirectory();
  if (!rootExists) {
    report.undetermined.push(
      `源码根不存在或不是目录：${displayPath(root)}（判据读不到源码树——阻塞，禁当通过）`,
    );
  } else {
    for (const [kind, dir] of [
      [FEATURES_DIR, featuresRoot],
      [APP_DIR, appRoot],
    ]) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        report.undetermined.push(
          `双侧判据的 ${kind} 根不存在：${displayPath(dir)}（阻塞，禁当通过）`,
        );
      }
    }
    // 范围写明：根下未纳入判据的目录逐项列出（不静默缺席）。
    for (const item of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (item.isDirectory() && item.name !== FEATURES_DIR && item.name !== APP_DIR) {
        report.scope.excluded.push(`${displayPath(join(root, item.name))}/**（不在双侧判据内）`);
      }
    }
  }

  if (report.undetermined.length === 0) {
    const files = [...collectSourceFiles(featuresRoot), ...collectSourceFiles(appRoot)];
    for (const file of files) {
      const text = readText(file);
      if (typeof text === 'object') {
        report.undetermined.push(text.error);
        continue;
      }
      const sourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.ES2022,
        true,
        scriptKindOf(file),
      );
      if (sourceFile.parseDiagnostics.length > 0) {
        const first = sourceFile.parseDiagnostics[0];
        const where =
          first === undefined
            ? ''
            : `（第 ${sourceFile.getLineAndCharacterOfPosition(first.start).line + 1} 行）`;
        report.undetermined.push(
          `${displayPath(file)}${where} 解析失败——静态读判不出其中的导入，阻塞，禁当通过`,
        );
        continue;
      }
      report.checked.push(displayPath(file));
      const rel = relative(featuresRoot, file);
      const insideFeatures = rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
      const segments = insideFeatures ? rel.split(sep).filter((segment) => segment !== '') : [];
      const context = {
        file,
        featuresRoot,
        importerKind: insideFeatures ? FEATURES_DIR : APP_DIR,
        own: segments.length > 1 ? segments[0] : null,
      };
      for (const ref of collectModuleRefs(sourceFile)) {
        const outcome = judgeRef(ref, context);
        if (outcome.violation !== undefined) report.violations.push(outcome.violation);
        else if (outcome.undetermined !== undefined) report.undetermined.push(outcome.undetermined);
        else if (outcome.exception !== undefined) report.exceptions.push(outcome.exception);
      }
    }
  }

  report.exitCode = report.violations.length > 0 ? 1 : report.undetermined.length > 0 ? 2 : 0;

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `guard-feature-boundaries：判据根 ${report.root}`,
      `  双侧根：${report.scope.judged.join('；')}（实扫 ${report.checked.length} 个文件）`,
    ];
    for (const item of report.scope.excluded) lines.push(`  · 范围外：${item}`);
    for (const item of report.exceptions) lines.push(`  = 登记例外：${item}`);
    for (const item of report.violations) lines.push(`  ✗ ${item}`);
    for (const item of report.undetermined) lines.push(`  ? ${item}`);
    lines.push(
      report.exitCode === 0
        ? '  ✓ feature 边界：跨 feature 引用全部落在公开面（或登记例外）上'
        : report.exitCode === 1
          ? '  结论：违规（exit 1）——跨 feature 深导入，修法：改 import 公开面 @/features/<name>'
          : '  结论：阻塞（exit 2，禁止当作通过）',
    );
    process.stderr.write(`${lines.join('\n')}\n`);
  }

  process.exit(report.exitCode);
}

main();
