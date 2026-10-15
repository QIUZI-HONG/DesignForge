/**
 * 快照哈希回归（ENG-01 门禁）：固定文档夹具 + 固定操作序列 → 结果哈希。
 *
 * 为什么这样做：性能硬指标不在本票，但**行为稳定性**要在——
 * 几何/吸附/编组/覆盖的微小改动都可能悄悄改变结果坐标，
 * 用「同一操作序列 → 逐字节相同的文档 JSON → sha256」把它们钉住。
 *
 * 产物（随仓库提交，供审阅与 diff）：
 * - `packages/engine/__snapshots__/fixed-document.json`：操作后的文档（稳定键序）
 * - `packages/engine/__snapshots__/fixed-document.sha256`：该文档的 **规范哈希**
 *
 * 哈希口径：对「JSON 解析后按键名递归排序、无空白序列化」的字符串取 sha256——
 * 因此格式化工具（biome）重排该 JSON 文件不影响哈希，只有**语义变化**才会让它变红。
 * `scripts/verify-engine.mjs` 用自己实现的同一口径独立复算，不依赖本包序列化器。
 *
 * 更新方式：`UPDATE_SNAPSHOT=1 pnpm --filter @dforge/engine test`（有意变更时先看 diff）。
 * 快照缺失时自动生成并通过（首次落库）；存在但哈希不符 → 测试失败（行为漂移）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { copyNodes, duplicateCommands, pasteCommands } from './clipboard/index';
import {
  CommandStack,
  deleteNodesCommands,
  dissolveGroupCommands,
  groupNodesCommands,
} from './commands/index';
import { beginInteraction, commitInteraction, IDLE, updateInteraction } from './interaction/index';
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
  solidPaint,
} from './model/index';
import { getPage, insertNode, insertNodes, requireNode, validateDocument } from './scene/index';
import { alignCommands, distributeCommands } from './selection/index';
import { serializeDocument } from './serialize/index';
import { computeSnap } from './snap/index';

const SNAPSHOT_DIR = fileURLToPath(new URL('../__snapshots__/', import.meta.url));

/** 规范哈希：解析 → 递归键排序 → 无空白序列化 → sha256（与门禁脚本同口径）。 */
export function canonicalHash(json: string): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);
      return out;
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(JSON.parse(json))), 'utf8')
    .digest('hex');
}
const DOC_PATH = `${SNAPSHOT_DIR}fixed-document.json`;
const HASH_PATH = `${SNAPSHOT_DIR}fixed-document.sha256`;

/** 固定夹具：文档含画板、形状、文本、组件/实例与自动布局容器。 */
export function fixedFixture(): DesignDocument {
  let doc = createDocument({
    id: 'doc_fixed',
    name: 'ENG-01 回归夹具',
    pages: [createPage({ id: 'page_fixed', name: '主页面' })],
  });
  doc = insertNode(
    doc,
    'page_fixed',
    createFrame({ id: 'frame_root', x: 0, y: 0, width: 640, height: 420 }),
    null,
  );
  doc = insertNodes(
    doc,
    'page_fixed',
    [
      createRect({
        id: 'rect_a',
        x: 24,
        y: 24,
        width: 120,
        height: 64,
        fills: [solidPaint('#0D99FF')],
      }),
      createRect({ id: 'rect_b', x: 180, y: 24, width: 120, height: 64 }),
      createText({ id: 'text_a', x: 24, y: 120, width: 200, height: 24 }),
    ],
    'frame_root',
  );
  doc = insertNode(
    doc,
    'page_fixed',
    createFrame({
      id: 'frame_auto',
      x: 24,
      y: 180,
      width: 240,
      height: 120,
      autoLayout: defaultAutoLayout('vertical'),
    }),
    'frame_root',
  );
  doc = insertNodes(
    doc,
    'page_fixed',
    [
      createRect({ id: 'auto_1', x: 999, y: 999, width: 80, height: 32 }),
      createRect({ id: 'auto_2', x: 999, y: 999, width: 120, height: 32 }),
    ],
    'frame_auto',
  );
  doc = insertNode(
    doc,
    'page_fixed',
    createComponent({ id: 'comp_a', x: 400, y: 24, width: 160, height: 96 }),
    null,
  );
  doc = insertNodes(
    doc,
    'page_fixed',
    [
      createRect({ id: 'comp_child', x: 12, y: 12, width: 60, height: 24 }),
      createRect({ id: 'comp_child2', x: 12, y: 48, width: 60, height: 24 }),
    ],
    'comp_a',
  );
  doc = insertNode(
    doc,
    'page_fixed',
    createInstance({ id: 'inst_a', componentId: 'comp_a', x: 400, y: 160 }),
    null,
  );
  return doc;
}

/**
 * 固定操作序列：编组 → 移动（含吸附）→ 旋转 → 对齐 → 分布 → 自动布局 →
 * 覆盖 → 粘贴 → 副本 → 删一层再撤销 → 文本编辑。
 * 全部经命令栈（唯一写入口），并用确定性 id 工厂保证可复现。
 */
export function runFixedScript(): DesignDocument {
  const stack = new CommandStack(fixedFixture());
  const page = () => getPage(stack.document, 'page_fixed');

  // 1) 编组两个矩形
  stack.dispatch(
    groupNodesCommands(page(), 'page_fixed', ['rect_a', 'rect_b'], { groupId: 'group_ab' }),
  );

  // 2) 拖动（交互状态机 + 吸附）后提交
  const context = { page: page(), pageId: 'page_fixed', zoom: 1 } as const;
  let state = beginInteraction(
    IDLE,
    {
      type: 'pointer.down',
      point: { x: 200, y: 60 },
      screen: { x: 200, y: 60 },
      selection: ['group_ab'],
      clickTarget: 'group_ab',
      handle: null,
      tool: 'select',
    },
    context,
  );
  state = updateInteraction(
    state,
    { type: 'pointer.move', point: { x: 260, y: 100 }, screen: { x: 260, y: 100 } },
    context,
  );
  stack.dispatch(commitInteraction(state, context).commands);

  // 3) 旋转文本
  stack.dispatch({
    type: 'node.update',
    pageId: 'page_fixed',
    nodeId: 'text_a',
    patch: { rotation: 12 },
  });

  // 4) 对齐 + 分布（含自动布局容器内的两个矩形）
  stack.dispatch(
    alignCommands(page(), 'page_fixed', ['auto_1', 'auto_2'], 'left', { relativeTo: 'parent' }),
  );
  stack.dispatch(
    distributeCommands(page(), 'page_fixed', ['auto_1', 'auto_2'], 'vertical', { spacing: 8 }),
  );

  // 5) 自动布局求解（覆盖手改后的位置）
  stack.dispatch(autoLayoutCommands(page(), 'page_fixed', 'frame_auto'));

  // 6) 实例覆盖
  stack.dispatch({
    type: 'instance.setOverride',
    pageId: 'page_fixed',
    instanceId: 'inst_a',
    path: ['comp_child'],
    patch: { width: 96, fills: [solidPaint('#9747FF')] },
  });

  // 7) 复制粘贴（跨父级：粘贴到画板内）
  const payload = copyNodes(page(), 'page_fixed', ['inst_a']);
  stack.dispatch(
    pasteCommands(payload, {
      pageId: 'page_fixed',
      parentId: 'frame_root',
      ids: createIdFactory(1000),
    }),
  );

  // 8) 副本 + 删除 + 撤销（撤销后保留副本、恢复被删节点）
  stack.dispatch(
    duplicateCommands(page(), 'page_fixed', ['text_a'], { ids: createIdFactory(2000) }),
  );
  stack.dispatch(deleteNodesCommands(page(), 'page_fixed', ['auto_2']));
  stack.undo();

  // 9) 解散编组（回到起点结构，但位置已改）
  stack.dispatch(dissolveGroupCommands(page(), 'page_fixed', 'group_ab'));

  // 10) 文本最终内容
  const textNode = requireNode(page(), 'text_a');
  if (textNode.type === 'text') {
    stack.dispatch({
      type: 'node.update',
      pageId: 'page_fixed',
      nodeId: 'text_a',
      patch: { text: { ...textNode.text, characters: '设界 DesignForge' } },
    });
  }

  expect(validateDocument(stack.document)).toEqual([]);
  return stack.document;
}

/** 顺带覆盖吸附阈值边界与参考线（保证脚本里也钉住 6px 口径）。 */
describe('regression · 夹具自检', () => {
  it('吸附阈值闭区间：6.0px 吸、6.1px 不吸', () => {
    const moving = { x: 0, y: 0, width: 10, height: 10 };
    expect(
      computeSnap(moving, [{ id: 't', bounds: { x: 16, y: 0, width: 10, height: 10 } }]).dx,
    ).toBe(6);
    expect(
      computeSnap(moving, [{ id: 't', bounds: { x: 16.1, y: 0, width: 10, height: 10 } }]).dx,
    ).toBe(0);
  });
});

describe('regression · 固定操作序列 → 快照哈希', () => {
  it('结果文档哈希与 __snapshots__ 一致（行为漂移即失败）', () => {
    const json = serializeDocument(runFixedScript());
    const hash = canonicalHash(json);
    const update = process.env.UPDATE_SNAPSHOT === '1';

    if (update || !existsSync(HASH_PATH) || !existsSync(DOC_PATH)) {
      mkdirSync(dirname(HASH_PATH), { recursive: true });
      writeFileSync(DOC_PATH, json, 'utf8');
      writeFileSync(HASH_PATH, `${hash}\n`, 'utf8');
      return;
    }

    const expected = readFileSync(HASH_PATH, 'utf8').trim();
    // 存量产物也要能算出同一个规范哈希（格式化差异不影响）
    expect(canonicalHash(readFileSync(DOC_PATH, 'utf8'))).toBe(expected);
    expect(hash, '固定操作序列的结果漂移：请核对 diff 后用 UPDATE_SNAPSHOT=1 更新').toBe(expected);
  });

  it('操作序列是确定性的（两次执行逐字节一致）', () => {
    expect(serializeDocument(runFixedScript())).toBe(serializeDocument(runFixedScript()));
  });
});
