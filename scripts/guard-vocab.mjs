#!/usr/bin/env node
/**
 * guard-vocab —— 市场词表「同源」守卫（工作包 B · ADR-0004 ③ 收敛）。
 *
 * 做什么：断言 kind / lane / license 三档 / 合规 / 安全 / license 细档 / 品类 / 形态 /
 * 五维与权重这些**规范词表只有一个真源**——`packages/contracts/src/market/vocab.ts`——
 * 各层（services/ingest 四层 + 契约市场模块）只允许「import 真源后派生」，不得再写字面量：
 *
 *   R1 真源可判（前置）：真源文件存在、登记导出齐全且形态正确（数组字面量 / 对象字面量）；
 *      判不出 → exit 2（阻塞，禁当通过）。
 *   R2 层内字面量（违规）：层文件里出现登记名的**字面量**声明即 exit 1——数组形态的写死
 *      `['skill', …]`、对象形态的写死权重表，一律算漂移源，哪怕碰巧与真源一致也拦
 *      （「不得再写字面量」；报错会注明该字面量与真源一致/不一致，便于定位）。
 *   R3 派生根不在真源（违规）：初始化表达式的标识符根（含同文件 const 链）必须落到
 *      从 `@dforge/contracts` import 的、且**就是该词表导出名**的绑定上；
 *      根指向别处的模块 → exit 1；静态完全判不出根 → exit 2（阻塞）。
 *   R4 类型词表（违规）：登记类型的别名写死字面量联合（`type AssetKind = 'skill' | …`）
 *      即 exit 1；类型别名指向契约真源类型（含 import 改名）放行。
 *   R5 内联字面量（违规）：非声明处的数组字面量（如 `.includes(['skill', …])` 链），
 *      元素（≥2 个）全部落在同一登记词表即 exit 1（真源文件自身豁免——它就是字面量的家）。
 *
 * 扫描面（登记清单，评审可见）：
 *   - 真源：`packages/contracts/src/market/vocab.ts`（`--source=` 可覆盖，夹具测试用）；
 *   - 层根：`services/ingest/src` 全树 + `packages/contracts/src/market` 全树
 *     （`--layers=` 可覆盖）；排除 `*.test.*`、`__fixtures__/`、`__snapshots__/`。
 *
 * 局限（诚实声明）：只覆盖 **登记名**——新增词表声明/别名必须在 VOCAB_REGISTRY 登记
 * （改动走评审）；内联联合类型（接口属性上的 `'a' | 'b'`）与跨文件类型链不在静态判据内。
 *
 * 用法：node scripts/guard-vocab.mjs [--json] [--source=<vocab.ts>] [--layers=<目录或文件>]
 * 退出码（门禁三态，禁止假绿）：0 通过 / 1 违规（层间与真源不一致）/ 2 阻塞（前置不成立）。
 * 退出码优先级（一句话规则）：**违规（1）优先于未判定（2）**——真违规存在即失败；但两类问题
 * 在日志里**必须同时列出**（`✗` 违规明细 + `?` 未判定明细，结论行点名未判定计数），
 * 阻塞信息不得被违规结论吞掉。
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';

import { collectFiles, displayPath, REPO_ROOT, readArg, readText } from './lib/guard-io.mjs';

const DEFAULT_SOURCE = join(REPO_ROOT, 'packages', 'contracts', 'src', 'market', 'vocab.ts');
const DEFAULT_LAYER_ROOTS = [
  join(REPO_ROOT, 'services', 'ingest', 'src'),
  join(REPO_ROOT, 'packages', 'contracts', 'src', 'market'),
];
const CONTRACTS_MODULE = '@dforge/contracts';

/**
 * 登记词表：id 仅用于报错；source/sourceType 是真源导出名（层派生必须根在这里）；
 * form 是层内声明形态（array/object）；values/types 是层内允许出现的别名。
 */
const VOCAB_REGISTRY = [
  {
    id: 'kind（四类资产）',
    source: 'MARKET_ASSET_KINDS',
    sourceType: 'MarketAssetKind',
    form: 'array',
    values: ['ASSET_KINDS', 'KINDS', 'KIND_PRIORITY'],
    types: ['AssetKind', 'MarketAssetKind'],
  },
  {
    id: 'lane（工作泳道）',
    source: 'MARKET_LANES',
    sourceType: 'MarketLane',
    form: 'array',
    values: ['LANES'],
    types: ['Lane', 'MarketLane'],
  },
  {
    id: 'license 三档守门',
    source: 'MARKET_LICENSE_GATES',
    sourceType: 'LicenseGate',
    form: 'array',
    values: ['GATES', 'LICENSE_GATES'],
    types: ['LicenseGate'],
  },
  {
    id: '合规结论',
    source: 'MARKET_COMPLIANCES',
    sourceType: 'MarketCompliance',
    form: 'array',
    values: ['COMPLIANCES'],
    types: ['Compliance', 'MarketCompliance'],
  },
  {
    id: '安全审计结论',
    source: 'MARKET_SECURITY_LEVELS',
    sourceType: 'MarketSecurityLevel',
    form: 'array',
    values: ['SECURITY_LEVELS'],
    types: ['SecurityLevel', 'MarketSecurityLevel'],
  },
  {
    id: 'license 细档',
    source: 'MARKET_LICENSE_TIERS',
    sourceType: 'MarketLicenseTier',
    form: 'array',
    values: ['LICENSE_TIERS'],
    types: ['LicenseTier', 'MarketLicenseTier'],
  },
  {
    id: '品类',
    source: 'MARKET_CATEGORIES',
    sourceType: 'MarketCategory',
    form: 'array',
    values: ['CATEGORIES'],
    types: ['Category', 'MarketCategory'],
  },
  {
    id: '形态',
    source: 'MARKET_MODES',
    sourceType: 'MarketMode',
    form: 'array',
    values: ['MODES'],
    types: ['Mode', 'MarketMode'],
  },
  {
    id: '五维键',
    source: 'MARKET_QUALITY_DIMENSIONS',
    sourceType: null,
    form: 'array',
    values: ['DIMENSIONS'],
    types: [],
  },
  {
    id: '五维权重',
    source: 'MARKET_QUALITY_WEIGHTS',
    sourceType: null,
    form: 'object',
    values: ['DIM_WEIGHTS', 'QUALITY_WEIGHTS'],
    types: [],
  },
];

/** 从 argv 取 `--name=value`（词表守卫只需 source/layers 两个参数面）。 */
const jsonMode = process.argv.includes('--json');
const sourcePath = readArg('source') ? resolve(readArg('source')) : DEFAULT_SOURCE;
const layersArg = readArg('layers');
const layerRoots = layersArg ? [resolve(layersArg)] : DEFAULT_LAYER_ROOTS;

/** 解析 TS（纯语法，不做类型检查）。 */
function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** 剥掉 `as const` / `satisfies X` / 括号 / 非空断言 / `Object.freeze(…)` 裹壳。 */
function unwrap(expression) {
  let target = expression;
  for (;;) {
    if (
      ts.isAsExpression(target) ||
      ts.isSatisfiesExpression(target) ||
      ts.isParenthesizedExpression(target) ||
      ts.isNonNullExpression(target) ||
      ts.isTypeAssertionExpression(target)
    ) {
      target = target.expression;
      continue;
    }
    if (
      ts.isCallExpression(target) &&
      ts.isPropertyAccessExpression(target.expression) &&
      target.expression.getText() === 'Object.freeze' &&
      target.arguments.length === 1
    ) {
      const inner = target.arguments[0];
      if (inner === undefined) return target;
      target = inner;
      continue;
    }
    return target;
  }
}

/** 找 `export const <name> = <表达式>`（任意位置）；重名各自保留，第一处为准。 */
function findExportedConst(sourceFile, name) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          found = declaration;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** 字面量取值（数组 → string[]；对象 → Record<string, unknown>）；非字面量返回 undefined。 */
function literalValue(node) {
  const target = unwrap(node);
  if (ts.isArrayLiteralExpression(target)) {
    const values = [];
    for (const element of target.elements) {
      if (!ts.isStringLiteral(element)) return undefined;
      values.push(element.text);
    }
    return values;
  }
  if (ts.isObjectLiteralExpression(target)) {
    const record = {};
    for (const property of target.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = property.name.getText().replace(/^['"]|['"]$/g, '');
      const value = unwrap(property.initializer);
      if (ts.isNumericLiteral(value)) record[key] = Number(value.text);
      else if (ts.isStringLiteral(value)) record[key] = value.text;
      else return undefined;
    }
    return record;
  }
  return undefined;
}

/** 加载真源：登记导出名 → 字面量值；任一项判不出即 `{ ok: false }`（前置不成立）。 */
function loadTrueSource(path) {
  const text = readText(path);
  if (typeof text === 'object') return { ok: false, reason: text.error };
  const sourceFile = parse(path, text);
  const values = new Map();
  for (const entry of VOCAB_REGISTRY) {
    const declaration = findExportedConst(sourceFile, entry.source);
    if (declaration === undefined) {
      return { ok: false, reason: `真源缺登记导出 ${entry.source}（${displayPath(path)}）` };
    }
    const value = literalValue(declaration.initializer);
    if (value === undefined) {
      return {
        ok: false,
        reason: `真源 ${entry.source} 不是可静态判读的字面量（${entry.form}）（${displayPath(path)}）`,
      };
    }
    values.set(entry, value);
  }
  return { ok: true, values };
}

/** 收集 import 绑定：localName → { module, importedName }（含 `X as Y` 与 `import type`）。 */
function collectImports(sourceFile) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      bindings.set(element.name.text, { module: moduleName, importedName });
    }
  }
  return bindings;
}

/** 收集同文件 const 声明：name → initializer；重名进 ambiguous（判不出即阻塞，禁瞎猜）。 */
function collectConstInitializers(sourceFile) {
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

/** 收集表达式内「本地绑定名」（函数参数 / 内部变量 / catch 变量）——这些标识符不作为根。 */
function collectBoundNames(expression) {
  const bound = new Set();
  const visit = (node) => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bound.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bound.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration?.name !== undefined) {
      const name = node.variableDeclaration.name;
      if (ts.isIdentifier(name)) bound.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return bound;
}

/**
 * 解析初始化表达式的「根标识符」：跟进同文件 const 链直到 import 绑定。
 * 返回 `{ contractsRoots:Set<导出名>, foreignRoots:[说明], unresolved:[说明] }`。
 */
function resolveRoots(expression, context, visited = new Set()) {
  const contractsRoots = new Set();
  const foreignRoots = [];
  const unresolved = [];
  const bound = collectBoundNames(expression);

  const reference = (identifier) => {
    const name = identifier.text;
    if (bound.has(name)) return;
    const binding = context.imports.get(name);
    if (binding !== undefined) {
      if (binding.module === CONTRACTS_MODULE) contractsRoots.add(binding.importedName);
      else foreignRoots.push(`${name}（import 自 '${binding.module}'）`);
      return;
    }
    const next = context.initializers.get(name);
    if (next !== undefined) {
      if (visited.has(name)) {
        unresolved.push(`${name} 的 const 链成环`);
        return;
      }
      const inner = resolveRoots(next, context, new Set(visited).add(name));
      for (const item of inner.contractsRoots) contractsRoots.add(item);
      foreignRoots.push(...inner.foreignRoots);
      unresolved.push(...inner.unresolved);
      return;
    }
    if (context.ambiguous.has(name)) {
      unresolved.push(`${name} 重名定义，无法静态确定指向`);
      return;
    }
    unresolved.push(`${name} 非 import / 非同文件 const（静态判不出根）`);
  };

  const walk = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression); // 跳过 `.name` 一侧
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) walk(node.name.expression);
      walk(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      reference(node.name);
      return;
    }
    if (ts.isIdentifier(node)) {
      reference(node);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(expression);
  return { contractsRoots, foreignRoots, unresolved };
}

/** 数组/对象字面量与真源值比对（报错文案用）；判不出时返回 null。 */
function describeLiteralMatch(literal, sourceValue) {
  if (Array.isArray(literal) && Array.isArray(sourceValue)) {
    const same =
      literal.length === sourceValue.length && literal.every((item, i) => item === sourceValue[i]);
    return same ? '与真源一致（但字面量即漂移源）' : '与真源**不一致**';
  }
  if (
    typeof literal === 'object' &&
    literal !== null &&
    typeof sourceValue === 'object' &&
    sourceValue !== null
  ) {
    const same = JSON.stringify(literal) === JSON.stringify(sourceValue);
    return same ? '与真源一致（但字面量即漂移源）' : '与真源**不一致**';
  }
  return null;
}

/** 分析单个层文件：返回违规与「无法判定」清单（真源文件自身跳过内联规则 R5）。 */
function analyzeLayerFile(path, text, sourceValues, scanInline) {
  const violations = [];
  const undetermined = [];
  const at = displayPath(path);
  const sourceFile = parse(path, text);
  const imports = collectImports(sourceFile);
  const { initializers, ambiguous } = collectConstInitializers(sourceFile);
  const context = { imports, initializers, ambiguous };

  const lineOf = (node) =>
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // R2/R3：登记值名的声明
  const registeredInitializers = new Set();
  for (const entry of VOCAB_REGISTRY) {
    for (const name of entry.values) {
      const declaration = findExportedConst(sourceFile, name);
      if (declaration === undefined) continue;
      registeredInitializers.add(declaration.initializer);
      const initializer = unwrap(declaration.initializer);
      let isLiteral = false;
      if (entry.form === 'array' && ts.isArrayLiteralExpression(initializer)) {
        isLiteral = initializer.elements.some((element) => ts.isStringLiteral(element));
      }
      if (entry.form === 'object' && ts.isObjectLiteralExpression(initializer)) {
        isLiteral = initializer.properties.some((property) => {
          if (!ts.isPropertyAssignment(property)) return false;
          const value = unwrap(property.initializer);
          return ts.isNumericLiteral(value) || ts.isStringLiteral(value);
        });
      }
      if (isLiteral) {
        const literal = literalValue(initializer);
        const sourceValue = sourceValues.get(entry);
        const match = literal === undefined ? null : describeLiteralMatch(literal, sourceValue);
        violations.push(
          `${at}:${lineOf(declaration)} ${name}：层内 ${entry.form === 'array' ? '数组' : '对象'}字面量` +
            `（词表「${entry.id}」必须在 ${CONTRACTS_MODULE} 真源 import 后派生` +
            `${match === null ? '' : `；该字面量${match}`}）`,
        );
        continue;
      }
      const roots = resolveRoots(declaration.initializer, context);
      if (roots.contractsRoots.has(entry.source)) continue;
      if (roots.contractsRoots.size > 0) {
        violations.push(
          `${at}:${lineOf(declaration)} ${name}：派生根不含真源 ${entry.source}` +
            `（实际根：${[...roots.contractsRoots].join('、')}——词表「${entry.id}」必须根在自己的真源导出上）`,
        );
        continue;
      }
      if (roots.foreignRoots.length > 0) {
        violations.push(
          `${at}:${lineOf(declaration)} ${name}：派生根不在真源（${roots.foreignRoots.join('、')}）——` +
            `词表「${entry.id}」只许从 ${CONTRACTS_MODULE} 的 ${entry.source} 派生`,
        );
        continue;
      }
      undetermined.push(
        `${at}:${lineOf(declaration)} ${name}：初始化表达式静态判不出根` +
          `（${roots.unresolved.join('、') || '无可用标识符'}）——阻塞，禁当通过`,
      );
    }
  }

  // R5：内联字面量数组（非登记声明处，如 `.includes([…])` 链）——数组元素（≥2）全部落在
  // 同一登记词表即违规：不是 const 声明，但同样是「层内再写一份词表」的漂移源。
  if (scanInline) {
    const vocabSets = VOCAB_REGISTRY.map((entry) => ({
      entry,
      values: sourceValues.get(entry),
    })).filter((item) => Array.isArray(item.values));
    const visitArrays = (node) => {
      if (registeredInitializers.has(node)) return; // 登记声明处由 R2/R3 判定
      if (ts.isArrayLiteralExpression(node) && node.elements.length >= 2) {
        const elements = node.elements;
        if (elements.every((element) => ts.isStringLiteral(element))) {
          const tokens = elements.map((element) => element.text);
          const hit = vocabSets.find(({ values }) =>
            tokens.every((token) => values.includes(token)),
          );
          if (hit !== undefined) {
            violations.push(
              `${at}:${lineOf(node)} 内联字面量数组 [${tokens.join(', ')}]：` +
                `层内不得再写词表「${hit.entry.id}」——改 import ${CONTRACTS_MODULE} 的 ` +
                `${hit.entry.source} 后派生（判定用运行时类型守卫）`,
            );
          }
        }
      }
      ts.forEachChild(node, visitArrays);
    };
    visitArrays(sourceFile);
  }

  // R4：登记类型的别名（字面量联合即违规；类型别名递归跟进到 import 绑定）。
  const typeAliases = new Map();
  const collectAliases = (node) => {
    if (ts.isTypeAliasDeclaration(node)) typeAliases.set(node.name.text, node);
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sourceFile);

  const classify = (node, seen) => {
    if (ts.isUnionTypeNode(node)) {
      const hasLiteral = node.types.some(
        (member) => ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
      );
      return hasLiteral
        ? { kind: 'literal-union' }
        : { kind: 'derived', detail: '非字符串字面量联合' };
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (seen.has(name)) return { kind: 'unresolved', detail: `${name} 类型链成环` };
      const binding = imports.get(name);
      if (binding !== undefined) {
        return binding.module === CONTRACTS_MODULE
          ? { kind: 'contracts', importedName: binding.importedName }
          : { kind: 'foreign', detail: `${name} import 自 '${binding.module}'` };
      }
      const alias = typeAliases.get(name);
      if (alias !== undefined) return classify(alias.type, new Set(seen).add(name));
      return { kind: 'unresolved', detail: `${name} 非 import / 非同文件别名` };
    }
    return { kind: 'derived', detail: '派生型（typeof/indexed 等），由 tsc 兜底' };
  };

  for (const entry of VOCAB_REGISTRY) {
    for (const typeName of entry.types) {
      const alias = typeAliases.get(typeName);
      if (alias === undefined) continue;
      const outcome = classify(alias.type, new Set());
      if (outcome.kind === 'literal-union') {
        violations.push(
          `${at}:${lineOf(alias)} type ${typeName}：类型词表写成字面量联合` +
            `（词表「${entry.id}」的类型必须指向 ${CONTRACTS_MODULE} 的 ${entry.sourceType ?? entry.source}）`,
        );
        continue;
      }
      if (outcome.kind === 'foreign') {
        violations.push(
          `${at}:${lineOf(alias)} type ${typeName}：类型根不在真源（${outcome.detail}）——` +
            `词表「${entry.id}」的类型只许指向 ${CONTRACTS_MODULE}`,
        );
        continue;
      }
      if (outcome.kind === 'contracts') {
        if (entry.sourceType !== null && outcome.importedName !== entry.sourceType) {
          violations.push(
            `${at}:${lineOf(alias)} type ${typeName}：类型根指向 ${outcome.importedName}，` +
              `期望 ${entry.sourceType}（词表「${entry.id}」）`,
          );
        }
        continue;
      }
      if (outcome.kind === 'unresolved') {
        undetermined.push(
          `${at}:${lineOf(alias)} type ${typeName}：类型根静态判不出（${outcome.detail}）——阻塞，禁当通过`,
        );
      }
    }
  }

  // 覆盖 collect：ExportDeclaration 直转（`export type { MarketAssetKind as AssetKind } from …`）。
  // 相对路径转出（'./types.ts' 一类）是包内 pass-through，不判定——链上文件本身在扫描集内
  // （逐文件判定）；判据只拦「从**非契约包**转出」这种真断源。
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName.startsWith('.')) continue;
    for (const element of statement.exportClause.elements) {
      const exportedName = element.name.text;
      const importedName = (element.propertyName ?? element.name).text;
      for (const entry of VOCAB_REGISTRY) {
        if (!entry.types.includes(exportedName)) continue;
        if (moduleName === CONTRACTS_MODULE) {
          if (entry.sourceType !== null && importedName !== entry.sourceType) {
            violations.push(
              `${at}:${lineOf(element)} export type { ${importedName} as ${exportedName} }：` +
                `转出名的真源应是 ${entry.sourceType}（词表「${entry.id}」）`,
            );
          }
        } else {
          violations.push(
            `${at}:${lineOf(element)} export type { … as ${exportedName} }：类型词表转出根不在真源` +
              `（自 '${moduleName}' 转出）——词表「${entry.id}」只许从 ${CONTRACTS_MODULE} 转出`,
          );
        }
      }
    }
  }

  return { violations, undetermined };
}

/** 递归收集待扫层文件（排除测试/夹具/快照；遍历序确定，见 `lib/guard-io`）。 */
function collectLayerFiles(root) {
  return collectFiles(root, {
    isTarget: (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    excludeDirs: ['__fixtures__', '__snapshots__'],
  });
}

/** 主流程。 */
function main() {
  const report = {
    source: displayPath(sourcePath),
    layers: layerRoots.map(displayPath),
    checked: [],
    violations: [],
    undetermined: [],
    exitCode: 0,
  };

  const source = loadTrueSource(sourcePath);
  if (!source.ok) {
    report.undetermined.push(source.reason);
  } else {
    for (const root of layerRoots) {
      const files = collectLayerFiles(root);
      if (files === null) {
        report.undetermined.push(`层路径不存在：${displayPath(root)}（阻塞，非通过）`);
        continue;
      }
      for (const file of files) {
        const text = readText(file);
        if (typeof text === 'object') {
          report.undetermined.push(text.error);
          continue;
        }
        report.checked.push(displayPath(file));
        const result = analyzeLayerFile(file, text, source.values, file !== sourcePath);
        report.violations.push(...result.violations);
        report.undetermined.push(...result.undetermined);
      }
    }
  }

  report.exitCode = report.violations.length > 0 ? 1 : report.undetermined.length > 0 ? 2 : 0;

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `guard-vocab：真源 ${report.source}`,
      `  扫描层根：${report.layers.join('、')}（${report.checked.length} 个文件）`,
    ];
    for (const violation of report.violations) lines.push(`  ✗ ${violation}`);
    for (const item of report.undetermined) lines.push(`  ? ${item}`);
    lines.push(
      report.exitCode === 0
        ? '  ✓ 词表同源：各层无字面量声明，派生根均落在契约真源'
        : report.exitCode === 1
          ? '  结论：违规（exit 1）——层内词表与真源不一致，修法：import 真源后 filter/sort 派生' +
            (report.undetermined.length > 0
              ? `；另有 ${String(report.undetermined.length)} 项未判定（见上方 ? 行，两类问题一并处置）`
              : '')
          : '  结论：阻塞（exit 2，禁止当作通过）',
    );
    process.stderr.write(`${lines.join('\n')}\n`);
  }

  process.exit(report.exitCode);
}

main();
