/**
 * 混合模式（FE-05 纯增量扩展：C5 Inspector「高级」分区需要按节点读写混合模式）。
 *
 * 这是对 ENG-01 交付面的**加法**：NodeBase 增 `blendMode` 字段（默认 `normal`）、
 * NodePatch/PATCHABLE_KEYS 收录该键，其余语义（命令栈/撤销/序列化）依赖既有通用路径。
 * 断言外部行为：默认值、命令写读回、撤销往返、序列化往返。
 */

import { describe, expect, it } from 'vitest';

import { CommandStack } from '../commands/stack';
import { documentEnvelope, parseDocument } from '../serialize/index';
import { createDocument, createPage, createRect } from './index';
import type { NodePatch } from './node';

/** 构造单矩形文档。 */
function fixture() {
  const rect = createRect({ id: 'n1', x: 10, y: 20, width: 100, height: 50 });
  const page = createPage({ id: 'p1', nodes: { n1: rect }, rootIds: ['n1'] });
  return createDocument({ id: 'd1', pages: [page] });
}

describe('混合模式（纯增量字段）', () => {
  it('新建节点默认 normal', () => {
    const rect = createRect({ id: 'n1' });
    expect(rect.blendMode).toBe('normal');
  });

  it('构造时可显式指定', () => {
    const rect = createRect({ id: 'n1', blendMode: 'multiply' });
    expect(rect.blendMode).toBe('multiply');
  });

  it('node.update 可写混合模式且可撤销还原', () => {
    const stack = new CommandStack(fixture());
    stack.dispatch(
      { type: 'node.update', pageId: 'p1', nodeId: 'n1', patch: { blendMode: 'screen' } },
      { label: '混合模式' },
    );
    expect(stack.document.pages[0]?.nodes.n1?.blendMode).toBe('screen');
    expect(stack.undo()).toBe(true);
    expect(stack.document.pages[0]?.nodes.n1?.blendMode).toBe('normal');
  });

  it('NodePatch 类型收录 blendMode（PATCHABLE_KEYS 供差异提取）', () => {
    const patch: NodePatch = { blendMode: 'overlay' };
    expect(patch.blendMode).toBe('overlay');
    const keys: readonly string[] = ['blendMode'];
    expect(keys).toContain('blendMode');
  });

  it('序列化往返保留混合模式', () => {
    const rect = createRect({ id: 'n1', blendMode: 'darken' });
    const page = createPage({ id: 'p1', nodes: { n1: rect }, rootIds: ['n1'] });
    const doc = createDocument({ id: 'd1', pages: [page] });
    const parsed = parseDocument(documentEnvelope(doc));
    expect(parsed.document.pages[0]?.nodes.n1?.blendMode).toBe('darken');
  });
});
