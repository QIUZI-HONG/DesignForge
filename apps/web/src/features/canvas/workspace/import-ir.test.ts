// @vitest-environment jsdom
/**
 * 导入 IR → 灌引擎 store（audit-d03 · D-03）——两宿主共用实现的外部契约测试。
 *
 * 缺陷现场：`/editor` 的 `importIr` 恒回 `{"ok":false,"error":"未接入导入"}`——
 * 编排散在 `/_canvas` 组件闭包里，工作区没接。下沉到 `import-ir.ts` 后，本测试锁四条行为：
 * 1. 合法 IR：解析 → 文档桥本地替换（真值进共享命令栈、清落盘身份回「未保存」）；
 * 2. 非法 JSON / 结构非法：错误信封（引擎领域错误原文），会话文档保持原样；
 * 3. 桥拒绝采纳（无可用页面，防御分支）：错误信封，会话保持原样；
 * 4. 往返幂等：导出 → 导入同一份 IR，节点几何逐字段一致（J5 的判定口径）。
 */
import {
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  serializeDocument,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';

import { createDocumentsClient } from '../persistence/documents-client';
import { createDocumentBridge, type DocumentBridge } from './document-bridge';
import { importIrIntoBridge } from './import-ir';
import { createEditorWorkspace, EMPTY_PRESET } from './workspace-session';

/** 造一份含单个矩形的真实文档（引擎构造函数，不手抄形状）。 */
function documentWithRect(name: string) {
  const ids = createIdFactory(1);
  const rect = createRect({
    id: ids.next('n'),
    x: 40,
    y: 60,
    width: 120,
    height: 80,
    name: '矩形 1',
  });
  const page = createPage({
    id: 'page-1',
    rootIds: [rect.id],
    nodes: { [rect.id]: rect },
  });
  return createDocument({ id: 'doc-test', name, pages: [page] });
}

/** 真装配的工作区（client 不会被 adoptLocal 触及：基址指向不存在的端口即显式临时值）。 */
function workspaceWithBridge() {
  const workspace = createEditorWorkspace(EMPTY_PRESET, {
    client: createDocumentsClient({ baseUrl: 'http://127.0.0.1:1' }),
  });
  return workspace;
}

describe('importIrIntoBridge · 合法 IR 灌 store', () => {
  it('解析 → 本地替换：文档真值进共享命令栈，落盘身份清空回「未保存」', () => {
    const workspace = workspaceWithBridge();
    const source = documentWithRect('导入来源');
    const result = importIrIntoBridge(serializeDocument(source), workspace.documents);

    expect(result).toEqual({ ok: true, nodes: 1 });
    // 灌 store：共享命令栈的快照换成导入内容（首页节点数 + 文档名）
    const snapshot = workspace.panels.stack.getSnapshot();
    const firstPage = snapshot.pages[0];
    expect(firstPage === undefined ? 0 : Object.keys(firstPage.nodes).length).toBe(1);
    expect(snapshot.name).toBe('导入来源');
    // 本地替换清落盘身份：documentId → null、状态回「未保存」（导入内容不写回上一份文档）
    const state = workspace.documents.store.getState();
    expect(state.documentId).toBeNull();
    expect(state.status).toBe('dirty');
    expect(state.name).toBe('导入来源');
  });

  it('往返幂等：导出 → 导入同一份 IR，节点几何逐字段一致（J5 判定口径）', () => {
    const workspace = workspaceWithBridge();
    const source = documentWithRect('往返');
    const exported = serializeDocument(source);

    const first = importIrIntoBridge(exported, workspace.documents);
    expect(first.ok).toBe(true);
    const geometryBefore = workspace.panels.stack.getSnapshot().pages[0]?.rootIds ?? [];
    expect(geometryBefore.length).toBe(1);

    // 二次导入同一份 IR（刷新后导入的场景）：内容仍一致
    const second = importIrIntoBridge(exported, workspace.documents);
    expect(second).toEqual({ ok: true, nodes: 1 });
    const page = workspace.panels.stack.getSnapshot().pages[0];
    const node = page !== undefined ? page.nodes[page.rootIds[0] ?? ''] : undefined;
    expect(node).toBeDefined();
    expect(node?.x).toBe(40);
    expect(node?.y).toBe(60);
    expect(node?.width).toBe(120);
    expect(node?.height).toBe(80);
  });
});

describe('importIrIntoBridge · 坏 IR 错误路径', () => {
  it('非 JSON 文本 → 错误信封（引擎原文），会话文档保持原样', () => {
    const workspace = workspaceWithBridge();
    const before = workspace.panels.stack.getSnapshot();
    const result = importIrIntoBridge('{not json', workspace.documents);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('文档内容不是合法 JSON');
    // 会话未被破坏：文档还是装配时的内存占位
    const after = workspace.panels.stack.getSnapshot();
    expect(after.id).toBe(before.id);
    expect(after.pages.length).toBe(before.pages.length);
  });

  it('结构非法（缺页面）→ 错误信封（引擎原文），会话保持原样', () => {
    const workspace = workspaceWithBridge();
    const result = importIrIntoBridge(JSON.stringify({ pages: [] }), workspace.documents);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('文档缺少页面');
    expect(workspace.documents.store.getState().status).not.toBe('error');
  });

  it('桥拒绝采纳（无可用页面，防御分支）→ 错误信封，不替换', () => {
    let adoptCalls = 0;
    const bridge = {
      adoptLocal: () => {
        adoptCalls += 1;
        return false;
      },
    } as unknown as DocumentBridge;
    const source = documentWithRect('不会被采纳');
    const result = importIrIntoBridge(serializeDocument(source), bridge);

    expect(adoptCalls).toBe(1);
    expect(result).toEqual({ ok: false, error: '文档无可用页面' });
  });

  it('真桥 + 有页面的文档：adoptLocal 正常采纳（对照防御分支不误伤）', () => {
    const workspace = workspaceWithBridge();
    const bridge: DocumentBridge = workspace.documents;
    const source = documentWithRect('正常导入');
    const result = importIrIntoBridge(serializeDocument(source), bridge);
    expect(result.ok).toBe(true);
    expect(workspace.panels.stack.getSnapshot().name).toBe('正常导入');
  });
});

describe('importIrIntoBridge · 独立桥实例（/_canvas 宿主形态）', () => {
  it('studio 形态（独立文档桥）：同一实现可用，成功后桥投影换名', () => {
    const adopted: string[] = [];
    const bridge = createDocumentBridge({
      host: {
        document: () => documentWithRect('宿主当前'),
        adopt: (document) => {
          adopted.push(document.name);
          return true;
        },
        subscribe: () => () => undefined,
      },
      client: createDocumentsClient({ baseUrl: 'http://127.0.0.1:1' }),
      initial: { documentId: null, name: '宿主当前' },
    });
    const result = importIrIntoBridge(serializeDocument(documentWithRect('画布导入')), bridge);
    expect(result).toEqual({ ok: true, nodes: 1 });
    expect(adopted).toEqual(['画布导入']);
    expect(bridge.store.getState().name).toBe('画布导入');
  });
});
