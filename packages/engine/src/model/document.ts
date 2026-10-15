/**
 * 文档与页面（Design IR 的顶层容器）。
 *
 * 不可变约定：所有写路径返回**新文档**，输入文档永不被修改
 * （命令栈在此之上提供唯一写入口与撤销/重做）。
 */

import type { GridSettings } from './grid';
import { defaultGridSettings } from './grid';
import type { DocumentId, NodeId, PageId } from './ids';
import type { SceneNode } from './node';
import type { TokenSet } from './tokens';
import { emptyTokenSet } from './tokens';

/** 页面：节点表（扁平）+ 顶层顺序 + 页面设置。 */
export interface ScenePage {
  id: PageId;
  name: string;
  /** 扁平节点表：`Map<nodeId, Node>` 的 JSON 形态（键序稳定，见 `serialize/`）。 */
  nodes: Record<NodeId, SceneNode>;
  /** 顶层节点 id，顺序 = 绘制顺序（**后者在上**）。 */
  rootIds: NodeId[];
  /** 画布底色（C7 画布设置）。 */
  backgroundColor: string;
  /** 网格设置（C7/C8）。 */
  grid: GridSettings;
}

/** 文档：页面序列 + 设计令牌。 */
export interface DesignDocument {
  id: DocumentId;
  name: string;
  pages: ScenePage[];
  /** 设计令牌（DTCG 子集）。 */
  tokens: TokenSet;
}

/** 构造页面。 */
export function createPage(init: {
  id: PageId;
  name?: string;
  nodes?: Record<NodeId, SceneNode>;
  rootIds?: NodeId[];
  backgroundColor?: string;
  grid?: GridSettings;
}): ScenePage {
  return {
    id: init.id,
    name: init.name ?? '页面 1',
    nodes: init.nodes ?? {},
    rootIds: init.rootIds ?? [],
    backgroundColor: init.backgroundColor ?? '#F5F5F5',
    grid: init.grid ?? defaultGridSettings(),
  };
}

/** 构造文档（默认带一个空页面，对齐 Figma 新建文件的心智）。 */
export function createDocument(init: {
  id: DocumentId;
  name?: string;
  pages?: ScenePage[];
  tokens?: TokenSet;
  /** 无页面时的默认页面 id（确定性测试可注入）。 */
  defaultPageId?: PageId;
}): DesignDocument {
  const pages = init.pages ?? [createPage({ id: init.defaultPageId ?? 'page_1', name: '页面 1' })];
  if (pages.length === 0) {
    throw new Error('文档至少需要一个页面');
  }
  return {
    id: init.id,
    name: init.name ?? '未命名文件',
    pages,
    tokens: init.tokens ?? emptyTokenSet(),
  };
}
