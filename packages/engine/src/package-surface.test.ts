/**
 * 包对外面自检：消费方（FE-04 图层面板 / FE-05 Inspector / FE-06 画布）按名引用，
 * 子路径 `@dforge/engine/model` 与主入口 `@dforge/engine` 都必须可解析。
 *
 * 为什么值得留：这两个入口是跨票契约（briefs/_shared.md §2），
 * 任何 package.json 的 exports 改动都会在这里立刻变红。
 */

import {
  applyNodePatch,
  beginInteraction,
  CommandStack,
  commitInteraction,
  computeSnap,
  copyNodes,
  createPage,
  createSelection,
  createViewport,
  getPage,
  groupNodesCommands,
  hitTestPoint,
  IDLE,
  insertNode,
  layoutInputs,
  listComponents,
  marqueeSelect,
  parseDocument,
  pasteCommands,
  patchNodeCommands,
  resolveInstanceTree,
  resolveToken,
  SNAP_THRESHOLD_PX,
  selectionBounds,
  serializeDocument,
  worldBoundsOfNode,
  zoomAt,
} from '@dforge/engine';
import {
  createDocument,
  createFrame,
  createRect,
  type DesignDocument,
  type NodeId,
  type NodePatch,
  type SceneNode,
  type ScenePage,
} from '@dforge/engine/model';
import { describe, expect, it } from 'vitest';

describe('包对外面（跨票契约）', () => {
  it('主入口与 model 子路径均可解析，且 API 齐备', () => {
    let doc: DesignDocument = createDocument({ id: 'doc', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'r1', x: 10, y: 10, width: 20, height: 20 }),
      'f1',
    );
    const page: ScenePage = getPage(doc, 'p1');
    const node: SceneNode = page.nodes.r1 as SceneNode;
    const patch: NodePatch = { x: 5 };
    const nodeId: NodeId = 'r1';

    // 图层面板 / Inspector / 画布三条消费路径的代表性 API
    expect(hitTestPoint(page, { x: 15, y: 15 })?.id).toBe('r1');
    expect(marqueeSelect(page, { x: 0, y: 0, width: 50, height: 50 })).toContain('r1');
    expect(worldBoundsOfNode(page, nodeId)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(selectionBounds(page, createSelection([nodeId]))).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
    expect(applyNodePatch(node, patch).x).toBe(5);
    expect(SNAP_THRESHOLD_PX).toBe(6);
    expect(computeSnap({ x: 0, y: 0, width: 10, height: 10 }, []).dx).toBe(0);
    expect(createViewport(1, 0, 0).zoom).toBe(1);
    expect(zoomAt(createViewport(), 2, { x: 0, y: 0 }).zoom).toBe(2);
    expect(IDLE.kind).toBe('idle');
    expect(typeof beginInteraction).toBe('function');
    expect(typeof commitInteraction).toBe('function');
    expect(typeof groupNodesCommands).toBe('function');
    expect(typeof patchNodeCommands).toBe('function');
    expect(typeof copyNodes).toBe('function');
    expect(typeof pasteCommands).toBe('function');
    expect(typeof listComponents).toBe('function');
    expect(typeof layoutInputs).toBe('function');
    expect(typeof resolveToken).toBe('function');
    expect(typeof resolveInstanceTree).toBe('function');

    const stack = new CommandStack(doc);
    stack.dispatch(patchNodeCommands('p1', nodeId, patch));
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(5);
    expect(parseDocument(serializeDocument(stack.document)).document).toEqual(stack.document);
  });
});
