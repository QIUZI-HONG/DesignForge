/**
 * 维度三 · 文档完备度 `docs`（权重 .20，规格 §5.1/§5.2）。
 *
 * 信号与子权（维度内归一化，和 = 1.00）：
 *   docs.readme          .30  README 存在性（缺 → D1）
 *   docs.usage           .30  README 是否含安装说明与使用示例（各半分；缺 → D2）
 *   docs.preview         .15  预览资产（`preview/` 图或 `components.html`；缺 → D3）
 *   docs.changelog       .10  changelog（正文或 CHANGELOG* 文件；缺 → D4）
 *   docs.license-clarity .15  许可说明清晰度 = .6×有许可原文 + .4×署名齐（缺 → D5）
 *
 * 口径说明：
 *   - 上游署名只在**声明了上游**（`repo.upstream` 非空）时才要求（未声明上游即无署名义务）；
 *   - 许可原文 = SPDX 可识别，或随附 LICENSE/COPYING 文件，或守门证据路径非空——
 *     `NOASSERTION` 且无原文 = 说明不清（扣的是**文档**分，与 §5.4「不从安全性扣分」不冲突）；
 *   - Trees 截断时「无预览资产」「无 changelog」不可证明 → 该信号置 null（不扣分）。
 *     截断不可证伪规则只适用于**纯文件清单扫描**的信号；文本抽取字段（README/正文/清单）
 *     是 MK-02 的实际读取结果，按真值处理（口径线在此，改则同步改测试与报告）。
 */

import { REASON_TEXT } from './codes.ts';
import { hasChangelogFile, hasLicenseFile, hasPreviewAsset } from './files.ts';
import { hasInstallInstructions, hasUsageExample, mentionsUpstreamAttribution } from './text.ts';
import type { DimensionResult, DwdAsset, SignalDetail } from './types.ts';
import {
  collectDeductions,
  finalizeScore,
  makeDeduction,
  normalizedWeight,
  weightedMean,
} from './util.ts';

/** 文档完备度评分。 */
export function scoreDocs(input: DwdAsset): DimensionResult {
  const { text, files, license, repo } = input;
  const readme = text.readme !== null && text.readme.trim() !== '' ? text.readme : null;
  const corpus = [text.readme, text.body].filter((t): t is string => t !== null).join('\n');

  // 使用示例：README 缺失 → 0；安装/示例各半分。
  const hasInstall = readme !== null && hasInstallInstructions(readme);
  const hasUsage = readme !== null && hasUsageExample(readme);
  const usageScore = readme === null ? 0 : (Number(hasInstall) + Number(hasUsage)) / 2;

  const previewFound = hasPreviewAsset(files.entries);
  // changelog 既可由正文抽取给出，也可由文件清单认出；两者都没有且 Trees 截断 → 不可证伪。
  const changelogFound =
    (text.changelog !== null && text.changelog.trim() !== '') || hasChangelogFile(files.entries);
  const changelogValue = changelogFound ? true : files.truncated ? 'truncated' : false;
  const changelogScore = changelogFound ? 1 : files.truncated ? null : 0;

  const licenseText =
    (license.spdx !== null && license.spdx !== 'NOASSERTION') ||
    license.evidence.path !== null ||
    hasLicenseFile(files.entries);
  // 未声明上游 → 无署名义务，视为满足。
  const attributionOk = repo.upstream === null || mentionsUpstreamAttribution(corpus);
  const licenseScore = 0.6 * Number(licenseText) + 0.4 * Number(attributionOk);
  const licenseState =
    licenseText && attributionOk
      ? 'ok'
      : licenseText
        ? 'no-attribution'
        : attributionOk
          ? 'no-license-text'
          : 'neither';

  const signals: SignalDetail[] = [
    { code: 'docs.readme', value: readme !== null, weight: 0.3, score: readme !== null ? 1 : 0 },
    {
      code: 'docs.usage',
      value:
        readme === null
          ? 'no-readme'
          : `${hasInstall ? 'install' : 'no-install'}+${hasUsage ? 'example' : 'no-example'}`,
      weight: 0.3,
      score: usageScore,
    },
    {
      code: 'docs.preview',
      value: previewFound ? true : files.truncated ? 'truncated' : false,
      weight: 0.15,
      score: previewFound ? 1 : files.truncated ? null : 0,
    },
    { code: 'docs.changelog', value: changelogValue, weight: 0.1, score: changelogScore },
    {
      code: 'docs.license-clarity',
      value: licenseState,
      weight: 0.15,
      score: licenseScore,
    },
  ];

  /** 按信号当前子分记一笔扣分。 */
  const deduct = (signalCode: string, reasonCode: string, reason: string) => {
    const s = signals.find((x) => x.code === signalCode);
    if (s === undefined || s.score === null || s.score >= 1) return null;
    return makeDeduction(reasonCode, reason, normalizedWeight(signals, signalCode) * (1 - s.score));
  };

  const usageReason =
    readme === null
      ? '无 README，安装与使用示例无从谈起'
      : hasInstall && !hasUsage
        ? 'README 未含使用示例'
        : !hasInstall && hasUsage
          ? 'README 未含安装说明'
          : 'README 未含安装说明与使用示例';

  const missingLicenseParts = [
    licenseText ? null : '缺许可原文',
    attributionOk ? null : '缺上游署名',
  ].filter((p): p is string => p !== null);

  const deductions = collectDeductions([
    deduct('docs.readme', 'D1', REASON_TEXT.D1),
    deduct('docs.usage', 'D2', `${REASON_TEXT.D2}（${usageReason}）`),
    deduct('docs.preview', 'D3', REASON_TEXT.D3),
    deduct('docs.changelog', 'D4', REASON_TEXT.D4),
    deduct('docs.license-clarity', 'D5', `${REASON_TEXT.D5}（${missingLicenseParts.join('、')}）`),
  ]);

  return { score: finalizeScore(weightedMean(signals)), signals, deductions };
}
