/**
 * 面板会话 —— 图层面板 / 资产面板与引擎的**唯一接缝**。
 *
 * 组装三件事（口径见 briefs/fe-04.md §2）：
 * 1. `CommandStack`：文档真值 + **写操作唯一入口**——面板不直接改文档对象，一切变更表达为命令；
 * 2. `PanelsUiStore`：选择集与面板 UI 态（画布 FE-06 与面板同源读这里）；
 * 3. 稳定引用的 `subscribe` / `getSnapshot`：直接喂 `useSyncExternalStore`（文档不进 React state）。
 *
 * 壳层（FE-03）可以自建命令栈后注入（`document` 选项），面板只消费；不注入则新建一个空文档会话，
 * 使面板可独立开发与测试。
 */
import {
  type Command,
  CommandStack,
  createDocument,
  type DesignDocument,
  getPage,
  type PageId,
  type ScenePage,
} from '@dforge/engine';

import { createPanelsUiStore, type PanelsUiStore } from './state/panels-store';

/** 会话构造选项。 */
export interface PanelsSessionOptions {
  /** 现成文档（壳层加载的文档）；省略则新建空文档。 */
  document?: DesignDocument;
  /** 当前页面 id（省略取文档首页）。 */
  pageId?: PageId;
  /** 是否深冻结每份产出的文档（测试/调试开：逮住绕过命令栈的就地写入）。 */
  freeze?: boolean;
  /** 历史栈上限（撤销/重做）。 */
  historyLimit?: number;
}

/** 面板会话：命令栈 + UI store + React 接缝。 */
export interface PanelsSession {
  /** 文档真值与唯一写入口。 */
  readonly stack: CommandStack;
  /** 面板 UI 态（选择集/展开收起/重命名目标/资产分段与搜索词）。 */
  readonly ui: PanelsUiStore;
  /** 当前页面 id（P0 单页面；多页面切换归 FE-03 壳层）。 */
  readonly pageId: PageId;
  /** 当前文档快照（`useSyncExternalStore` 的取值函数；引用稳定）。 */
  readonly getSnapshot: () => DesignDocument;
  /** 文档变更订阅（引用稳定；返回退订函数）。 */
  readonly subscribe: (listener: (document: DesignDocument) => void) => () => void;
  /** 读当前页面（只读快照：命令栈是唯一写入口）。 */
  readonly page: () => ScenePage;
  /**
   * 施加命令（唯一写入口的薄包装）。
   * 空命令列表视作无操作：不写历史、不通知订阅者——避免「点了但什么也没发生」也进撤销栈。
   */
  readonly run: (commands: Command | readonly Command[], label: string) => void;
}

/** 创建面板会话。 */
export function createPanelsSession(options: PanelsSessionOptions = {}): PanelsSession {
  const document = options.document ?? emptyDocument();
  const stackOptions: { freeze?: boolean; historyLimit?: number } = {};
  if (options.freeze !== undefined) stackOptions.freeze = options.freeze;
  if (options.historyLimit !== undefined) stackOptions.historyLimit = options.historyLimit;
  const stack = new CommandStack(document, stackOptions);

  const pageId = options.pageId ?? (stack.document.pages[0]?.id as PageId);
  const ui = createPanelsUiStore();

  return {
    stack,
    ui,
    pageId,
    getSnapshot: () => stack.getSnapshot(),
    subscribe: (listener) => stack.subscribe(listener),
    page: () => getPage(stack.document, pageId),
    run: (commands, label) => {
      const list = Array.isArray(commands)
        ? (commands as readonly Command[])
        : [commands as Command];
      if (list.length === 0) return;
      stack.dispatch(list, { label });
    },
  };
}

/** 空文档（一个空页面），供面板独立运行与测试——形状归引擎构造器，本层不复制默认值。 */
function emptyDocument(): DesignDocument {
  return createDocument({ id: 'doc-panels' });
}
