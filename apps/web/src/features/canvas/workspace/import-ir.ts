/**
 * 导入 IR → 灌引擎 store（两宿主共用的**单点实现**，audit-d03 · D-03）。
 *
 * 缺陷现场：`importIr` 在 `/editor` 恒回 `{"ok":false,"error":"未接入导入"}`——
 * `/_canvas` 取样页把「解析 IR → 文档桥本地替换」写在 `canvas-studio.tsx` 组件闭包里，
 * `/editor` 工作区的门禁句柄没有接这段（`sessionDebugHandle` 落到兜底桩）。
 *
 * 修法：把两页共用的编排下沉到本模块——解析 IR（引擎结构校验）→ 文档桥本地替换
 * （`adoptLocal`：换文档真值 + 清落盘身份），宿主只保留各自的提示面
 * （`/_canvas` 是 notice 文本，`/editor` 是画布 HUD）。两页同一实现，不再各自编排。
 *
 * 错误形态对齐既有 `{ok:false,error}` 信封（同 `DebugIoResult`）：
 * 解析失败给引擎领域错误原文（中文人话，如「文档内容不是合法 JSON」），界面提示
 * 由宿主经 i18n 包一层（见 `editor.import.failed`）；本模块自产的两条文案（无可用页面）
 * 也直接取自 i18n 目录（audit-d04 · D-10：zh-CN 唯一暴露，不硬编码中文字面量）。
 */
import { countNodes, parseDocument } from '@dforge/engine';

import { t } from '@/i18n';

import type { DocumentBridge } from './document-bridge';

/** 导入结果：成功给首页节点数（提示用），失败给原因原文。 */
export type ImportIrResult = { ok: true; nodes: number } | { ok: false; error: string };

/**
 * 导入一段 IR 文本并经文档桥替换当前会话文档。
 *
 * - 解析失败（非法 JSON / 结构校验不过 / 超深载荷）→ 引擎领域错误原文，会话保持原样；
 * - 文档无可用页面 → 不替换（防御分支：引擎解析已拒绝空页文档，桥再拒一次；
 *   文案键 `editor.load.noPages`，两宿主同源）；
 * - 成功 → `adoptLocal` 已换真值并清落盘身份（导入的是另一份内容，不写回上一份文档）。
 */
export function importIrIntoBridge(text: string, bridge: DocumentBridge): ImportIrResult {
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!bridge.adoptLocal(parsed.document)) {
    return { ok: false, error: t('editor.load.noPages') };
  }
  const firstPage = parsed.document.pages[0];
  return { ok: true, nodes: firstPage === undefined ? 0 : countNodes(firstPage) };
}
