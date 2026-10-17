#!/usr/bin/env node
/**
 * guard-mcp-contract —— MCP 工具集与跨端消息形状的**契约快照守卫**（aud-05 实现）。
 *
 * 快照固定三组外部契约（`@dforge/contracts` 是唯一真源）：
 *   1. MCP 确认桩：七个写工具、五类 caller、ackToken TTL、审计决策词表，
 *      以及提案/确认/审计请求与响应的**字段名**（dryRun → 一次性 ackToken → 审计）；
 *   2. 跨端路由表 `DAEMON_ROUTES`：键 → method + path（daemon ↔ web ↔ CLI 共用的单点）；
 *   3. 跨进程信封字段：HTTP `{ok,result|error}` 与 stdio/SSE `{id,method,params}` /
 *      `{id,ok,result|error}`。
 *
 * 三态退出码（与其余守卫一致）：
 *   0 = 源与快照一致；1 = 契约漂移（violations 点名漂移位）；2 = 阻塞
 *   （快照缺失/损坏/schema 不匹配，或契约源无法静态判定——禁止当通过，也禁止误报违规）。
 *
 * 快照是**提交物**：契约有意变更时跑 `node scripts/guard-mcp-contract.mjs --update`
 * 并在同一 PR 里审阅快照 diff；`--update` 遇到无法判定的源时拒绝写入（exit 2）。
 *
 * 用法：node scripts/guard-mcp-contract.mjs [--json] [--update] [--snapshot=<路径>]
 * 实现方式：TypeScript AST 静态读取（不执行契约源码），字段/常量/路由均取字面量；
 * 非字面量（动态计算）一律记无法判定 → exit 2。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import { REPO_ROOT, readArg } from './lib/guard-io.mjs';

const DEFAULT_SNAPSHOT = join(REPO_ROOT, 'scripts', 'snapshots', 'mcp-contract.v1.json');
const SNAPSHOT_SCHEMA = 'df.mcp-contract.snapshot/v1';
const CONTRACTS_SRC = join(REPO_ROOT, 'packages', 'contracts', 'src');

/** 契约源文件（唯一真源；改路径须同步本表）。 */
const SOURCES = {
  mcp: join(CONTRACTS_SRC, 'mcp', 'index.ts'),
  routes: join(CONTRACTS_SRC, 'ipc', 'routes.ts'),
  envelope: join(CONTRACTS_SRC, 'ipc', 'envelope.ts'),
};

/** MCP 接口 → 快照字段组（请求与响应形状一并固定）。 */
const MCP_INTERFACES = {
  proposalRequestFields: ['McpProposalRequest'],
  proposalResponseFields: ['McpProposalResponse'],
  ackRequestFields: ['McpAckRequest'],
  ackResponseFields: ['McpAckResponse'],
  auditRecordFields: ['McpAuditRecord'],
  auditResponseFields: ['McpAuditResponse'],
};

/** 信封接口 → 快照字段组。 */
const ENVELOPE_INTERFACES = {
  httpSuccessFields: ['ApiSuccess'],
  httpFailureFields: ['ApiFailure'],
  ipcRequestFields: ['IpcRequest'],
  ipcSuccessFields: ['IpcSuccess'],
  ipcFailureFields: ['IpcFailure'],
};

/** 必须存在的 MCP 路由键（缺一个即漂移；web/daemon 都按这些键取路径）。 */
const REQUIRED_MCP_ROUTE_KEYS = ['mcpPropose', 'mcpAck', 'mcpAudit'];

const snapshotPath = readArg('snapshot') ? resolve(readArg('snapshot')) : DEFAULT_SNAPSHOT;
const jsonMode = process.argv.includes('--json');
const updateMode = process.argv.includes('--update');

/** 读取源文件；读不到给 null（调用方记阻塞）。 */
function readSource(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 解析 AST（纯语法，不做类型检查）。 */
function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** 剥掉 `as const` / `satisfies X` / 括号包裹。 */
function unwrap(expression) {
  let target = expression;
  while (
    ts.isAsExpression(target) ||
    ts.isSatisfiesExpression(target) ||
    ts.isParenthesizedExpression(target)
  ) {
    target = target.expression;
  }
  return target;
}

/** 找 `const <name> = ...` 的初始化表达式（含 export 修饰符或裸 const 均可）。 */
function findConstInitializer(sourceFile, name) {
  let found = null;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        found = declaration.initializer ?? null;
      }
    }
  });
  return found;
}

/** 字符串字面量数组 → string[]；任何非字符串元素返回 null（静态判不出）。 */
function stringArrayLiteral(expression) {
  if (expression === null) return null;
  const target = unwrap(expression);
  if (!ts.isArrayLiteralExpression(target)) return null;
  const values = [];
  for (const element of target.elements) {
    const item = unwrap(element);
    if (!ts.isStringLiteral(item)) return null;
    values.push(item.text);
  }
  return values;
}

/** 数值字面量。 */
function numberLiteral(expression) {
  if (expression === null) return null;
  const target = unwrap(expression);
  return ts.isNumericLiteral(target) ? Number(target.text.replaceAll('_', '')) : null;
}

/** 类型别名 `Name = 'a' | 'b'` → string[]；不是字符串字面量联合则 null。 */
function stringUnionAlias(sourceFile, name) {
  let alias;
  sourceFile.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) alias = node;
  });
  if (alias === undefined) return null;
  const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [alias.type];
  const values = [];
  for (const member of members) {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) return null;
    values.push(member.literal.text);
  }
  return values;
}

/** 接口属性名（声明顺序）；接口缺失或出现非数据属性（方法/索引签名）→ null。 */
function interfaceFields(sourceFile, name) {
  let declaration;
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) declaration = node;
  });
  if (declaration === undefined) return null;
  const fields = [];
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member)) return null;
    const propertyName = member.name;
    if (ts.isIdentifier(propertyName)) fields.push(propertyName.text);
    else if (ts.isStringLiteral(propertyName)) fields.push(propertyName.text);
    else return null;
  }
  return fields;
}

/** 对象字面量里某键的字符串字面量值。 */
function stringProperty(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const keyName = ts.isIdentifier(key) ? key.text : ts.isStringLiteral(key) ? key.text : null;
    if (keyName !== name) continue;
    const value = unwrap(property.initializer);
    return ts.isStringLiteral(value) ? value.text : null;
  }
  return null;
}

/** `DAEMON_ROUTES` 对象字面量 → { key: { method, path } }；任一非字面量 → null。 */
function routeTable(sourceFile) {
  const initializer = findConstInitializer(sourceFile, 'DAEMON_ROUTES');
  const objectLiteral = initializer === null ? null : unwrap(initializer);
  if (objectLiteral === null || !ts.isObjectLiteralExpression(objectLiteral)) return null;
  const routes = {};
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = property.name;
    const keyName = ts.isIdentifier(key) ? key.text : ts.isStringLiteral(key) ? key.text : null;
    if (keyName === null) return null;
    const value = unwrap(property.initializer);
    if (!ts.isObjectLiteralExpression(value)) return null;
    const method = stringProperty(value, 'method');
    const path = stringProperty(value, 'path');
    if (method === null || path === null) return null;
    routes[keyName] = { method, path };
  }
  return routes;
}

/**
 * 提取当前契约（顺序确定，便于快照比对）。
 * undetermined 非空 = 源无法静态判定 → 阻塞（exit 2），绝不落成「无漂移」。
 */
function extractContract() {
  const undetermined = [];
  const sources = {};
  for (const [key, path] of Object.entries(SOURCES)) {
    const text = readSource(path);
    if (text === null) {
      undetermined.push(`契约源缺失/不可读：${path}`);
      sources[key] = null;
    } else {
      sources[key] = parse(path, text);
    }
  }

  const mcp = {};
  const mcpSource = sources.mcp;
  if (mcpSource === null) {
    return { contract: null, undetermined };
  }

  const writeTools = stringArrayLiteral(findConstInitializer(mcpSource, 'MCP_WRITE_TOOLS'));
  if (writeTools === null) undetermined.push('MCP_WRITE_TOOLS 非字符串字面量数组（静态判不出）');
  else mcp.writeTools = writeTools;

  const callers = stringUnionAlias(mcpSource, 'McpCaller');
  if (callers === null) undetermined.push('McpCaller 非字符串字面量联合（静态判不出）');
  else mcp.callers = callers;

  const ackTtlMs = numberLiteral(findConstInitializer(mcpSource, 'MCP_ACK_TTL_MS'));
  if (ackTtlMs === null) undetermined.push('MCP_ACK_TTL_MS 非数值字面量（静态判不出）');
  else mcp.ackTtlMs = ackTtlMs;

  const auditDecisions = stringUnionAlias(mcpSource, 'McpAuditDecision');
  if (auditDecisions === null)
    undetermined.push('McpAuditDecision 非字符串字面量联合（静态判不出）');
  else mcp.auditDecisions = auditDecisions;

  for (const [group, interfaceNames] of Object.entries(MCP_INTERFACES)) {
    const fields = [];
    let ok = true;
    for (const name of interfaceNames) {
      const extracted = interfaceFields(mcpSource, name);
      if (extracted === null) {
        ok = false;
        undetermined.push(`接口 ${name} 缺失或含非数据属性（静态判不出）`);
      } else {
        fields.push(...extracted);
      }
    }
    if (ok) mcp[group] = fields;
  }

  const routesSource = sources.routes;
  const routes = routesSource === null ? null : routeTable(routesSource);
  if (routes === null) {
    undetermined.push('DAEMON_ROUTES 缺失或含非字面量 method/path（静态判不出）');
  }

  const envelopes = {};
  const envelopeSource = sources.envelope;
  if (envelopeSource === null) {
    undetermined.push('信封契约源缺失（静态判不出）');
  } else {
    for (const [group, interfaceNames] of Object.entries(ENVELOPE_INTERFACES)) {
      const fields = [];
      let ok = true;
      for (const name of interfaceNames) {
        const extracted = interfaceFields(envelopeSource, name);
        if (extracted === null) {
          ok = false;
          undetermined.push(`接口 ${name} 缺失或含非数据属性（静态判不出）`);
        } else {
          fields.push(...extracted);
        }
      }
      if (ok) envelopes[group] = fields;
    }
  }

  if (undetermined.length > 0) return { contract: null, undetermined };
  return {
    contract: { schema: SNAPSHOT_SCHEMA, mcp, routes, envelopes },
    undetermined: [],
  };
}

/** 数组逐项比较（报告新增/移除；顺序变化也算漂移）。 */
function compareList(label, expected, actual, violations) {
  if (expected === undefined || actual === undefined) {
    violations.push(`${label}：快照或源缺少该字段（无法比对）`);
    return;
  }
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  const missing = expected.filter((item) => !actual.includes(item));
  const added = actual.filter((item) => !expected.includes(item));
  const details = [];
  if (missing.length > 0) details.push(`快照有、源已移除 [${missing.join(', ')}]`);
  if (added.length > 0) details.push(`源新增 [${added.join(', ')}]`);
  if (details.length === 0) details.push('顺序变化');
  violations.push(`${label}：${details.join('；')}`);
}

/** 路由表逐键比较。 */
function compareRoutes(expected, actual, violations) {
  if (expected === undefined || actual === undefined) {
    violations.push('DAEMON_ROUTES：快照或源缺少路由表（无法比对）');
    return;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    const before = expected[key];
    const after = actual[key];
    if (before === undefined) {
      violations.push(`路由 ${key}：源新增 ${after.method} ${after.path}（快照未登记）`);
      continue;
    }
    if (after === undefined) {
      violations.push(`路由 ${key}：源已移除（快照 ${before.method} ${before.path}）`);
      continue;
    }
    if (before.method !== after.method || before.path !== after.path) {
      violations.push(
        `路由 ${key}：快照 ${before.method} ${before.path}，源 ${after.method} ${after.path}`,
      );
    }
  }
}

/** 快照 vs 源 → violations。 */
function compareContracts(expected, actual) {
  const violations = [];
  compareList('MCP 工具集', expected.mcp?.writeTools, actual.mcp.writeTools, violations);
  compareList('MCP 调用方（caller）', expected.mcp?.callers, actual.mcp.callers, violations);
  if (expected.mcp?.ackTtlMs !== actual.mcp.ackTtlMs) {
    violations.push(
      `MCP ackToken TTL：快照 ${String(expected.mcp?.ackTtlMs)}，源 ${String(actual.mcp.ackTtlMs)}`,
    );
  }
  compareList(
    'MCP 审计决策词表',
    expected.mcp?.auditDecisions,
    actual.mcp.auditDecisions,
    violations,
  );

  const mcpLabels = {
    proposalRequestFields: 'McpProposalRequest',
    proposalResponseFields: 'McpProposalResponse',
    ackRequestFields: 'McpAckRequest',
    ackResponseFields: 'McpAckResponse',
    auditRecordFields: 'McpAuditRecord',
    auditResponseFields: 'McpAuditResponse',
  };
  for (const [group, label] of Object.entries(mcpLabels)) {
    compareList(`MCP 接口字段 ${label}`, expected.mcp?.[group], actual.mcp[group], violations);
  }

  compareRoutes(expected.routes, actual.routes, violations);

  const envelopeLabels = {
    httpSuccessFields: 'ApiSuccess（HTTP 成功信封）',
    httpFailureFields: 'ApiFailure（HTTP 失败信封）',
    ipcRequestFields: 'IpcRequest（stdio/SSE 请求）',
    ipcSuccessFields: 'IpcSuccess（stdio/SSE 成功）',
    ipcFailureFields: 'IpcFailure（stdio/SSE 失败）',
  };
  for (const [group, label] of Object.entries(envelopeLabels)) {
    compareList(
      `跨进程信封字段 ${label}`,
      expected.envelopes?.[group],
      actual.envelopes[group],
      violations,
    );
  }

  for (const key of REQUIRED_MCP_ROUTE_KEYS) {
    if (actual.routes?.[key] === undefined) violations.push(`MCP 路由键缺失：${key}`);
  }
  return violations;
}

/** 写快照（仅 --update；先写临时文件再覆盖，避免半文件）。 */
function writeSnapshot(snapshot) {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  const temp = `${snapshotPath}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, snapshotPath);
  const sha256 = createHash('sha256').update(text).digest('hex');
  return { sha256 };
}

/** 主流程。 */
function main() {
  const { contract, undetermined } = extractContract();
  const report = {
    gate: 'guard-mcp-contract',
    snapshotPath,
    sourcePaths: SOURCES,
    snapshot: null,
    extracted: contract,
    violations: [],
    undetermined: [...undetermined],
    exitCode: 2,
  };

  let exitCode;
  if (updateMode && contract !== null) {
    const written = writeSnapshot(contract);
    report.snapshot = contract;
    report.snapshotSha256 = written.sha256;
    exitCode = 0;
  } else if (contract === null) {
    exitCode = 2;
  } else if (!existsSync(snapshotPath)) {
    report.undetermined.push(`快照缺失：${snapshotPath}（先跑 --update 生成并提交）`);
    exitCode = 2;
  } else {
    let snapshot = null;
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    } catch (error) {
      report.undetermined.push(`快照不可读（JSON 解析失败）：${snapshotPath}（${String(error)}）`);
    }
    if (snapshot !== null) {
      report.snapshot = snapshot;
      if (snapshot.schema !== SNAPSHOT_SCHEMA) {
        report.undetermined.push(
          `快照 schema 不匹配：${String(snapshot.schema)}（期望 ${SNAPSHOT_SCHEMA}）`,
        );
      } else {
        report.violations = compareContracts(snapshot, contract);
      }
    }
    exitCode = report.undetermined.length > 0 ? 2 : report.violations.length > 0 ? 1 : 0;
  }

  report.exitCode = exitCode;

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [`guard-mcp-contract：快照 ${report.snapshotPath}`];
    for (const violation of report.violations) lines.push(`  ✗ ${violation}`);
    for (const item of report.undetermined) lines.push(`  ? ${item}`);
    lines.push(
      updateMode && exitCode === 0
        ? '  ✓ 快照已更新（请在同一 PR 审阅 diff）'
        : exitCode === 0
          ? '  ✓ MCP 工具集与跨端消息形状与快照一致'
          : exitCode === 1
            ? '  ✗ 契约漂移（exit 1）——确属契约变更请跑 --update 并审阅快照 diff'
            : '  结论：阻塞（exit 2，禁止当作通过）',
    );
    process.stderr.write(`${lines.join('\n')}\n`);
  }

  process.exit(exitCode);
}

main();
