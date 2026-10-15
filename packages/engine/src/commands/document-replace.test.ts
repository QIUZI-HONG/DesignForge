/**
 * `document.replace`（整文档替换命令）——版本回滚的唯一写路径（FE-07 F10）。
 *
 * 断言口径（外部行为）：替换后文档逐字段等于快照、撤销回到替换前、非法快照整体不生效。
 */
import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { insertNode } from '../scene/index';
import { CommandError, CommandStack } from './stack';

/** 两个形状不同的文档：d1（一页 + 一个画板）与 d2（两页 + 一个矩形）。 */
function docA(): DesignDocument {
  let doc = createDocument({ id: 'doc-a', name: '文档 A', pages: [createPage({ id: 'pa' })] });
  doc = insertNode(doc, 'pa', createFrame({ id: 'fa', width: 100, height: 100 }), null);
  return doc;
}

function docB(): DesignDocument {
  let doc = createDocument({
    id: 'doc-b',
    name: '文档 B',
    pages: [createPage({ id: 'pb1' }), createPage({ id: 'pb2' })],
  });
  doc = insertNode(doc, 'pb2', createRect({ id: 'rb', x: 5, y: 5, width: 30, height: 30 }), null);
  return doc;
}

/** 深比较用的纯 JSON 形状。 */
function plain(doc: DesignDocument): unknown {
  return JSON.parse(JSON.stringify(doc));
}

describe('document.replace（整文档替换）', () => {
  it('替换后文档逐字段等于快照', () => {
    const stack = new CommandStack(docA());
    stack.dispatch({ type: 'document.replace', document: docB() });
    expect(plain(stack.document)).toEqual(plain(docB()));
  });

  it('撤销回到替换前的文档，重做再次替换', () => {
    const stack = new CommandStack(docA());
    const before = plain(stack.document);
    stack.dispatch({ type: 'document.replace', document: docB() });
    expect(stack.undo()).toBe(true);
    expect(plain(stack.document)).toEqual(before);
    expect(stack.redo()).toBe(true);
    expect(plain(stack.document)).toEqual(plain(docB()));
  });

  it('非法快照（无页面）抛命令错误且文档整体不变', () => {
    const stack = new CommandStack(docA());
    const before = plain(stack.document);
    const invalid = { ...docB(), pages: [] } as DesignDocument;
    expect(() => stack.dispatch({ type: 'document.replace', document: invalid })).toThrow(
      CommandError,
    );
    expect(plain(stack.document)).toEqual(before);
    expect(stack.canUndo).toBe(false);
  });

  it('替换命令是纯数据（可序列化往返后仍可施加）', () => {
    const command = { type: 'document.replace' as const, document: docB() };
    const roundTripped = JSON.parse(JSON.stringify(command)) as typeof command;
    const stack = new CommandStack(docA());
    stack.dispatch(roundTripped);
    expect(plain(stack.document)).toEqual(plain(docB()));
  });
});
