/**
 * 四类资产识别整合（规格 §2.1：认定 = 结构探针 + 内容校验，两级都必须过）。
 *
 * 规则要点：
 *  - **资产粒度 = 目录**；一仓可产出多资产（§2.1.3）；
 *  - 同目录多命中取一，优先级 `plugin > design-system > template > skill`
 *    （理由：Plugin 天然包含 Skill，不重复计入）；落选者进 `rejected` 留痕；
 *  - 内容未取回（每仓取回预算所限）→ `compliance: 'deferred'` 如实标记，
 *    **绝不假装通过**（诚实性优先于好看的数字）。
 */

import { sha256Hex } from './http.ts';
import { assessLicense, detectBrandDerived } from './license.ts';
import { baseName, parentDir, probeTree } from './probe.ts';
import type {
  IdentifiedAsset,
  LicenseAssessment,
  ProbePiece,
  RejectedCandidate,
  TreeEntry,
} from './types.ts';
import {
  inspectTokensCss,
  inspectTokensJson,
  isI18nPath,
  validateDesignSystemManifest,
  validateMarketplaceManifest,
  validatePluginManifest,
  validateSkillDoc,
  validateTemplateManifest,
} from './validate.ts';

export interface IdentifyInput {
  repoFullName: string;
  tree: TreeEntry[];
  /** 已取回的描述性文本（路径 → 文本）；缺失即未取回。 */
  contents: Map<string, string>;
  /** 因取回预算耗尽而未取的路径（用于区分「未取回」与「不存在」）。 */
  deferredPaths: Set<string>;
  license: LicenseAssessment;
}

export interface IdentifyResult {
  assets: IdentifiedAsset[];
  rejected: RejectedCandidate[];
}

/** 同目录多命中的优先级（规格 §2.1.3）。 */
const KIND_PRIORITY = ['plugin', 'design-system', 'template', 'skill'] as const;

/** 机器名规范化（slug）：ASCII 安全、保留 `.` `_` `-`。 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+/, '')
    .replace(/[-._]+$/, '');
  return slug;
}

/** 根名字兜底：根为空串时用 `owner-repo`（marketplace 自指型插件）。 */
function fallbackName(root: string, repoFullName: string): string {
  if (root !== '') {
    const base = slugify(baseName(root));
    if (base !== '') return base;
  }
  return slugify(repoFullName.replace('/', '-'));
}

/**
 * 资产根内容摘要：该根下全部文件按 `相对路径\0blobSha\0size\n` 字典序拼接后取 sha256。
 * 确定性来自 Trees（同 commit 同路径 → 同摘要）；不等同于规格 §1.6 的 `digest`（见 types.ts）。
 */
export function digestForRoot(tree: TreeEntry[], root: string): string {
  const prefix = root === '' ? '' : `${root}/`;
  const files = tree
    .filter(
      (e) => e.type === 'blob' && (root === '' || e.path === root || e.path.startsWith(prefix)),
    )
    .map((e) => ({
      rel: e.path.slice(prefix.length),
      sha: e.sha,
      size: e.size ?? 0,
    }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const stream = files.map((f) => `${f.rel}\0${f.sha}\0${f.size}\n`).join('');
  return `sha256:${sha256Hex(stream)}`;
}

/** Trees 中定位许可原文（优先仓根、再浅层；用于 license 证据与取回选择）。 */
export function findLicensePath(tree: TreeEntry[]): string | null {
  const licenseRe = /^(license|licence|copying)(\.(md|txt|markdown))?$/i;
  const candidates = tree
    .filter((e) => e.type === 'blob' && licenseRe.test(baseName(e.path)))
    .map((e) => e.path)
    .sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  return candidates[0] ?? null;
}

/** 识别主入口（纯函数：同输入同输出）。 */
export function identifyAssets(input: IdentifyInput): IdentifyResult {
  const pieces = probeTree(input.tree);
  const byRoot = new Map<string, ProbePiece[]>();
  for (const piece of pieces) {
    const list = byRoot.get(piece.root);
    if (list) list.push(piece);
    else byRoot.set(piece.root, [piece]);
  }

  const assets: IdentifiedAsset[] = [];
  const rejected: RejectedCandidate[] = [];
  const roots = [...byRoot.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const root of roots) {
    const rootPieces = byRoot.get(root) ?? [];
    const outcomes: {
      kind: (typeof KIND_PRIORITY)[number];
      asset: IdentifiedAsset | null;
      rejections: RejectedCandidate[];
    }[] = [];

    outcomes.push(evaluateSkill(root, rootPieces, input));
    outcomes.push(evaluatePlugin(root, rootPieces, input));
    outcomes.push(evaluateDesignSystem(root, rootPieces, input));
    outcomes.push(evaluateTemplate(root, rootPieces, input));

    const winners = outcomes.filter((o) => o.asset !== null);
    if (winners.length === 0) {
      for (const outcome of outcomes) rejected.push(...outcome.rejections);
      continue;
    }

    const primary = KIND_PRIORITY.map((kind) => winners.find((w) => w.kind === kind)).find(
      (w) => w !== undefined,
    );
    if (!primary?.asset) continue;
    assets.push(primary.asset);

    for (const winner of winners) {
      if (winner === primary) continue;
      rejected.push({
        kind: winner.kind,
        root,
        piece: 'skill-doc',
        path: winner.asset?.probe[0]?.path ?? root,
        reason: `同目录多命中：优先级 plugin > design-system > template > skill，让位于 ${primary.kind}（规格 §2.1.3）`,
      });
    }
    for (const outcome of outcomes) {
      if (outcome.asset === null) rejected.push(...outcome.rejections);
    }
  }

  for (const asset of assets) {
    const piecesAtRoot = byRoot.get(asset.root) ?? [];
    if (piecesAtRoot.some((p) => p.piece === 'mcp-json')) {
      asset.capabilities = [...new Set([...asset.capabilities, 'mcp'])].sort();
    }
  }

  assets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rejected.sort((a, b) =>
    a.root < b.root
      ? -1
      : a.root > b.root
        ? 1
        : a.kind < b.kind
          ? -1
          : a.kind > b.kind
            ? 1
            : a.path < b.path
              ? -1
              : 1,
  );
  return { assets, rejected };
}

interface KindOutcome {
  kind: (typeof KIND_PRIORITY)[number];
  asset: IdentifiedAsset | null;
  rejections: RejectedCandidate[];
}

function makeId(repoFullName: string, root: string): string {
  return `gh:${repoFullName}#${root}`;
}

/** Skill 判定（规格 §2.2）。 */
function evaluateSkill(root: string, pieces: ProbePiece[], input: IdentifyInput): KindOutcome {
  const doc = pieces.find((p) => p.piece === 'skill-doc');
  if (!doc) return { kind: 'skill', asset: null, rejections: [] };

  const content = input.contents.get(doc.path);
  if (content === undefined) {
    const deferred = input.deferredPaths.has(doc.path);
    return {
      kind: 'skill',
      asset: {
        id: makeId(input.repoFullName, root),
        kind: 'skill',
        root,
        name: fallbackName(root, input.repoFullName),
        version: null,
        declaredLicense: null,
        compliance: 'deferred',
        probe: [{ piece: 'skill-doc', path: doc.path }],
        checks: [
          {
            rule: 'content-fetched',
            ok: false,
            detail: deferred
              ? '内容未取回（每仓取回预算所限）：校验待 MK-02/03 补齐'
              : '内容未取回（上游未返回正文）',
          },
        ],
        treeDigest: digestForRoot(input.tree, root),
        capabilities: [],
        brandDerived: false,
      },
      rejections: [],
    };
  }

  const verdict = validateSkillDoc(content);
  const checks = [
    {
      rule: 'frontmatter-parsed',
      ok: verdict.name !== null || verdict.reasons.every((r) => !r.includes('frontmatter')),
      detail: verdict.reasons.find((r) => r.includes('frontmatter')) ?? 'YAML frontmatter 可解析',
    },
    {
      rule: 'name-description-present',
      ok: verdict.name !== null && verdict.description !== null,
      detail: `name=${verdict.name ?? '缺失'} / description=${verdict.description === null ? '缺失' : '非空'}`,
    },
    {
      rule: 'body-usable',
      ok: !verdict.reasons.some((r) => r.includes('正文')),
      detail: verdict.reasons.find((r) => r.includes('正文')) ?? `正文 ${verdict.bodyBytes} 字节`,
    },
  ];

  if (verdict.compliance === 'suspect' || verdict.compliance === 'rejected') {
    return {
      kind: 'skill',
      asset: null,
      rejections: [
        {
          kind: 'skill',
          root,
          piece: 'skill-doc',
          path: doc.path,
          reason: verdict.reasons.join('；') || verdict.compliance,
        },
      ],
    };
  }

  return {
    kind: 'skill',
    asset: {
      id: makeId(input.repoFullName, root),
      kind: 'skill',
      root,
      name:
        verdict.name !== null
          ? slugify(verdict.name) || verdict.name
          : fallbackName(root, input.repoFullName),
      version: null,
      declaredLicense: verdict.declaredLicense,
      compliance: verdict.compliance,
      probe: [{ piece: 'skill-doc', path: doc.path }],
      checks,
      treeDigest: digestForRoot(input.tree, root),
      capabilities: [],
      brandDerived: false,
    },
    rejections: [],
  };
}

/** Plugin 判定（规格 §2.3）。 */
function evaluatePlugin(root: string, pieces: ProbePiece[], input: IdentifyInput): KindOutcome {
  const manifestPieces = pieces.filter(
    (p) =>
      p.piece === 'plugin-manifest' ||
      p.piece === 'marketplace-manifest' ||
      p.piece === 'package-json',
  );
  if (manifestPieces.length === 0) return { kind: 'plugin', asset: null, rejections: [] };

  const rejections: RejectedCandidate[] = [];
  for (const piece of manifestPieces) {
    const content = input.contents.get(piece.path);
    const kindLabel =
      piece.piece === 'marketplace-manifest'
        ? 'marketplace'
        : piece.piece === 'package-json'
          ? 'package.json'
          : 'plugin.json';

    if (content === undefined) {
      // package.json 的常规库不构成候选；plugin/marketplace 清单未取回 → deferred 资产（结构已明确）。
      if (piece.piece === 'package-json') continue;
      return {
        kind: 'plugin',
        asset: {
          id: makeId(input.repoFullName, root),
          kind: 'plugin',
          root,
          name: fallbackName(root, input.repoFullName),
          version: null,
          declaredLicense: null,
          compliance: 'deferred',
          probe: [{ piece: piece.piece, path: piece.path }],
          checks: [{ rule: 'content-fetched', ok: false, detail: `${kindLabel} 未取回，校验待补` }],
          treeDigest: digestForRoot(input.tree, root),
          capabilities: [],
          brandDerived: false,
        },
        rejections: [],
      };
    }

    if (piece.piece === 'marketplace-manifest') {
      const verdict = validateMarketplaceManifest(content, input.repoFullName);
      if (verdict.ok) {
        return {
          kind: 'plugin',
          asset: {
            id: makeId(input.repoFullName, root),
            kind: 'plugin',
            root,
            name: slugify(input.repoFullName.replace('/', '-')),
            version: null,
            declaredLicense: null,
            compliance: 'ok',
            probe: [{ piece: piece.piece, path: piece.path }],
            checks: [
              {
                rule: 'marketplace-self-referencing',
                ok: true,
                detail: `${verdict.entries} 条条目中 ${verdict.selfReferencing} 条 source 指向本仓`,
              },
            ],
            treeDigest: digestForRoot(input.tree, root),
            capabilities: [],
            brandDerived: false,
          },
          rejections,
        };
      }
      rejections.push({
        kind: 'plugin',
        root,
        piece: piece.piece,
        path: piece.path,
        reason: verdict.reasons.join('；') || 'marketplace 条目无 source 指向本仓（规格 §2.3）',
      });
      continue;
    }

    if (piece.piece === 'package-json') {
      const verdict = validatePluginManifest(content, piece.path);
      // package.json 只有声明 contributes/df-plugin 才算插件候选（规格 §2.3）。
      if (
        verdict.ok &&
        verdict.declares.some((d) => d === 'contributes' || d === 'df-plugin' || d === 'dfPlugin')
      ) {
        return {
          kind: 'plugin',
          asset: {
            id: makeId(input.repoFullName, root),
            kind: 'plugin',
            root,
            name:
              verdict.name !== null
                ? slugify(verdict.name) || verdict.name
                : fallbackName(root, input.repoFullName),
            version: null,
            declaredLicense: null,
            compliance: 'ok',
            probe: [{ piece: piece.piece, path: piece.path }],
            checks: [
              {
                rule: 'package-json-plugin-declared',
                ok: true,
                detail: `声明 ${verdict.declares.join('/')}`,
              },
            ],
            treeDigest: digestForRoot(input.tree, root),
            capabilities: [],
            brandDerived: false,
          },
          rejections,
        };
      }
      continue; // 普通库的 package.json 不是候选，不记 rejected（避免噪声）
    }

    // plugin.json / .claude-plugin/plugin.json
    const verdict = validatePluginManifest(content, piece.path);
    if (verdict.ok) {
      return {
        kind: 'plugin',
        asset: {
          id: makeId(input.repoFullName, root),
          kind: 'plugin',
          root,
          name:
            verdict.name !== null
              ? slugify(verdict.name) || verdict.name
              : fallbackName(root, input.repoFullName),
          version: null,
          declaredLicense: null,
          compliance: 'ok',
          probe: [{ piece: piece.piece, path: piece.path }],
          checks: [
            {
              rule: 'plugin-manifest-parsed',
              ok: true,
              detail: `声明 ${verdict.declares.join('/')}`,
            },
          ],
          treeDigest: digestForRoot(input.tree, root),
          capabilities: [],
          brandDerived: false,
        },
        rejections,
      };
    }

    // 仅含 name、无条目字段 → 同目录/同仓存在通过（或待校验）的 SKILL.md 时成立（规格 §2.3 内容校验②）
    const siblingSkill = pieces.find((p) => p.piece === 'skill-doc');
    if (verdict.name !== null && siblingSkill) {
      const skillContent = input.contents.get(siblingSkill.path);
      const skillOk =
        skillContent === undefined
          ? input.deferredPaths.has(siblingSkill.path)
          : validateSkillDoc(skillContent).compliance !== 'rejected' &&
            validateSkillDoc(skillContent).compliance !== 'suspect';
      if (skillOk) {
        return {
          kind: 'plugin',
          asset: {
            id: makeId(input.repoFullName, root),
            kind: 'plugin',
            root,
            name: slugify(verdict.name) || fallbackName(root, input.repoFullName),
            version: null,
            declaredLicense: null,
            compliance: skillContent === undefined ? 'deferred' : 'ok',
            probe: [
              { piece: piece.piece, path: piece.path },
              { piece: 'skill-doc', path: siblingSkill.path },
            ],
            checks: [
              { rule: 'plugin-manifest-parsed', ok: true, detail: '清单含 name' },
              {
                rule: 'plugin-skill-justified',
                ok: true,
                detail: `同目录 SKILL.md 佐证：${siblingSkill.path}`,
              },
            ],
            treeDigest: digestForRoot(input.tree, root),
            capabilities: [],
            brandDerived: false,
          },
          rejections,
        };
      }
    }

    rejections.push({
      kind: 'plugin',
      root,
      piece: piece.piece,
      path: piece.path,
      reason: verdict.reasons.join('；') || '无条目字段且同目录无通过校验的 SKILL.md',
    });
  }

  return { kind: 'plugin', asset: null, rejections };
}

/** Design System 判定（规格 §2.4：≥2 项结构件 + token 形态硬门槛）。 */
function evaluateDesignSystem(
  root: string,
  pieces: ProbePiece[],
  input: IdentifyInput,
): KindOutcome {
  const tokenPieces = pieces.filter((p) => p.piece === 'tokens-file');
  const supportPieces = pieces.filter(
    (p) =>
      p.piece === 'design-md' ||
      p.piece === 'manifest-json' ||
      p.piece === 'components-manifest' ||
      p.piece === 'preview-dir',
  );
  if (tokenPieces.length === 0 && supportPieces.length === 0) {
    return { kind: 'design-system', asset: null, rejections: [] };
  }

  const rejections: RejectedCandidate[] = [];
  const checks = [];
  let tokenOk = false;
  let tokenPending = false;
  let tokenDetail = '';

  for (const piece of tokenPieces) {
    const name = baseName(piece.path);
    if (isI18nPath(piece.path)) {
      checks.push({
        rule: 'tokens-not-i18n',
        ok: false,
        detail: `${piece.path}：路径含 i18n/langs/locale，直接丢弃（规格 §2.4 反例）`,
      });
      rejections.push({
        kind: 'design-system',
        root,
        piece: 'tokens-file',
        path: piece.path,
        reason:
          '路径含 i18n/langs/locale 的 token 文件直接丢弃（规格 §2.4 反例，研究 #4 §3.4 实测）',
      });
      continue;
    }
    const content = input.contents.get(piece.path);
    if (content === undefined) {
      // 未取回（预算所限或上游未给）：如实标记 pending，不假装校验过。
      tokenPending = true;
      continue;
    }
    if (name.endsWith('.json')) {
      const verdict = inspectTokensJson(content);
      checks.push({
        rule: 'tokens-dtcg-shape',
        ok: verdict.ok,
        detail: `${piece.path}：${verdict.reasons.join('；')}`,
      });
      if (verdict.ok) {
        tokenOk = true;
        tokenDetail = piece.path;
      }
    } else if (name.endsWith('.css')) {
      const verdict = inspectTokensCss(content);
      checks.push({
        rule: 'tokens-css-vars',
        ok: verdict.ok,
        detail: `${piece.path}：${verdict.reasons.join('；')}`,
      });
      if (verdict.ok) {
        tokenOk = true;
        tokenDetail = piece.path;
      }
    } else {
      // tailwind.config.*：JS/TS 配置，做轻量形态检查（规格 v1.1 §4.4.1 归入 tokens 证据）。
      const ok = /\btheme\b|\bcolors\b|content\s*:/.test(content);
      checks.push({
        rule: 'tokens-tailwind-config',
        ok,
        detail: `${piece.path}：${ok ? '含 theme/colors 配置' : '未见图样配置'}`,
      });
      if (ok) {
        tokenOk = true;
        tokenDetail = piece.path;
      }
    }
  }

  // 支持件判定：DESIGN.md（结构即可）/ 设计系统 manifest（内容分流）/ components.manifest.json / preview/ 目录
  let supportOk = false;
  let supportDetail = '';
  let manifestName: string | null = null;
  let manifestSourceType: string | null = null;
  let supportPending = false;

  for (const piece of supportPieces) {
    if (
      piece.piece === 'design-md' ||
      piece.piece === 'components-manifest' ||
      piece.piece === 'preview-dir'
    ) {
      supportOk = true;
      supportDetail = piece.path;
      break;
    }
    if (piece.piece === 'manifest-json') {
      const content = input.contents.get(piece.path);
      if (content === undefined) {
        supportPending = true;
        continue;
      }
      const verdict = validateDesignSystemManifest(content);
      checks.push({
        rule: 'ds-manifest',
        ok: verdict.ok,
        detail: `${piece.path}：${verdict.reasons.join('；') || '设计系统清单'}`,
      });
      if (verdict.ok) {
        supportOk = true;
        supportDetail = piece.path;
        manifestName = verdict.name;
        manifestSourceType = verdict.sourceType;
        break;
      }
    }
  }

  // 硬门槛（规格 §2.4）：① ≥1 个 token 文件通过形态校验；② 另有 ≥1 项支持件。
  if (tokenPieces.length === 0) {
    // 无任何 token 结构件 → 不构成设计系统候选（静默跳过，不进 rejected 噪声）。
    return { kind: 'design-system', asset: null, rejections: [] };
  }
  if (!tokenOk && !tokenPending) {
    checks.push({
      rule: 'tokens-shape-gate',
      ok: false,
      detail: '无通过形态校验的 token 文件（硬门槛 ①，规格 §2.4）',
    });
    rejections.push({
      kind: 'design-system',
      root,
      piece: 'tokens-file',
      path: tokenPieces[0]?.path ?? root,
      reason: 'token 文件均未通过形态校验（非 DTCG/CSS 变量），不认定（规格 §2.4 硬门槛 ①）',
    });
    return { kind: 'design-system', asset: null, rejections };
  }
  if (!supportOk && !supportPending) {
    checks.push({
      rule: 'ds-support-piece',
      ok: false,
      detail: '缺 DESIGN.md/manifest/components.manifest/preview 之一（硬门槛 ②，规格 §2.4）',
    });
    rejections.push({
      kind: 'design-system',
      root,
      piece: tokenPieces[0]?.piece ?? 'tokens-file',
      path: tokenPieces[0]?.path ?? root,
      reason:
        '缺 ≥1 项支持件（DESIGN.md/设计系统 manifest/components.manifest/preview），不认定（规格 §2.4 硬门槛 ②）',
    });
    return { kind: 'design-system', asset: null, rejections };
  }

  const compliance: IdentifiedAsset['compliance'] = tokenOk && supportOk ? 'ok' : 'deferred';
  if (compliance === 'ok') {
    checks.push({
      rule: 'ds-hard-gate',
      ok: true,
      detail: `token=${tokenDetail} + 支持件=${supportDetail}`,
    });
  } else {
    checks.push({
      rule: 'ds-hard-gate',
      ok: false,
      detail: '部分结构件未取回，形态校验待补（deferred）',
    });
  }

  const nameCandidate = manifestName ?? (root === '' ? null : baseName(root));
  const assetName =
    nameCandidate !== null && nameCandidate.trim() !== ''
      ? slugify(nameCandidate) || nameCandidate
      : fallbackName(root, input.repoFullName);
  const brandDerived = detectBrandDerived({ name: assetName, manifestSourceType });

  return {
    kind: 'design-system',
    asset: {
      id: makeId(input.repoFullName, root),
      kind: 'design-system',
      root,
      name: assetName,
      version: null,
      declaredLicense: null,
      compliance,
      probe: pieces.map((p) => ({ piece: p.piece, path: p.path })),
      checks,
      treeDigest: digestForRoot(input.tree, root),
      capabilities: [],
      brandDerived,
    },
    rejections,
  };
}

/** Template 判定（规格 §2.5）。 */
function evaluateTemplate(root: string, pieces: ProbePiece[], input: IdentifyInput): KindOutcome {
  const manifestPieces = pieces.filter(
    (p) => p.piece === 'template-manifest' || p.piece === 'manifest-json',
  );
  if (manifestPieces.length === 0) return { kind: 'template', asset: null, rejections: [] };

  const rejections: RejectedCandidate[] = [];
  const checks = [];

  for (const piece of manifestPieces) {
    const content = input.contents.get(piece.path);
    if (content === undefined) {
      if (input.deferredPaths.has(piece.path)) {
        return {
          kind: 'template',
          asset: {
            id: makeId(input.repoFullName, root),
            kind: 'template',
            root,
            name: fallbackName(root, input.repoFullName),
            version: null,
            declaredLicense: null,
            compliance: 'deferred',
            probe: [{ piece: piece.piece, path: piece.path }],
            checks: [{ rule: 'content-fetched', ok: false, detail: '模板清单未取回，校验待补' }],
            treeDigest: digestForRoot(input.tree, root),
            capabilities: [],
            brandDerived: false,
          },
          rejections: [],
        };
      }
      continue;
    }

    const verdict = validateTemplateManifest(content);
    if (!verdict.ok) {
      // 只有明确长得像模板清单的才记 rejected（普通 DS manifest 不算模板候选）。
      if (verdict.kind === 'none' && verdict.name !== null) {
        rejections.push({
          kind: 'template',
          root,
          piece: piece.piece,
          path: piece.path,
          reason: verdict.reasons.join('；'),
        });
      }
      continue;
    }

    const artifacts = collectArtifacts(root, piece.path, pieces, input.tree);
    checks.push({
      rule: 'template-manifest',
      ok: true,
      detail: `${piece.path}：${verdict.kind === 'entries' ? `${verdict.entryPaths.length} 条条目` : '身份型清单'}`,
    });

    if (verdict.kind === 'entries') {
      const missing = verdict.entryPaths.filter(
        (rel) => !input.tree.some((e) => e.type === 'blob' && e.path.endsWith(rel)),
      );
      if (missing.length > 0) {
        return {
          kind: 'template',
          asset: null,
          rejections: [
            {
              kind: 'template',
              root,
              piece: piece.piece,
              path: piece.path,
              reason: `条目文件在 Trees 中不存在：${missing.join(', ')}（存在性校验，规格 §2.5 ①）`,
            },
          ],
        };
      }
      if (artifacts.length === 0) {
        return {
          kind: 'template',
          asset: null,
          rejections: [
            {
              kind: 'template',
              root,
              piece: piece.piece,
              path: piece.path,
              reason:
                '无渲染产物（.html/.svg/.png）：preview/·examples/ 或同根条目文件皆无（规格 §2.5 ②）',
            },
          ],
        };
      }
    } else {
      // 身份型清单（如 beautiful-html-templates）：需同根渲染产物佐证。
      if (artifacts.length === 0) {
        return {
          kind: 'template',
          asset: null,
          rejections: [
            {
              kind: 'template',
              root,
              piece: piece.piece,
              path: piece.path,
              reason: '身份型清单但同根无渲染产物（.html/.svg/.png），不认定（规格 §2.5 ②）',
            },
          ],
        };
      }
    }

    checks.push({
      rule: 'template-artifact',
      ok: true,
      detail: `渲染产物：${artifacts.join(', ')}`,
    });
    return {
      kind: 'template',
      asset: {
        id: makeId(input.repoFullName, root),
        kind: 'template',
        root,
        name:
          verdict.name !== null && verdict.name.trim() !== ''
            ? slugify(verdict.name) || verdict.name
            : fallbackName(root, input.repoFullName),
        version: null,
        declaredLicense: null,
        compliance: 'ok',
        probe: pieces.map((p) => ({ piece: p.piece, path: p.path })),
        checks,
        treeDigest: digestForRoot(input.tree, root),
        capabilities: [],
        brandDerived: false,
      },
      rejections,
    };
  }

  return { kind: 'template', asset: null, rejections };
}

/** 渲染产物收集：preview/·examples/ 目录内、或清单同根的文件（.html/.svg/.png）。 */
function collectArtifacts(
  _root: string,
  manifestPath: string,
  pieces: ProbePiece[],
  tree: TreeEntry[],
): string[] {
  const dirs = pieces
    .filter((p) => p.piece === 'preview-dir' || p.piece === 'examples-dir')
    .map((p) => p.path);
  const rendered = /\.(html|svg|png)$/i;
  const out = new Set<string>();
  for (const entry of tree) {
    if (entry.type !== 'blob' || !rendered.test(entry.path)) continue;
    const inDir = dirs.some((dir) => entry.path.startsWith(`${dir}/`));
    const sameDirAsManifest = parentDir(entry.path) === parentDir(manifestPath);
    if (inDir || sameDirAsManifest) out.add(entry.path);
  }
  return [...out].sort();
}

/** 供上层复用：把识别层默认守门（无 license 档）用于未接入 license 的场景（如单元测试）。 */
export function defaultViewOnlyLicense(): LicenseAssessment {
  return assessLicense({ spdx: null, hasLicenseFile: false, archived: false, brandDerived: false });
}
