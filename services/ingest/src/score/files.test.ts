/**
 * 文件清单信号单测（MK-03）。
 *
 * 断言口径来自规格 §5.2 各维信号的文件级判据（CI 存在性 / 预览资产 / changelog /
 * 许可原文 / references 与 examples / shell 脚本），不测实现细节。
 */

import { describe, expect, it } from 'vitest';
import {
  hasAuxDir,
  hasChangelogFile,
  hasLicenseFile,
  hasPreviewAsset,
  hasShellScript,
  hasWorkflowFiles,
} from './files.ts';

/** 构造文件条目（只需路径参与判定）。 */
function entries(paths: string[]): { path: string; size: number; sha256: string }[] {
  return paths.map((path) => ({ path, size: 1, sha256: 'x'.repeat(64) }));
}

describe('hasWorkflowFiles（规格 §5.2：是否有 CI）', () => {
  it('识别 .github/workflows 下的 yml', () => {
    expect(hasWorkflowFiles(entries(['.github/workflows/ci.yml']))).toBe(true);
    expect(hasWorkflowFiles(entries(['.github/workflows/release.yaml']))).toBe(true);
  });

  it('目录本身或非 yml 不算', () => {
    expect(hasWorkflowFiles(entries(['.github/workflows/']))).toBe(false);
    expect(hasWorkflowFiles(entries(['.github/workflows/README.md']))).toBe(false);
    expect(hasWorkflowFiles(entries([]))).toBe(false);
  });
});

describe('hasPreviewAsset（规格 §5.2：preview/ 图或 components.html）', () => {
  it('preview 图与 components.html 都算', () => {
    expect(hasPreviewAsset(entries(['preview/hero.png']))).toBe(true);
    expect(hasPreviewAsset(entries(['components.html']))).toBe(true);
    expect(hasPreviewAsset(entries(['nested/components.html']))).toBe(true);
  });

  it('非图片与无关 html 不算', () => {
    expect(hasPreviewAsset(entries(['preview/notes.md']))).toBe(false);
    expect(hasPreviewAsset(entries(['index.html']))).toBe(false);
  });
});

describe('hasChangelogFile（规格 §5.2：是否有 changelog）', () => {
  it('常见命名', () => {
    expect(hasChangelogFile(entries(['CHANGELOG.md']))).toBe(true);
    expect(hasChangelogFile(entries(['docs/CHANGELOG']))).toBe(true);
  });

  it('无关文件不算', () => {
    expect(hasChangelogFile(entries(['changes.md']))).toBe(false);
  });
});

describe('hasLicenseFile（规格 §5.2：许可说明清晰度）', () => {
  it('LICENSE 家族与 COPYING', () => {
    expect(hasLicenseFile(entries(['LICENSE']))).toBe(true);
    expect(hasLicenseFile(entries(['LICENSE-MIT']))).toBe(true);
    expect(hasLicenseFile(entries(['license.md']))).toBe(true);
    expect(hasLicenseFile(entries(['COPYING']))).toBe(true);
  });

  it('无关文件不算', () => {
    expect(hasLicenseFile(entries(['licensing-tips.md']))).toBe(false);
  });
});

describe('hasAuxDir（规格 §5.2：是否附 references/ 或 examples/）', () => {
  it('资产根下两目录均算', () => {
    expect(hasAuxDir(entries(['references/api.md']))).toBe(true);
    expect(hasAuxDir(entries(['examples/demo.html']))).toBe(true);
  });

  it('嵌套在别处不算与大小写兼容', () => {
    expect(hasAuxDir(entries(['sub/references/api.md']))).toBe(false);
    expect(hasAuxDir(entries(['References/api.md']))).toBe(true);
  });
});

describe('hasShellScript（规格 §5.2：shell 脚本）', () => {
  it('常见脚本后缀', () => {
    expect(hasShellScript(entries(['scripts/setup.sh']))).toBe(true);
    expect(hasShellScript(entries(['run.ps1']))).toBe(true);
  });

  it('非脚本不算', () => {
    expect(hasShellScript(entries(['src/shell.ts']))).toBe(false);
  });
});
