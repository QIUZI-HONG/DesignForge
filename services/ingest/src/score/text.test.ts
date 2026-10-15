/**
 * 文本信号启发式单测（MK-03）。
 *
 * 断言口径全部来自规格 §5.2 的字面信号描述（何时使用 / 工作流 / 安装示例 /
 * 纯链接清单 / 出站域名 / 敏感路径 / 上游署名 / 安装脚本），不测实现细节。
 */

import { describe, expect, it } from 'vitest';
import {
  extractDomains,
  findLifecycleScripts,
  findSensitivePaths,
  hasExplicitWorkflow,
  hasInstallInstructions,
  hasUsageExample,
  isPureLinkList,
  looksLikeWhenToUse,
  mentionsUpstreamAttribution,
} from './text.ts';

describe('looksLikeWhenToUse（规格 §5.2：description 是否写成「何时使用」）', () => {
  it('英文触发语境通过', () => {
    expect(looksLikeWhenToUse('Use when the user needs to export paginated PDFs')).toBe(true);
    expect(looksLikeWhenToUse('When you want to convert a design into slides')).toBe(true);
  });

  it('中文触发语境通过', () => {
    expect(looksLikeWhenToUse('用于把设计稿导出为分页 PDF')).toBe(true);
    expect(looksLikeWhenToUse('当设计稿需要分页导出时使用')).toBe(true);
    expect(looksLikeWhenToUse('查看设计系统令牌，适用于品牌规范场景')).toBe(true);
  });

  it('纯功能陈述不通过', () => {
    expect(looksLikeWhenToUse('Exports designs to paginated PDF')).toBe(false);
    expect(looksLikeWhenToUse('把设计稿导出为分页 PDF 的资产')).toBe(false);
  });

  it('空串与空对象视为不通过', () => {
    expect(looksLikeWhenToUse('')).toBe(false);
    expect(looksLikeWhenToUse('   ')).toBe(false);
  });
});

describe('hasExplicitWorkflow（规格 §5.2：正文是否有显式工作流（步骤/命令块））', () => {
  it('顺序步骤列表通过', () => {
    expect(hasExplicitWorkflow('先做这个\n\n1. 打开面板\n2. 选择资产\n3. 确认装载')).toBe(true);
  });

  it('用法章节标题通过', () => {
    expect(hasExplicitWorkflow('## 用法\n\n把文件放进目录即可。')).toBe(true);
    expect(hasExplicitWorkflow('## Workflow\n\nJust do it.')).toBe(true);
  });

  it('命令块通过', () => {
    expect(hasExplicitWorkflow('```bash\nnpm install @dforge/cli\n```')).toBe(true);
    expect(hasExplicitWorkflow('```\n$ cp -r skill ~/.claude/skills\n```')).toBe(true);
  });

  it('纯散文不通过', () => {
    expect(hasExplicitWorkflow('这个资产帮你把设计稿导出成 PDF。它的输出很干净。')).toBe(false);
    expect(hasExplicitWorkflow('```\n设计稿 → 分页 PDF\n```')).toBe(false);
  });
});

describe('hasInstallInstructions / hasUsageExample（规格 §5.2：README 是否含安装与使用示例）', () => {
  it('包管理器安装命令与中文安装词都算安装说明', () => {
    expect(hasInstallInstructions('## Install\n\n```bash\nnpm i @dforge/cli\n```')).toBe(true);
    expect(hasInstallInstructions('把 skill 目录复制到你的技能目录即可')).toBe(true);
    expect(hasInstallInstructions('# PDF 导出\n\n一个导出工具。')).toBe(false);
  });

  it('示例章节、示例关键词或第二段代码块算使用示例', () => {
    expect(hasUsageExample('## 示例\n\n把稿子拖进来。')).toBe(true);
    expect(hasUsageExample('例如：选中三个画板后导出。')).toBe(true);
    expect(hasUsageExample('```bash\nnpm i x\n```\n\n```bash\nnpx x build --out a.pdf\n```')).toBe(
      true,
    );
    expect(hasUsageExample('# 工具\n\n它很好用。')).toBe(false);
  });
});

describe('isPureLinkList（规格 §2.2 内容校验③：排除仅罗列链接的 redirect 型）', () => {
  it('单行链接 = redirect', () => {
    expect(isPureLinkList('See https://github.com/anthropics/skills')).toBe(true);
    expect(isPureLinkList('')).toBe(true);
  });

  it('标题 + 链接的短文件 = redirect', () => {
    expect(isPureLinkList('# PDF\n\nhttps://github.com/foo/bar')).toBe(true);
  });

  it('链接清单 = redirect', () => {
    const list = [
      '- [a](https://a.example)',
      '- [b](https://b.example)',
      '- [c](https://c.example)',
    ].join('\n');
    expect(isPureLinkList(list)).toBe(true);
  });

  it('有真实步骤的正文不算', () => {
    const body = '# 标题\n\n这里是真实说明。\n\n1. 打开面板\n2. 选择资产\n\n```bash\nnpm i x\n```';
    expect(isPureLinkList(body)).toBe(false);
  });
});

describe('extractDomains（规格 §5.2：可疑网络调用——出站域名）', () => {
  it('提取小写、去重、排序', () => {
    const text =
      'fetch https://API.Example.com/v1 和 http://api.example.com/x 以及 https://other.io';
    expect(extractDomains(text)).toEqual(['api.example.com', 'other.io']);
  });

  it('无 URL 返回空数组', () => {
    expect(extractDomains('没有链接')).toEqual([]);
  });
});

describe('findSensitivePaths（规格 §5.2：敏感路径访问——工作目录外读写）', () => {
  it('识别系统绝对路径、家目录与两级以上回溯', () => {
    expect(findSensitivePaths('cat /etc/passwd')).toEqual(['/etc/passwd']);
    expect(findSensitivePaths('cp -r skill ~/.claude/skills')).toEqual(['~/']);
    expect(findSensitivePaths('读 ../../secrets.json')).toEqual(['../../']);
  });

  it('Windows 绝对路径识别', () => {
    expect(findSensitivePaths('写 C:\\Users\\me\\.dfg\\config')).toEqual(['C:\\']);
  });

  it('相对路径与 /tmp 不算敏感', () => {
    expect(findSensitivePaths('读 ./assets/a.png 和 assets/b.png')).toEqual([]);
    expect(findSensitivePaths('写到 /tmp/build/out.pdf')).toEqual([]);
  });
});

describe('mentionsUpstreamAttribution（规格 §5.2：许可说明含上游署名）', () => {
  it('英文与中文署名写法', () => {
    expect(mentionsUpstreamAttribution('Derived from zarazhangrui/beautiful-html-templates')).toBe(
      true,
    );
    expect(mentionsUpstreamAttribution('本仓库基于 XX 项目改编')).toBe(true);
  });

  it('无署名不通过', () => {
    expect(mentionsUpstreamAttribution('MIT licensed.')).toBe(false);
  });
});

describe('findLifecycleScripts（规格 §5.2：隐藏安装脚本 postinstall/preinstall）', () => {
  it('列出生命周期钩子', () => {
    const pkg = { scripts: { postinstall: 'node ./setup.js', build: 'tsc' } };
    expect(findLifecycleScripts(pkg)).toEqual(['postinstall']);
    expect(findLifecycleScripts({ scripts: { preinstall: 'a', prepare: 'b', test: 'c' } })).toEqual(
      ['preinstall', 'prepare'],
    );
  });

  it('空 scripts 与非字符串值不算', () => {
    expect(findLifecycleScripts(null)).toEqual([]);
    expect(findLifecycleScripts({ scripts: {} })).toEqual([]);
    expect(findLifecycleScripts({ scripts: { postinstall: null } })).toEqual([]);
  });
});
