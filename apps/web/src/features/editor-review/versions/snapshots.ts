/**
 * 版本快照与对比（C14/F10）——纯函数，不碰 DOM。
 *
 * 快照语义（briefs/fe-07.md §1）：**文档 JSON 整体**（Design IR），不是 diff；
 * 回滚 = 引擎 `document.replace` 整文档替换命令（`restoreCommands` 产出，命令栈施加 → 可撤销）。
 * 对比语义（F10 第一步）：以**当前文档为基准**给出逐页差异与节点增删改计数，
 * 供并排对比视图展示「这一版和现在差在哪」。
 */
import { type Command, countNodes, type DesignDocument, type ScenePage } from '@dforge/engine';

/** 一份版本快照（文档 JSON + 元数据；时间戳列表的条目）。 */
export interface VersionSnapshot {
  id: string;
  documentId: string;
  label: string;
  /** ISO 8601 时间戳（列表显示与排序）。 */
  createdAt: string;
  /** 文档完整 JSON（opaque 语义上不透明，替换前由引擎命令校验自洽）。 */
  document: DesignDocument;
}

/** 建快照的入参。 */
export interface NewSnapshotInit {
  id: string;
  label?: string;
  createdAt: string;
  document: DesignDocument;
  /** 默认取 `document.id`（快照归属的文档）。 */
  documentId?: string;
}

/** 建快照（深拷贝文档：快照必须是**当时那一刻**的冻结事实，不能被后续编辑影响）。 */
export function createSnapshot(init: NewSnapshotInit): VersionSnapshot {
  return {
    id: init.id,
    documentId: init.documentId ?? init.document.id,
    label: init.label ?? '手动保存',
    createdAt: init.createdAt,
    document: cloneViaJson(init.document),
  };
}

/** 快照摘要（对比面板头部/列表条目用）。 */
export function snapshotSummary(snapshot: VersionSnapshot): { pages: number; nodes: number } {
  return documentSummary(snapshot.document);
}

/** 文档摘要（页数 + 全部页面的节点计数）。 */
export function documentSummary(doc: DesignDocument): { pages: number; nodes: number } {
  return {
    pages: doc.pages.length,
    nodes: doc.pages.reduce((total, page) => total + countNodes(page), 0),
  };
}

/** 新→旧排序（同时刻按 id 稳定兜底，避免列表在两帧之间抖动）。 */
export function sortSnapshots(list: readonly VersionSnapshot[]): VersionSnapshot[] {
  return [...list].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 追加一份快照并保持新→旧；同 id 覆盖（重存同一版本不产生重复条目）。 */
export function appendSnapshot(
  list: readonly VersionSnapshot[],
  snapshot: VersionSnapshot,
): VersionSnapshot[] {
  const next = list.filter((item) => item.id !== snapshot.id);
  next.push(snapshot);
  return sortSnapshots(next);
}

/** 单页差异条目（对比视图逐页列表）。 */
export interface PageDiffEntry {
  pageId: string;
  /** 当前文档里的页名（已删除页取快照里的名字）。 */
  name: string;
  status: 'unchanged' | 'changed' | 'added' | 'removed';
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
}

/** 文档级差异（以当前文档为基准；快照独有 = removed，当前独有 = added）。 */
export interface DocumentDiff {
  /** 是否有任何差异（对比视图的「无差异」空态判据）。 */
  changed: boolean;
  pages: PageDiffEntry[];
  nameChanged: boolean;
  tokensChanged: boolean;
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
}

/** 逐页差异 + 文档级标记。 */
export function diffDocuments(snapshotDoc: DesignDocument, current: DesignDocument): DocumentDiff {
  const pages: PageDiffEntry[] = [];
  const currentByPage = new Map(current.pages.map((page) => [page.id, page]));
  const snapshotByPage = new Map(snapshotDoc.pages.map((page) => [page.id, page]));

  for (const page of current.pages) {
    const base = snapshotByPage.get(page.id);
    if (base === undefined) {
      const count = countNodes(page);
      pages.push({
        pageId: page.id,
        name: page.name,
        status: 'added',
        nodesAdded: count,
        nodesRemoved: 0,
        nodesChanged: 0,
      });
      continue;
    }
    pages.push(diffPage(base, page));
  }

  for (const page of snapshotDoc.pages) {
    if (currentByPage.has(page.id)) continue;
    pages.push({
      pageId: page.id,
      name: page.name,
      status: 'removed',
      nodesAdded: 0,
      nodesRemoved: countNodes(page),
      nodesChanged: 0,
    });
  }

  const totals = pages.reduce(
    (acc, page) => ({
      nodesAdded: acc.nodesAdded + page.nodesAdded,
      nodesRemoved: acc.nodesRemoved + page.nodesRemoved,
      nodesChanged: acc.nodesChanged + page.nodesChanged,
    }),
    { nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0 },
  );
  const nameChanged = snapshotDoc.name !== current.name;
  const tokensChanged = !sameJson(snapshotDoc.tokens, current.tokens);

  return {
    changed: nameChanged || tokensChanged || pages.some((page) => page.status !== 'unchanged'),
    pages,
    nameChanged,
    tokensChanged,
    ...totals,
  };
}

/** 单页差异：节点集合 + 逐节点 JSON 相等性。 */
function diffPage(base: ScenePage, current: ScenePage): PageDiffEntry {
  const currentIds = Object.keys(current.nodes);
  const baseIds = Object.keys(base.nodes);
  let nodesAdded = 0;
  let nodesRemoved = 0;
  let nodesChanged = 0;
  const currentSet = new Set(currentIds);
  const baseSet = new Set(baseIds);
  for (const id of currentIds) {
    if (!baseSet.has(id)) {
      nodesAdded += 1;
      continue;
    }
    if (!sameJson(base.nodes[id], current.nodes[id])) nodesChanged += 1;
  }
  for (const id of baseIds) {
    if (!currentSet.has(id)) nodesRemoved += 1;
  }
  // 页面设置（背景/网格/名称/顶层顺序）变化也算该页 changed，即使节点表逐条相同
  const pageSettingsChanged =
    base.name !== current.name ||
    base.backgroundColor !== current.backgroundColor ||
    !sameJson(base.grid, current.grid) ||
    !sameJson(base.rootIds, current.rootIds);
  const status =
    nodesAdded > 0 || nodesRemoved > 0 || nodesChanged > 0 || pageSettingsChanged
      ? 'changed'
      : 'unchanged';
  return { pageId: current.id, name: current.name, status, nodesAdded, nodesRemoved, nodesChanged };
}

/** 回滚命令：整文档替换（`@dforge/engine`，唯一写入口；施加前引擎会校验快照自洽）。 */
export function restoreCommands(snapshot: VersionSnapshot): Command[] {
  return [{ type: 'document.replace', document: snapshot.document }];
}

/** JSON 深比较（快照是 JSON 往返产物，键序稳定，见引擎 `serialize/` 口径）。 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** JSON 深拷贝（快照与当前文档解耦）。 */
function cloneViaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
