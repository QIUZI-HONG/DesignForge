/**
 * 不变式测试（ENG-01 DoD：写操作唯一入口 / 撤销重做往返 / 事务失败回滚 / 序列化往返恒等）。
 *
 * 这些测试不针对某个功能，而是针对**内核自身的骨架约束**——
 * 任何后续改动只要破坏其中之一，这里必须变红。
 */

import { describe, expect, it } from 'vitest';
import { copyNodes, duplicateCommands, pasteCommands } from './clipboard/index';
import { CommandError, CommandStack, groupNodesCommands } from './commands/index';
import { autoLayoutCommands } from './layout/index';
import { createIdFactory } from './model/ids';
import {
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  defaultAutoLayout,
} from './model/index';
import { getPage, insertNode, insertNodes, requireNode, validateDocument } from './scene/index';
import { deepFreezeDocument } from './scene/validate';
import { alignCommands, distributeCommands } from './selection/index';
import { DESIGN_IR_VERSION, parseDocument, serializeDocument } from './serialize/index';

/** 一份能覆盖多数写法路径的文档。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 300, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 40, height: 40 }),
      createRect({ id: 'r2', x: 80, y: 10, width: 40, height: 40 }),
      createText({ id: 'tx1', x: 0, y: 260, width: 100, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', x: 400, y: 0, width: 100, height: 60 }),
    null,
  );
  doc = insertNode(doc, 'p1', createRect({ id: 'cc1', x: 10, y: 10, width: 50, height: 20 }), 'c1');
  doc = insertNode(
    doc,
    'p1',
    createInstance({ id: 'i1', componentId: 'c1', x: 400, y: 100 }),
    null,
  );
  return doc;
}

/** 一条覆盖多类写操作的操作脚本（全部经命令栈）。 */
function scriptedOperations(doc: DesignDocument): { commands: unknown[] } {
  const page = getPage(doc, 'p1');
  const commands = [
    ...groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1', ids: createIdFactory(11) }),
    {
      type: 'node.update',
      pageId: 'p1',
      nodeId: 'tx1',
      patch: { text: { ...(page.nodes.tx1 as { text: object }).text, characters: '文本' } },
    },
    { type: 'node.move', pageId: 'p1', nodeIds: ['g1'], dx: 12, dy: 6 },
    { type: 'node.reorder', pageId: 'p1', nodeId: 'g1', op: 'front' },
    {
      type: 'instance.setOverride',
      pageId: 'p1',
      instanceId: 'i1',
      path: ['cc1'],
      patch: { width: 77 },
    },
  ];
  return { commands };
}

describe('不变式 · 写操作唯一入口', () => {
  it('文档只能经命令栈变更：栈外文档是只读快照（深冻结即写入即抛错）', () => {
    const stack = new CommandStack(deepFreezeDocument(baseDoc()), { freeze: true });
    const before = stack.document;
    expect(() => {
      (getPage(before, 'p1').nodes.r1 as { x: number }).x = 999;
    }).toThrow(TypeError);
    const after = stack.dispatch({
      type: 'node.update',
      pageId: 'p1',
      nodeId: 'r1',
      patch: { x: 7 },
    });
    expect(getPage(before, 'p1').nodes.r1?.x).toBe(10); // 旧快照不被改动
    expect(getPage(after, 'p1').nodes.r1?.x).toBe(7);
  });

  it('场景层写函数是纯函数：原文档逐字段不变', () => {
    const doc = baseDoc();
    const snapshot = JSON.parse(JSON.stringify(doc)) as unknown;
    const stack = new CommandStack(doc);
    stack.dispatch({ type: 'node.remove', pageId: 'p1', nodeId: 'f1' });
    stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['i1'], dx: 5, dy: 5 });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(snapshot);
  });

  it('每次写入后文档结构自洽（无悬空引用/多父/环）', () => {
    const stack = new CommandStack(baseDoc());
    for (const command of scriptedOperations(stack.document).commands as never[]) {
      stack.dispatch(command);
      expect(validateDocument(stack.document)).toEqual([]);
    }
    stack.undo();
    expect(validateDocument(stack.document)).toEqual([]);
  });
});

describe('不变式 · 撤销/重做往返恒等', () => {
  it('逐条撤销回到初始文档，逐条重做回到终态（逐字段相等）', () => {
    const stack = new CommandStack(baseDoc());
    const initial = JSON.parse(JSON.stringify(stack.document));
    const commands = scriptedOperations(stack.document).commands as never[];
    for (const command of commands) stack.dispatch(command);
    const final = JSON.parse(JSON.stringify(stack.document));

    for (let index = 0; index < commands.length; index += 1) {
      expect(stack.undo()).toBe(true);
    }
    expect(stack.undo()).toBe(false);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(initial);

    for (let index = 0; index < commands.length; index += 1) {
      expect(stack.redo()).toBe(true);
    }
    expect(stack.redo()).toBe(false);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(final);
  });

  it('复合操作（编组/解组/粘贴/副本/对齐/分布）逐项满足往返恒等', () => {
    const cases: Array<(doc: DesignDocument) => unknown[]> = [
      (doc) =>
        groupNodesCommands(getPage(doc, 'p1'), 'p1', ['r1', 'r2'], {
          groupId: 'g9',
          ids: createIdFactory(3),
        }),
      (doc) => alignCommands(getPage(doc, 'p1'), 'p1', ['r1', 'r2'], 'left'),
      (doc) => distributeCommands(getPage(doc, 'p1'), 'p1', ['r1', 'r2', 'tx1'], 'horizontal'),
      (doc) =>
        pasteCommands(copyNodes(getPage(doc, 'p1'), 'p1', ['f1']), {
          pageId: 'p1',
          ids: createIdFactory(7),
        }),
      (doc) => duplicateCommands(getPage(doc, 'p1'), 'p1', ['i1'], { ids: createIdFactory(9) }),
      () => [{ type: 'node.remove', pageId: 'p1', nodeId: 'c1' }],
      () => [{ type: 'document.rename', name: '新名字' }],
    ];
    for (const build of cases) {
      const stack = new CommandStack(baseDoc());
      const initial = JSON.parse(JSON.stringify(stack.document));
      const commands = build(stack.document) as never[];
      if (commands.length === 0) continue;
      stack.dispatch(commands);
      const applied = JSON.parse(JSON.stringify(stack.document));
      expect(applied).not.toEqual(initial);
      stack.undo();
      expect(JSON.parse(JSON.stringify(stack.document))).toEqual(initial);
      stack.redo();
      expect(JSON.parse(JSON.stringify(stack.document))).toEqual(applied);
    }
  });

  it('历史栈上限生效且不破坏文档', () => {
    const stack = new CommandStack(baseDoc(), { historyLimit: 3 });
    for (let index = 0; index < 10; index += 1) {
      stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 0 });
    }
    expect(stack.history().undo).toHaveLength(3);
    while (stack.undo()) {
      // 一路撤销
    }
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(17); // 10 - 3 次可回退
  });
});

describe('不变式 · 事务失败回滚', () => {
  it('事务内任一命令失败 → 文档逐字段不变、历史不增长', () => {
    const stack = new CommandStack(baseDoc());
    const before = JSON.parse(JSON.stringify(stack.document));
    let caught: unknown = null;
    try {
      stack.dispatch([
        { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 10, dy: 0 },
        { type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CommandError);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.canUndo).toBe(false);
  });

  it('错误携带可判别错误码与失败位置', () => {
    const stack = new CommandStack(baseDoc());
    try {
      stack.dispatch([
        { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 0 },
        { type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } },
      ]);
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as CommandError).code).toBe('node-not-found');
      expect((error as CommandError).commandIndex).toBe(1);
    }
  });
});

describe('不变式 · 序列化往返恒等', () => {
  it('任意操作序列之后，文档仍可幂等往返（serialize → parse → serialize 逐字节一致）', () => {
    const stack = new CommandStack(baseDoc());
    for (const command of scriptedOperations(stack.document).commands as never[]) {
      stack.dispatch(command);
    }
    const once = serializeDocument(stack.document);
    const parsed = parseDocument(once).document;
    expect(parsed).toEqual(stack.document);
    expect(serializeDocument(parsed)).toBe(once);
  });
});

describe('不变式 · 微任务结算不破坏事务语义', () => {
  it('连续 enqueue 合并为单条历史，失败不产生半成品', async () => {
    const stack = new CommandStack(baseDoc());
    const before = JSON.parse(JSON.stringify(stack.document));
    stack.enqueue({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 3, dy: 0 });
    stack.enqueue({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 4, dy: 0 });
    await Promise.resolve();
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(17);
    expect(stack.history().undo).toHaveLength(1);

    stack.enqueue({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 5, dy: 0 });
    stack.enqueue({ type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } });
    await Promise.resolve();
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(17); // 失败事务未生效
    expect(stack.history().undo).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(stack.document))).not.toEqual(before);
  });
});

/**
 * 不变式扩展（工单 11：自动布局主轴 fill）——新能力同样受四大骨架约束：
 * 写操作唯一入口 / 撤销重做往返 / 事务失败回滚 / 序列化往返恒等（且 `$version` 不变）。
 *
 * ⚠ 代码完成，测试待 dev 机执行（本机 Windows/WSL 无 node/pnpm）。
 */
describe('不变式 · 自动布局主轴 fill（工单 11）', () => {
  /** 水平固定容器 f1 + 自身声明 fill 的子画板 cf（fill 的文档承载 = 子画板自身 sizing）。 */
  function fillDoc(): DesignDocument {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'f1',
        x: 0,
        y: 0,
        width: 300,
        height: 100,
        autoLayout: {
          ...defaultAutoLayout('horizontal'),
          spacing: 0,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          widthSizing: 'fixed',
          heightSizing: 'fixed',
        },
      }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'cf',
        x: 8,
        y: 8,
        width: 100,
        height: 50,
        autoLayout: {
          ...defaultAutoLayout('horizontal'),
          spacing: 0,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          widthSizing: 'fill',
          heightSizing: 'fixed',
        },
      }),
      'f1',
    );
    return doc;
  }

  it('写操作唯一入口：fill 求解是纯函数，伸缩结果只经命令栈写入', () => {
    const doc = fillDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    const commands = autoLayoutCommands(getPage(doc, 'p1'), 'p1', 'f1');
    expect(commands).not.toHaveLength(0);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(snapshot); // 求解不改文档
    const stack = new CommandStack(doc);
    stack.dispatch(commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'cf')).toMatchObject({ width: 284 });
  });

  it('撤销/重做往返：fill 伸缩写入后逐字段回退与重放', () => {
    const stack = new CommandStack(fillDoc());
    const initial = JSON.parse(JSON.stringify(stack.document));
    stack.dispatch(autoLayoutCommands(getPage(stack.document, 'p1'), 'p1', 'f1'));
    const applied = JSON.parse(JSON.stringify(stack.document));
    expect(applied).not.toEqual(initial);
    expect(requireNode(getPage(stack.document, 'p1'), 'cf')).toMatchObject({ width: 284 });
    expect(stack.undo()).toBe(true);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(initial);
    expect(stack.redo()).toBe(true);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(applied);
  });

  it('事务失败回滚：fill 命令批中夹失败命令 → 文档逐字段不变、历史不增长', () => {
    const stack = new CommandStack(fillDoc());
    const before = JSON.parse(JSON.stringify(stack.document));
    let caught: unknown = null;
    try {
      stack.dispatch([
        ...autoLayoutCommands(getPage(stack.document, 'p1'), 'p1', 'f1'),
        { type: 'node.update', pageId: 'p1', nodeId: 'ghost', patch: { x: 1 } },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CommandError);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.canUndo).toBe(false);
  });

  it('序列化往返恒等：fill 配置文档幂等往返，$version 不变（纯行为能力，无格式变更）', () => {
    const stack = new CommandStack(fillDoc());
    stack.dispatch(autoLayoutCommands(getPage(stack.document, 'p1'), 'p1', 'f1'));
    const once = serializeDocument(stack.document);
    const parsed = parseDocument(once);
    expect(parsed.enveloped).toBe(true);
    expect(parsed.version).toBe(DESIGN_IR_VERSION);
    expect(DESIGN_IR_VERSION).toBe(1); // 版本不可变：本工单不引入格式变更
    expect(parsed.document).toEqual(stack.document);
    expect(serializeDocument(parsed.document)).toBe(once);
  });
});
