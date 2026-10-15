/**
 * 维度四 · 安全性 `security`（权重 .20，规格 §5.1/§5.2）。
 *
 * 信号与子权（维度内归一化，和 = 1.00）：
 *   security.install-scripts  .35  隐藏安装脚本：生命周期钩子 0（X1）/ 仅 shell 脚本 0.4（X1）/ 无 1
 *   security.permissions      .30  权限声明（frontmatter allowedTools / 清单能力字段 / .mcp.json；缺 → X2）
 *   security.outbound         .20  出站域名是否声明（清单/.mcp.json 观测 vs 声明集合；缺 → X3）
 *   security.sensitive-paths  .15  敏感路径访问（工作目录外读写；命中 → X4）
 *
 * 口径说明：
 *   - **许可绝不进本维度**（规格 §5.4）：无 license / NOASSERTION 不影响 security 分；
 *     非可装载档只追加一条 `L1` 说明（delta 恒 0，走守门，§7.2）——卡片可解释但不扣分。
 *   - 出站域名语料 = 机器可读声明（清单 JSON + `.mcp.json`）；散文里的链接指向文档、
 *     不是运行期出站，故不扫描（口径在此，改则同步改测试与门禁）。
 *   - 敏感路径语料 = 正文 + README + 各 JSON（口径见 `text.ts#findSensitivePaths`）。
 *   - Trees 截断时「无 shell 脚本」不可证伪 → `install-scripts` 置 null（安装脚本钩子
 *     来自 package.json 文本，已证实的照扣）。
 */

import { REASON_TEXT } from './codes.ts';
import { hasShellScript } from './files.ts';
import { extractDomains, findLifecycleScripts, findSensitivePaths } from './text.ts';
import type { DimensionResult, DwdAsset, SignalDetail } from './types.ts';
import {
  collectDeductions,
  finalizeScore,
  makeDeduction,
  normalizedWeight,
  sortDeductions,
  weightedMean,
} from './util.ts';

/** 取字符串数组（非数组/非字符串项忽略）。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** 记录里是否含任一字段（非 null 即算）。 */
function hasAnyKey(record: Record<string, unknown> | null, keys: readonly string[]): boolean {
  if (record === null) return false;
  return keys.some((key) => {
    const value = record[key];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  });
}

/** 安全性评分。 */
export function scoreSecurity(input: DwdAsset): DimensionResult {
  const { asset, files, license, text } = input;
  const frontmatter = text.frontmatter ?? {};

  // —— 安装脚本 ——
  const lifecycleHooks = findLifecycleScripts(text.packageJson);
  const shellOnly = hasShellScript(files.entries);
  const installValue =
    lifecycleHooks.length > 0
      ? `lifecycle:${lifecycleHooks.join('+')}`
      : shellOnly
        ? 'shell-only'
        : files.truncated
          ? 'truncated'
          : 'none';
  const installScore = lifecycleHooks.length > 0 ? 0 : shellOnly ? 0.4 : files.truncated ? null : 1;

  // —— 权限声明（缺省注入 prompt:inject 不算声明，规格 §1.2）——
  const permissionsDeclared =
    asset.capabilitiesDeclared ||
    stringArray(frontmatter.allowedTools).length > 0 ||
    hasAnyKey(text.manifest, ['capabilities', 'permissions', 'allowedTools']) ||
    text.mcpJson !== null;

  // —— 出站域名：观测（清单/.mcp.json）− 声明 ——
  const observedDomains = extractDomains(
    `${JSON.stringify(text.manifest ?? {})}\n${JSON.stringify(text.mcpJson ?? {})}`,
  );
  const declaredDomains = new Set(
    [
      ...stringArray(frontmatter.outboundDomains),
      ...stringArray(text.manifest?.outboundDomains),
      ...stringArray(text.manifest?.domains),
      ...stringArray(text.manifest?.allowedHosts),
      ...asset.capabilities.filter((c) => c.startsWith('net:')).map((c) => c.slice(4)),
    ].map((d) => d.toLowerCase()),
  );
  const undeclaredDomains = observedDomains.filter((d) => !declaredDomains.has(d));

  // —— 敏感路径（工作目录外读写）——
  const pathCorpus = [
    text.body,
    text.readme,
    JSON.stringify(text.manifest ?? {}),
    JSON.stringify(text.mcpJson ?? {}),
    JSON.stringify(text.packageJson ?? {}),
  ]
    .filter((t): t is string => t !== null && t !== undefined)
    .join('\n');
  const sensitiveHits = findSensitivePaths(pathCorpus);

  const signals: SignalDetail[] = [
    {
      code: 'security.install-scripts',
      value: installValue,
      weight: 0.35,
      score: installScore,
    },
    {
      code: 'security.permissions',
      value: permissionsDeclared,
      weight: 0.3,
      score: permissionsDeclared ? 1 : 0,
    },
    {
      code: 'security.outbound',
      value: undeclaredDomains.length === 0 ? 'none' : undeclaredDomains.join(','),
      weight: 0.2,
      score: undeclaredDomains.length === 0 ? 1 : 0,
    },
    {
      code: 'security.sensitive-paths',
      value: sensitiveHits.length,
      weight: 0.15,
      score: sensitiveHits.length === 0 ? 1 : 0,
    },
  ];

  /** 按信号当前子分记一笔扣分。 */
  const deduct = (signalCode: string, reasonCode: string, reason: string) => {
    const s = signals.find((x) => x.code === signalCode);
    if (s === undefined || s.score === null || s.score >= 1) return null;
    return makeDeduction(reasonCode, reason, normalizedWeight(signals, signalCode) * (1 - s.score));
  };

  const baseDeductions = collectDeductions([
    deduct(
      'security.install-scripts',
      'X1',
      lifecycleHooks.length > 0
        ? `${REASON_TEXT.X1}（${lifecycleHooks.join('、')}）`
        : `${REASON_TEXT.X1}（shell 脚本）`,
    ),
    deduct('security.permissions', 'X2', REASON_TEXT.X2),
    deduct(
      'security.outbound',
      'X3',
      undeclaredDomains.length > 0
        ? `${REASON_TEXT.X3}（${undeclaredDomains.join('、')}）`
        : REASON_TEXT.X3,
    ),
    deduct(
      'security.sensitive-paths',
      'X4',
      sensitiveHits.length > 0
        ? `${REASON_TEXT.X4}（${sensitiveHits.slice(0, 2).join('、')}）`
        : REASON_TEXT.X4,
    ),
  ]);

  // L1 只说明不扣分（规格 §5.3 词表 + §5.4 硬口径）；delta 恒 0，排序自然沉底。
  const deductions =
    license.gate === 'loadable'
      ? baseDeductions
      : sortDeductions([...baseDeductions, { code: 'L1', reason: REASON_TEXT.L1, delta: 0 }]);

  return { score: finalizeScore(weightedMean(signals)), signals, deductions };
}
