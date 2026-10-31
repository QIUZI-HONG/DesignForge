/**
 * 页面参考线测试（票 12 · spec P2 标尺参考线）。
 *
 * 断言口径：只测外部行为——数据形状（createPage/guidesOf）、结构校验（validatePage 的
 * 问题项）、序列化往返（幂等 + 旧文档兼容）、命令栈写路径（page.update 补丁 + 逆命令）。
 * 不测内部实现：参考线没有私有结构，一切经公开面观察。
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands/apply';
import {
  createDocument,
  createGuide,
  createPage,
  createRect,
  type DesignDocument,
  guidesOf,
  parseDocument,
  roundTripDocument,
  serializeDocument,
  stableStringify,
  validatePage,
} from '../index';

describe('页面参考线 · 数据模型', () => {
  it('createPage 默认不带参考线（空数组）', () => {
    const page = createPage({ id: 'page_1' });
    expect(page.guides).toEqual([]);
  });

  it('createPage 接受初始参考线（从标尺拉出的水平/垂直线）', () => {
    const page = createPage({
      id: 'page_1',
      guides: [
        createGuide({ id: 'guide_1', axis: 'y', position: 120 }),
        createGuide({ id: 'guide_2', axis: 'x', position: 80 }),
      ],
    });
    expect(page.guides).toHaveLength(2);
    expect(page.guides[0]).toEqual({ id: 'guide_1', axis: 'y', position: 120 });
    expect(page.guides[1]).toEqual({ id: 'guide_2', axis: 'x', position: 80 });
  });

  it('guidesOf 对旧文档（运行时缺 guides 字段）返回空数组，不抛错', () => {
    const page = createPage({ id: 'page_1' });
    // 模拟旧版本序列化产物：页面没有 guides 键
    const legacy = page as unknown as Record<string, unknown>;
    delete legacy.guides;
    expect(guidesOf(legacy as unknown as typeof page)).toEqual([]);
  });
});

describe('页面参考线 · 结构校验', () => {
  it('合法参考线不产生问题项', () => {
    const page = createPage({
      id: 'page_1',
      guides: [createGuide({ id: 'guide_1', axis: 'x', position: 50 })],
    });
    expect(validatePage(page).filter((issue) => issue.code === 'invalid-guide')).toEqual([]);
  });

  it('非数组成员 / 缺 id / 未知轴 / 非有限位置各自报 invalid-guide 或 non-finite-number', () => {
    const page = createPage({ id: 'page_1' });
    const broken = page as unknown as Record<string, unknown>;
    broken.guides = [
      '不是对象',
      { axis: 'x', position: 10 },
      { id: 'g2', axis: 'z', position: 10 },
      { id: 'g3', axis: 'x', position: Number.NaN },
    ];
    const issues = validatePage(page as unknown as typeof page);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('invalid-guide');
    expect(codes).toContain('non-finite-number');
  });

  it('参考线 id 重复报 invalid-guide', () => {
    const page = createPage({
      id: 'page_1',
      guides: [
        createGuide({ id: 'guide_dup', axis: 'x', position: 10 }),
        createGuide({ id: 'guide_dup', axis: 'y', position: 20 }),
      ],
    });
    const issues = validatePage(page);
    expect(issues.some((issue) => issue.code === 'invalid-guide')).toBe(true);
  });
});

describe('页面参考线 · 序列化往返', () => {
  const documentWithGuides = (): DesignDocument =>
    createDocument({
      id: 'doc_1',
      name: '参考线夹具',
      pages: [
        createPage({
          id: 'page_1',
          nodes: { n_1: createRect({ id: 'n_1', x: 0, y: 0, width: 40, height: 30 }) },
          rootIds: ['n_1'],
          guides: [
            createGuide({ id: 'guide_1', axis: 'y', position: 120.5 }),
            createGuide({ id: 'guide_2', axis: 'x', position: -30 }),
          ],
        }),
      ],
    });

  it('往返后参考线原样保留', () => {
    const round = roundTripDocument(documentWithGuides());
    expect(round.pages[0]?.guides).toEqual(documentWithGuides().pages[0]?.guides);
  });

  it('序列化幂等：同文档两次序列化逐字节相同（稳定键序）', () => {
    const first = serializeDocument(documentWithGuides());
    const second = serializeDocument(roundTripDocument(documentWithGuides()));
    expect(second).toBe(first);
    // guides 键排在页面字段序里的确定位置（稳定键序，可 Git diff）
    expect(first).toContain('"guides"');
  });

  it('旧文档（无 guides 键）解析不报错，guidesOf 返回空', () => {
    const raw = JSON.parse(serializeDocument(createDocument({ id: 'doc_1' }))) as Record<
      string,
      unknown
    >;
    const page = (raw.document as { pages: Array<Record<string, unknown>> }).pages[0];
    if (page === undefined) throw new Error('夹具缺页面');
    delete page.guides;
    const parsed = parseDocument(raw);
    expect(guidesOf(parsed.document.pages[0] as (typeof parsed.document.pages)[0])).toEqual([]);
  });

  it('guides 数组在稳定键序下顺序保持（数组不排序）', () => {
    const doc = documentWithGuides();
    const text = stableStringify(doc);
    const first = text.indexOf('"guide_1"');
    const second = text.indexOf('"guide_2"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });
});

describe('页面参考线 · 命令栈写路径', () => {
  const document = (): DesignDocument =>
    createDocument({
      id: 'doc_1',
      pages: [createPage({ id: 'page_1' })],
    });

  it('page.update 写入 guides；逆命令还原旧 guides（撤销后消失）', () => {
    const initial = document();
    const guides = [createGuide({ id: 'guide_1', axis: 'x', position: 64 })];
    const applied = applyCommand(initial, {
      type: 'page.update',
      pageId: 'page_1',
      patch: { guides },
    });
    expect(applied.document.pages[0]?.guides).toEqual(guides);

    const undone = applied.inverse.reduce(
      (current, command) => applyCommand(current, command).document,
      applied.document,
    );
    expect(undone.pages[0]?.guides).toEqual([]);
  });

  it('page.update 更新单条参考线位置；撤销还原位置', () => {
    const guides = [createGuide({ id: 'guide_1', axis: 'x', position: 64 })];
    const doc = applyCommand(document(), {
      type: 'page.update',
      pageId: 'page_1',
      patch: { guides },
    }).document;

    const moved = [createGuide({ id: 'guide_1', axis: 'x', position: 128 })];
    const applied = applyCommand(doc, {
      type: 'page.update',
      pageId: 'page_1',
      patch: { guides: moved },
    });
    expect(applied.document.pages[0]?.guides).toEqual(moved);
    const undone = applied.inverse.reduce(
      (current, command) => applyCommand(current, command).document,
      applied.document,
    );
    expect(undone.pages[0]?.guides).toEqual(guides);
  });
});
