/**
 * Design IR 标识符。
 *
 * 设计：id 一律为**纯字符串**——Design IR 要能整体 JSON 往返（本地优先、可 Git diff），
 * 品牌化类型会在反序列化与夹具书写处引入无谓的强制转换，故用别名而非 branded type。
 * 生成器可注入（`IdFactory`）：用户、AI、导入器等五类 actor 在事务层等价，
 * 确定性 id 生成让这些 actor 的事务可复现、可断言。
 */

/** 文档 id。 */
export type DocumentId = string;

/** 页面 id。 */
export type PageId = string;

/** 节点 id。 */
export type NodeId = string;

/** 主组件 id（即主组件节点的 id；变体同属一个组件集）。 */
export type ComponentId = string;

/** id 生成器：按前缀取下一个 id。 */
export interface IdFactory {
  next(prefix: string): string;
}

/**
 * 确定性 id 工厂：`${prefix}_${seed}`、`${prefix}_${seed + 1}`…
 * 测试、夹具与快照回归用它保证「同一操作序列 → 同一结果」。
 */
export function createIdFactory(seed = 1): IdFactory {
  let counter = seed;
  return {
    next(prefix: string): string {
      const id = `${prefix}_${counter}`;
      counter += 1;
      return id;
    },
  };
}

/** 会话内单调递增计数，避免同一进程内因随机数碰撞产生重复 id。 */
let systemCounter = 0;

/**
 * 系统 id 工厂：`${prefix}_${递增计数}${随机后缀}`。
 * 随机后缀用于跨会话（重开应用、导入他人文档）时避免碰撞。
 */
export const systemIdFactory: IdFactory = {
  next(prefix: string): string {
    systemCounter += 1;
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${systemCounter.toString(36)}${random}`;
  },
};

/** 页面节点的 id 前缀约定（仅用于生成，不参与校验）。 */
export const ID_PREFIX = {
  document: 'doc',
  page: 'page',
  node: 'n',
  frame: 'frame',
  group: 'group',
  component: 'comp',
  componentSet: 'cset',
  instance: 'inst',
} as const;
