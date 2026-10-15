/**
 * 右键菜单条目测试（seam：`layerContextMenu` 的可用性与命令）。
 *
 * 断言两件事：①哪些条目在什么选择下该置灰（含禁用原因键）；②可用条目的命令
 * 施加后确实产生预期的文档变更（编组/解组/层级/删除）。
 */
import {
  CommandStack,
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
  getChildrenIds,
  getNode,
  getPage,
  insertNode,
  insertNodes,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { layerContextMenu } from './layer-menu';

/** 夹具：f1 ⊃ [r1, r2, g1 ⊃ [t1]]；顶层 [f1, t2]。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 200, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', width: 50, height: 50 }),
      createRect({ id: 'r2', x: 70, width: 50, height: 50 }),
      createGroup({ id: 'g1', width: 40, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', width: 40, height: 20 }), 'g1');
  doc = insertNode(doc, 'p1', createRect({ id: 't2', x: 300, width: 20, height: 20 }), null);
  return doc;
}

const single = (id: string) => ({ ids: [id], activeId: id });

describe('图层右键菜单', () => {
  it('单选普通节点：重命名/删除可用；编组禁用（原因键）；解组禁用', () => {
    const page = getPage(baseDoc(), 'p1');
    const entries = layerContextMenu(page, 'p1', 'r1', single('r1'));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(byId.get('rename')?.disabled).toBe(false);
    expect(byId.get('delete')?.commands).toHaveLength(1);
    expect(byId.get('group')?.disabled).toBe(true);
    expect(byId.get('group')?.disabledReasonKey).toBe('panels.menu.groupDisabled');
    expect(byId.get('ungroup')?.disabled).toBe(true);
    // r1 在 f1.children 里位于最底（index 0）→ 下移到底不可用、上移到顶可用
    expect(byId.get('sendToBack')?.disabled).toBe(true);
    expect(byId.get('bringToFront')?.disabled).toBe(false);
  });

  it('两个同级节点 → 编组可用，命令施加后真实产生编组', () => {
    const stack = new CommandStack(baseDoc(), { freeze: true });
    const page = getPage(stack.document, 'p1');
    const selection = { ids: ['r1', 'r2'], activeId: 'r2' };
    const group = layerContextMenu(page, 'p1', 'r1', selection).find(
      (entry) => entry.id === 'group',
    );
    expect(group?.disabled).toBe(false);
    stack.dispatch(group?.commands ?? [], { label: '编组' });
    const f1 = getPage(stack.document, 'p1').nodes.f1;
    expect(f1 && f1.type === 'frame' ? f1.children.length : 0).toBe(2); // 编组 + g1
  });

  it('跨父级选择（r1 与 t1）→ 编组禁用', () => {
    const page = getPage(baseDoc(), 'p1');
    const entries = layerContextMenu(page, 'p1', 'r1', { ids: ['r1', 't1'], activeId: 'r1' });
    expect(entries.find((entry) => entry.id === 'group')?.disabled).toBe(true);
  });

  it('编组节点 → 解组可用，命令施加后组消失、子节点回到父级', () => {
    const stack = new CommandStack(baseDoc(), { freeze: true });
    const page = getPage(stack.document, 'p1');
    const ungroup = layerContextMenu(page, 'p1', 'g1', single('g1')).find(
      (entry) => entry.id === 'ungroup',
    );
    expect(ungroup?.disabled).toBe(false);
    stack.dispatch(ungroup?.commands ?? [], { label: '解组' });
    expect(getNode(getPage(stack.document, 'p1'), 'g1')).toBeUndefined();
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toContain('t1');
  });

  it('多选时删除：一次事务删掉整个选择集（撤回复原）', () => {
    const stack = new CommandStack(baseDoc(), { freeze: true });
    const page = getPage(stack.document, 'p1');
    const del = layerContextMenu(page, 'p1', 'r1', { ids: ['r1', 'r2'], activeId: 'r1' }).find(
      (entry) => entry.id === 'delete',
    );
    stack.dispatch(del?.commands ?? [], { label: '删除' });
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['g1']);
    expect(stack.undo()).toBe(true);
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['r1', 'r2', 'g1']);
  });

  it('实例虚节点：结构性动作全部禁用（属性覆盖走行内按钮，不走菜单）', () => {
    let doc = baseDoc();
    doc = insertNode(doc, 'p1', createComponent({ id: 'c1', x: 0, y: 300 }), null);
    doc = insertNode(doc, 'p1', createRect({ id: 'cr1', width: 30, height: 30 }), 'c1');
    doc = insertNode(doc, 'p1', createInstance({ id: 'inst1', componentId: 'c1' }), null);
    const page = getPage(doc, 'p1');
    const virtualId = 'inst1::cr1';
    const entries = layerContextMenu(page, 'p1', virtualId, single(virtualId));
    for (const entry of entries) {
      expect(entry.disabled, `${entry.id} 应禁用`).toBe(true);
      expect(entry.commands).toHaveLength(0);
    }
  });

  it('层级端位：f1 内最上层（g1）→ 上移到顶禁用、下移到底可用', () => {
    const page = getPage(baseDoc(), 'p1');
    const entries = layerContextMenu(page, 'p1', 'g1', single('g1'));
    expect(entries.find((entry) => entry.id === 'bringToFront')?.disabled).toBe(true);
    expect(entries.find((entry) => entry.id === 'sendToBack')?.disabled).toBe(false);
  });
});
