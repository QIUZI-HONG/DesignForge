/**
 * 浮层行为的共用实现（模态与抽屉同构：锁滚动、焦点入层、Esc、Tab 回环、关闭还原）。
 *
 * 为什么放在一起：F1（模态族）与 F2（抽屉族）只在视觉与入场动效上不同，
 * 可访问性契约完全一致；共用一个 hook 才不会两处跑偏。
 *
 * 嵌套浮层走**浮层栈（LIFO）**，且栈序即视觉层序：
 * - Esc 与遮罩点击只作用于栈顶（最内层），同一按键/点击不会波及外层；
 * - 焦点在最内层落定——嵌套同时挂载时内层效果先跑（子先于父），
 *   非栈顶层不得把焦点从内层夺回去；栈顶关闭后把焦点交接给新的栈顶；
 * - z 序由栈序推导（同一来源，避免「栈序与实际层序不一致」）；
 * - 滚动锁按**引用计数**归还：多个浮层并存只在最后一个归还时恢复原值，
 *   卸载/异常路径同样归还（关闭回调未被调用也不会把 body 永久锁死）。
 */
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getFocusableElements, trapTabKey } from './focus';

/**
 * 浮层嵌套深度上下文：根为 0，每个浮层把**自身深度**提供给子树。
 *
 * 为什么走 React 树而不是 DOM：浮层内容经 portal 落到 body，DOM 上彼此是兄弟，
 * 只有 React 树还保留嵌套关系（子浮层挂在父浮层的 children 位），深度只能从树上取。
 */
export const OverlayDepthContext = createContext(0);

/** z 序基准：对齐 `--dfg-z-modal`（单层浮层与既有模态同层），每深一层加一档。 */
const OVERLAY_Z_BASE = 1200;
/** z 序步进：给同层浮层留出推入顺序的位次，不与既有 z 令牌（dropdown/drawer/modal）撞档。 */
const OVERLAY_Z_STEP = 10;

/** 一个已打开的浮层（栈元素）。 */
interface OverlayLayer {
  /** 嵌套深度（根浮层为 1）：决定栈内插入位置，保证「栈序 = 视觉层序」。 */
  depth: number;
  containerRef: RefObject<HTMLElement | null>;
  /** 层序变化后回写本层 z 序（null = 已出栈）。 */
  syncOrder: (order: number | null) => void;
  /** 打开前的焦点元素：整栈清空时归还给它。 */
  restoreFocus: HTMLElement | null;
}

/** 浮层栈：LIFO，末尾为栈顶（最内层）。 */
const overlayStack: OverlayLayer[] = [];

/** 滚动锁引用计数与加锁前的 overflow 值（模块级：多个浮层共享同一把锁）。 */
let scrollLockCount = 0;
let overflowBeforeLock = '';

/** 浮层行为参数。 */
export interface OverlayBehaviorOptions {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Esc（栈顶时）是否关闭本层；默认 true。
   *
   * 何时置 false：浮层自己已经拥有 Esc 语义（如演示舞台的全局键盘处理）时，
   * 若两处都处理会出现「同一次 Esc 走两条退出路径」；置 false 后本层只保留
   * 栈序/焦点/滚动锁语义，Esc 交回调用方。
   */
  closeOnEsc?: boolean;
}

/** 焦点入层：容器内第一个可聚焦元素，没有可聚焦元素则落在容器自身（需 tabIndex=-1）。 */
function focusIntoLayer(layer: OverlayLayer): void {
  const container = layer.containerRef.current;
  if (container === null) return;
  const target = getFocusableElements(container)[0] ?? container;
  target.focus();
}

/** 按深度插入：排在所有「深度不大于自己」的层之后（深度相同时后打开者在上）。 */
function insertLayer(layer: OverlayLayer): void {
  let at = overlayStack.length;
  while (at > 0 && (overlayStack[at - 1]?.depth ?? 0) > layer.depth) at -= 1;
  overlayStack.splice(at, 0, layer);
}

/** 出栈（卸载与关闭走同一条路径，保证引用计数与栈序都不残留）。 */
function removeLayer(layer: OverlayLayer): void {
  const at = overlayStack.indexOf(layer);
  if (at >= 0) overlayStack.splice(at, 1);
}

/** 当前栈顶（最内层）。 */
function topLayer(): OverlayLayer | null {
  return overlayStack[overlayStack.length - 1] ?? null;
}

/**
 * 本层是否仍是栈顶——模块级，供 effect 里注册的事件回调引用。
 * 组件作用域的 `isTop` 不行：它每次渲染换引用，进了事件的依赖表就是 lint 红线，
 * 不进就是读到旧闭包；模块级函数只读 `layerRef.current` 与栈本身，两条都躲开。
 */
function isTopLayer(layer: OverlayLayer): boolean {
  return topLayer() === layer;
}

/** 规范里 disabled 的表单控件**不可聚焦**：浏览器会把焦点交回 body，层内按键事件随之到不了浮层。 */
function isDisabledFormControl(element: HTMLElement): boolean {
  return (
    (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) &&
    element.disabled
  );
}

/** 栈变化后把最新层序同步给各层（z 序由层序推导）。 */
function syncStackOrder(): void {
  overlayStack.forEach((layer, index) => {
    layer.syncOrder(index);
  });
}

/** 加锁：首个持有者记录原值，其余只计数。 */
function acquireScrollLock(): void {
  if (scrollLockCount === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

/** 归还：最后一个归还者恢复原值。 */
function releaseScrollLock(): void {
  if (scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) document.body.style.overflow = overflowBeforeLock;
}

/**
 * 绑定浮层行为：打开时入栈、锁滚动、按栈顶规则入焦；关闭/卸载时出栈、归还滚动锁、交接焦点。
 *
 * @returns `depth`（供组件提供给子树）、`zIndex`（由栈序推导）、`isTop`（栈顶判定）与 `onKeyDown`（Esc / Tab 回环）
 */
export function useOverlayBehavior({
  open,
  onClose,
  containerRef,
  closeOnEsc = true,
}: OverlayBehaviorOptions) {
  const depth = useContext(OverlayDepthContext) + 1;
  const layerRef = useRef<OverlayLayer | null>(null);
  const onCloseRef = useRef(onClose);
  const [order, setOrder] = useState<number | null>(null);

  // onClose 多为内联箭头（每次渲染换引用）：用 ref 固定，事件处理器始终读最新值
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const layer: OverlayLayer = {
      depth,
      containerRef,
      syncOrder: setOrder,
      restoreFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    layerRef.current = layer;
    insertLayer(layer);
    syncStackOrder();
    acquireScrollLock();
    // 焦点入层只作用于栈顶：嵌套同时挂载时内层效果先跑（子先于父），
    // 非栈顶层（外层）若照旧聚焦，就会把焦点从最内层夺回去
    if (topLayer() === layer) focusIntoLayer(layer);
    /**
     * 焦点接回：`aria-modal` 的层开着时，层内焦点**不能落到无处可去**。
     *
     * 为什么必须有：「点一下生成 → 按钮自禁用（异步期间防重复提交）」在浏览器里会让焦点被交回
     * `<body>`（disabled 的表单控件不可聚焦），而 Esc 与 Tab 回环都挂在层的 `onKeyDown` 上，
     * 只收得到**从层内冒泡上来的**按键：焦点在 body 时事件路径里没有这一层，于是「Esc 关不掉」与
     * 「Tab 能逃到画布背后」同时发生，而 `aria-modal="true"` 还在对读屏器称「模态里」。
     *
     * 三条判据，缺一就错：
     * ① **离散的是本层的元素**（在容器内，或正是本层最后一次持焦者）。少了这条，层外的控件
     *    自己禁用一下也会把焦点被拽进浮层——那是票 26 的失焦面，不归本层管。
     * ② 它**已不能再持有焦点**：四类表单控件（button/input/select/textarea）带 `disabled`，或已被摘出文档。
     *    不取「此刻 `activeElement` 是 body」：一次正常转移（Tab 从末位回到首位）在派发序列里**也**经过
     *    body，按后者判会把焦点从刚拿到的目标抢回容器——实测把既有的「Tab 回环」用例判红。
     *    （被 `fieldset[disabled]` 连带禁用的控件不在 ② 之内：那是同一形状的漏洞，记在票 26，别当已覆盖。）
     * ③ 层内**没有别的元素正持着焦**：用户真的把焦点交给层外的自有控件时不动它——陷阱的不变量是
     *    「焦点不落空」，不是「焦点不许离开」，把浮层变成抢焦点的牢笼会打断下拉与吐司。
     *
     * 两条事件都要听：disabled 走 `focusout`，元素被摘出文档在规范里只保证 `blur`
     * （`focusout` 在 removed 路径上历史上各浏览器不一致；jsdom 30 两条都不发，见 `overlay.test.tsx` 的注）。
     * `blur` 不冒泡，所以在 document 的捕获阶段收。`focusin` 只为 ① 维护那个锚。
     *
     * jsdom 30 还有一处偏离要防着「判据写得像测到了」：它的 unfocusingSteps 见旧目标已不可聚焦就直接
     * 返回（`jsdom/lib/jsdom/living/helpers/focusing.js:194`），所以「点一下 → 断言焦点没在 body」在
     * 单元测试里恒过。真浏览器那条完整链路（点生成 → disabled → Esc 关不掉）由 Chromium 门禁
     * `scripts/verify-ai-two-state.mjs` 的 `ui.drawer.closes` 钉住——**该门禁是挂点**：只在本仓
     * `verify:ai-two-state` 手动跑（实测 `~/df-evidence/25/`），未进 `.github/workflows/ci.yml`，
     * 归属见人工决定 5（浏览器段谁来做、何时做）。
     */
    let reclaiming = false;
    // 本层最后一次拿到焦点的元素。摘出文档的路径上事件目标已经不在 DOM 里，
    // 「离散的是不是本层的」只能靠这个锚判断
    let lastFocusInside: HTMLElement | null = null;
    const noteFocusInside = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLElement && containerRef.current?.contains(target))
        lastFocusInside = target;
    };
    const reclaimIfOrphaned = (event: Event): void => {
      if (!isTopLayer(layer)) return;
      const container = containerRef.current;
      if (container === null || !container.isConnected) return;
      const origin = event.target;
      if (!(origin instanceof HTMLElement)) return;
      // 只管**本层**的离散事件：层外的控件自己禁用或被摘，不该把焦点拽进浮层——
      // 那是票 26 的失焦面，不归这里管（没有容器可接回的是它，不是本层）。
      if (!container.contains(origin) && origin !== lastFocusInside) return;
      if (!isDisabledFormControl(origin) && origin.isConnected) return;
      const active = document.activeElement;
      // 「层内已有别的元素持焦」就不抢：接回只补「焦点在层内已无处可去」这一种形状。
      // 这里比的是身份而不只是容器：jsdom 30 把 activeElement 留在刚被禁用的控件上
      // （focusing.js 的 unfocusingSteps 在旧目标已不可聚焦时直接返回，实测 `blur()` 是空操作），
      // 真浏览器此刻交回的是 body——两种形状下「持焦者正是刚离散的那个控件」都成立，一条判据覆盖。
      if (active !== null && active !== origin && container.contains(active)) return;
      // 接回动作自身会让旧持焦者再发一次 blur 落回这里：不许自激
      if (reclaiming) return;
      reclaiming = true;
      // 三个容器（Modal/Drawer/Overlay）都带 tabIndex={-1}，落点必在层内
      container.focus();
      reclaiming = false;
    };
    document.addEventListener('focusin', noteFocusInside);
    document.addEventListener('focusout', reclaimIfOrphaned);
    document.addEventListener('blur', reclaimIfOrphaned, true);
    return () => {
      document.removeEventListener('focusin', noteFocusInside);
      document.removeEventListener('focusout', reclaimIfOrphaned);
      document.removeEventListener('blur', reclaimIfOrphaned, true);
      const wasTop = topLayer() === layer;
      const container = layer.containerRef.current;
      const active = document.activeElement;
      // 出栈后焦点是否无着落：栈顶自身关闭、焦点原本在本层（随卸载落回 body），或焦点已在 body
      const focusOrphaned =
        active === null || active === document.body || (container?.contains(active) ?? false);
      removeLayer(layer);
      layerRef.current = null;
      syncStackOrder();
      releaseScrollLock();
      setOrder(null);
      if (!wasTop && !focusOrphaned) return;
      // 焦点交接：优先交给新的栈顶（逐层撤退），整栈清空才归还打开前的元素
      const next = topLayer();
      if (next !== null) focusIntoLayer(next);
      else if (wasTop) layer.restoreFocus?.focus();
    };
  }, [open, depth, containerRef]);

  const isTop = (): boolean => {
    const layer = layerRef.current;
    return layer !== null && isTopLayer(layer);
  };

  return {
    /** 供组件把「子树深度」提供给嵌套浮层（跨 portal 仍生效）。 */
    depth,
    /** 本层 z 序：随栈序更新（未入栈时用基准值，避免首帧无值）。 */
    zIndex: OVERLAY_Z_BASE + (order ?? 0) * OVERLAY_Z_STEP,
    /** 本层是否栈顶：Esc、遮罩点击与 Tab 回环都只对栈顶生效。 */
    isTop,
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent): void => {
      if (!isTop()) return;
      if (event.key === 'Escape' && closeOnEsc) {
        event.preventDefault();
        // 拒绝继续冒泡：同一次 Esc 只归最内层（对非栈顶层则原样放行给栈下各层判定）
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      const container = containerRef.current;
      if (container !== null) trapTabKey(event, container);
    },
  };
}
