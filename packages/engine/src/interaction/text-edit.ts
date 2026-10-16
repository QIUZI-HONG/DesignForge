/**
 * 文本内联编辑会话（C10：双击进入、世界坐标覆盖层、失焦提交）。
 *
 * 分工：DOM 覆盖层（定位/输入法/光标绘制）归 FE-06；本模块负责**编辑会话的数据与操作**，
 * 保证编辑过程可撤销：整个会话在提交时产出**一条** `node.update` 命令（一次撤销回退整段编辑）。
 */

import type { Command } from '../commands/types';
import type { NodeId, PageId, ScenePage, TextContent, TextSelection } from '../model/index';
import { deleteTextRange, normalizeSelection, replaceTextRange } from '../model/index';
import { domainError } from '../scene/errors';
import { resolveNode } from '../scene/query';

/** 文本编辑会话。 */
export interface TextEditSession {
  pageId: PageId;
  nodeId: NodeId;
  /** 编辑中的内容（未提交）。 */
  content: TextContent;
  /** 编辑前的原始内容（取消时丢弃会话即可，无需回滚文档）。 */
  original: TextContent;
  selection: TextSelection;
}

/** 进入文本编辑（双击文本节点 / 双击创建）。 */
export function beginTextEdit(
  page: ScenePage,
  pageId: PageId,
  nodeId: NodeId,
  options: { selectAll?: boolean } = {},
): TextEditSession {
  const node = resolveNode(page, nodeId);
  if (!node) throw domainError('node-not-found', `节点不存在：${nodeId}`);
  if (node.type !== 'text') throw domainError('invalid-argument', `节点不是文本：${nodeId}`);
  const selection: TextSelection = options.selectAll
    ? { start: 0, end: node.text.characters.length }
    : { start: node.text.characters.length, end: node.text.characters.length };
  return { pageId, nodeId, content: node.text, original: node.text, selection };
}

/** 设置选区（点击/拖选/全选）。 */
export function setTextSelection(
  session: TextEditSession,
  selection: TextSelection,
): TextEditSession {
  return { ...session, selection: normalizeSelection(session.content.characters, selection) };
}

/** 在光标处插入文本（输入法上屏、粘贴）。 */
export function insertText(session: TextEditSession, text: string | TextContent): TextEditSession {
  if (typeof text !== 'string') {
    // 整段替换（粘贴富文本时保留排版属性）
    return {
      ...session,
      content: text,
      selection: { start: text.characters.length, end: text.characters.length },
    };
  }
  const content = replaceTextRange(session.content, session.selection, text);
  const caret = session.selection.start + text.length;
  return { ...session, content, selection: { start: caret, end: caret } };
}

/** 退格（选区非空则删除选区）。 */
export function backspace(session: TextEditSession): TextEditSession {
  const { content, selection } = deleteTextRange(session.content, session.selection);
  return { ...session, content, selection };
}

/** 前向删除。 */
export function deleteForward(session: TextEditSession): TextEditSession {
  const { start, end } = normalizeSelection(session.content.characters, session.selection);
  if (start === end) {
    const next = replaceTextRange(session.content, { start, end: start + 1 }, '');
    return { ...session, content: next, selection: { start, end: start } };
  }
  const next = replaceTextRange(session.content, { start, end }, '');
  return { ...session, content: next, selection: { start, end: start } };
}

/** 全选。 */
export function selectAllText(session: TextEditSession): TextEditSession {
  return { ...session, selection: { start: 0, end: session.content.characters.length } };
}

/** 修改排版属性（字号/对齐等，Inspector 与编辑会话共用）。 */
export function patchTextContent(
  session: TextEditSession,
  patch: Partial<TextContent>,
): TextEditSession {
  return { ...session, content: { ...session.content, ...patch } };
}

/** 提交（失焦/回车）：产出单条命令；无变化返回空数组。 */
export function commitTextEdit(session: TextEditSession): Command[] {
  if (
    session.content.characters === session.original.characters &&
    isSamePatch(session.content, session.original)
  ) {
    return [];
  }
  return [
    {
      type: 'node.update',
      pageId: session.pageId,
      nodeId: session.nodeId,
      patch: { text: session.content },
    },
  ];
}

/** 取消（Esc）：丢弃会话（文档从未被写入，无需补偿）。 */
export function cancelTextEdit(session: TextEditSession): TextContent {
  return session.original;
}

function isSamePatch(a: TextContent, b: TextContent): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.fontWeight === b.fontWeight &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.align === b.align &&
    a.autoResize === b.autoResize
  );
}
