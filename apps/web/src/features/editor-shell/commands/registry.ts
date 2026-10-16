/**
 * 编辑器命令注册表（**FE-03 冻结接口 ①**，供 FE-06 / FE-07 / FE-08 消费）。
 *
 * 定位：命令面板（E7 清单）与快捷键说明（E8 清单）的**唯一真源**——两处都从本表派生，
 * 因此「某命令只在一处出现」这类漂移在结构上不可能发生。
 *
 * 冻结签名（`briefs/fe-03.md` §2，形状不得随意改；增补须在交付报告声明）：
 * - `Command`：id / title / group / shortcut? / enabled? / run；
 * - `CommandRegistry`：`register(cmd) → 反注册函数`、`list() → Command[]`；
 * - `commandRegistry`：全局单例；`registerCommand(cmd)`：便捷封装。
 *
 * 语义（消费方依赖这些约定，改动即破坏契约）：
 * - **同 id 后注册者覆盖前者（last wins），位置停在首次注册处**——热重载（改标题/改分组不炸）
 *   与「后续票接管默认实现」都靠这条：例如 FE-06 用同 id 注册真实缩放实现即接管默认实现；
 * - `list()` 返回**快照副本**（调用方改动不影响注册表内部）；
 * - `runCommand(id)`：未注册或 `enabled()` 判否 → 返回 `false` 且不执行（置灰命令不可运行）；
 *   命令抛错则**原样冒泡**（由调用方决定呈现：命令面板就地显示失败态）。
 *
 * 为什么用模块单例而不是 React Context：命令在**非 React** 路径上也要可达——引擎侧回调、
 * 门禁脚本注入、跨 feature 注册（FE-08 在自己的目录注册组件命令）。React 侧要订阅变化时
 * 用 `useCommandList()`（见 `./use-commands`）。
 */

/** 一条命令（界面层语义；与 `@dforge/engine` 的文档命令类型无关）。 */
export interface Command {
  /** 全局唯一 id（点号命名，如 `view.zoomIn`；同 id 后注册者覆盖前者）。 */
  id: string;
  /** 命令面板与快捷键表里的标题（文案由注册方给，注册表不做 i18n）。 */
  title: string;
  /** 分组名（命令面板分组与快捷键表分节的依据）。 */
  group: string;
  /** 展示用快捷键（如 `'⌘K'`）；全局快捷键派发也解析同一串（见 `../shortcuts/matching`）。 */
  shortcut?: string;
  /** 置灰判定：返回 false 时命令不可运行（面板置灰 + 键盘漫游跳过）。缺省视为可运行。 */
  enabled?: () => boolean;
  /** 置灰原因（入口的 tooltip/原因提示；缺省取标题）。 */
  disabledReason?: () => string;
  /**
   * 按下态（开关类入口：评论模式 / 演示）。声明后入口渲染 `aria-pressed` 与激活样式。
   * 未声明 = 非开关入口（不渲染 aria-pressed，避免给普通按钮发错误语义）。
   */
  pressed?: () => boolean;
  /** 按下态的入口文案（如「退出评论模式」）；缺省沿用入口自身文案。 */
  pressedTitle?: () => string;
  /**
   * 命令状态订阅（`enabled` / `pressed` / `disabledReason` 依赖外部状态时给出）：
   * 外部状态变化 → 通知入口重新取快照；**引用稳定**（注册表在注册时挂一次）。
   * @returns 退订函数
   */
  subscribe?: (notify: () => void) => () => void;
  /** 执行体（可为异步：调用方等其结算后再记「最近使用」）。 */
  run: () => void | Promise<void>;
}

/** 注册表对外接口（冻结）。 */
export interface CommandRegistry {
  /** 注册命令；返回反注册函数（幂等；仅当表内当前条目仍是本次注册的那条时才移除）。 */
  register(cmd: Command): () => void;
  /** 当前全部命令的快照（注册顺序；同 id 覆盖不改变位置）。 */
  list(): Command[];
}

/** 内部存储（对外只暴露冻结形状）。 */
interface CommandStore {
  register(cmd: Command): () => void;
  list(): Command[];
  /** 稳定引用的快照（仅在变化时换新对象）——`useSyncExternalStore` 的 getSnapshot 只能用它。 */
  getSnapshot(): Command[];
  get(id: string): Command | undefined;
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** 订阅「命令状态可能变化」（注册/反注册 + 各命令自己的 `subscribe` 通知）。 */
  subscribeStates(listener: () => void): () => void;
}

/** 建表（每次调用一份独立存储，便于测试）。 */
function createCommandStore(): CommandStore {
  // Map 的插入序即展示序：同 id 再次 set 不改变已占位置——「覆盖但不跳位」
  const entries = new Map<string, Command>();
  const listeners = new Set<() => void>();
  /** 入口状态订阅者（`enabled`/`pressed` 重算）；与命令表订阅者分开——文档高频变更时不该重渲染命令面板。 */
  const stateListeners = new Set<() => void>();
  /** 各已注册命令的 `subscribe` 退订函数（注册时挂、覆盖/移除时摘）。 */
  const detached = new Map<string, () => void>();
  // React 快照缓存：引用稳定是 useSyncExternalStore 的硬要求（每次返回新数组会无限重渲染）
  let cached: Command[] = [];

  const refresh = (): void => {
    cached = [...entries.values()];
    for (const listener of [...listeners]) listener();
    // 注册表变化同时影响入口状态（新命令注册/反注册）
    for (const listener of [...stateListeners]) listener();
  };

  /** 命令自己的状态通知：只通知入口订阅者（命令表本身没变）。 */
  const notifyStates = (): void => {
    for (const listener of [...stateListeners]) listener();
  };

  /** 摘掉某命令的状态订阅（覆盖注册与反注册都要摘，避免订阅泄漏/双份通知）。 */
  const detach = (id: string): void => {
    const unsubscribe = detached.get(id);
    if (unsubscribe === undefined) return;
    detached.delete(id);
    unsubscribe();
  };

  return {
    register(cmd: Command): () => void {
      // 同 id 覆盖：先摘旧订阅（否则两份通知、且旧订阅永不释放）
      detach(cmd.id);
      entries.set(cmd.id, cmd);
      if (cmd.subscribe !== undefined) detached.set(cmd.id, cmd.subscribe(notifyStates));
      refresh();
      return () => {
        // 只移除「本次注册的那条」：若期间有同 id 覆盖，反注册不得误删新实现
        if (entries.get(cmd.id) === cmd) {
          entries.delete(cmd.id);
          detach(cmd.id);
          refresh();
        }
      };
    },
    list(): Command[] {
      // 对外快照副本：调用方改动不影响注册表（getSnapshot 的稳定引用同理不被破坏）
      return [...cached];
    },
    getSnapshot(): Command[] {
      return cached;
    },
    get(id: string): Command | undefined {
      return entries.get(id);
    },
    clear(): void {
      for (const id of [...detached.keys()]) detach(id);
      if (entries.size === 0) return;
      entries.clear();
      refresh();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStates(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
}

const store = createCommandStore();

/** 全局命令注册表（单例）。 */
export const commandRegistry: CommandRegistry = {
  register: (cmd) => store.register(cmd),
  list: () => store.list(),
};

/** 便捷封装：等价 `commandRegistry.register(cmd)`。 */
export function registerCommand(cmd: Command): () => void {
  return commandRegistry.register(cmd);
}

/**
 * 订阅注册表变化（React 外部入口；组件内用 `useCommandList()`）。
 *
 * 为什么订阅入口是模块级函数而不是 `CommandRegistry` 的成员：冻结形状只有
 * `register` / `list` 两项，不给后续实现者增加实现负担。
 *
 * @returns 取消订阅函数
 */
export function subscribeCommands(listener: () => void): () => void {
  return store.subscribe(listener);
}

/**
 * 订阅「命令状态可能变化」——入口按钮（`useCommandEntry`）专用。
 *
 * 与 `subscribeCommands`（命令表本身）分开的原因：命令的 `enabled` / `pressed` 会随外部
 * 状态高频变化（画布文档每步编辑一次），如果走命令表订阅，命令面板与快捷键说明会跟着
 * 无谓重渲染；入口只需要「状态可能变了，重新取一次快照」，且取快照时做等值判定（不变不重渲染）。
 *
 * 通知来源：注册/反注册 + 各命令自报的 `subscribe`（如评论 store、文档订阅）。
 *
 * @returns 取消订阅函数
 */
export function subscribeCommandStates(listener: () => void): () => void {
  return store.subscribeStates(listener);
}

/** 按 id 取命令（未注册 → `undefined`）。 */
export function getCommand(id: string): Command | undefined {
  return store.get(id);
}

/**
 * 稳定引用的命令快照（`useSyncExternalStore` 专用；产品组件请走 `useCommandList()`）。
 *
 * 与 `list()` 的区别：本函数在两次变化之间返回**同一个数组引用**——React 的快照
 * 必须引用稳定，否则会判定「每次渲染都在变」并陷入重渲染循环。
 */
export function getCommandsSnapshot(): Command[] {
  return store.getSnapshot();
}

/**
 * 运行已注册命令。
 *
 * @returns 是否真的执行（未注册 / `enabled()` 判否 → `false`，不执行）
 */
export async function runCommand(id: string): Promise<boolean> {
  const command = store.get(id);
  if (command === undefined) return false;
  if (command.enabled?.() === false) return false;
  await command.run();
  return true;
}

/** 命令是否可运行（未注册 → false；注册且未置灰 → true）。 */
export function canRunCommand(id: string): boolean {
  const command = store.get(id);
  return command !== undefined && command.enabled?.() !== false;
}

/** 清空注册表（**测试隔离与热重载清理**用；产品路径不调用）。 */
export function resetCommandRegistry(): void {
  store.clear();
}
