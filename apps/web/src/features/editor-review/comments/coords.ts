/**
 * 评论钉点坐标换算（C12：钉点走**世界坐标**，随画布缩放/平移跟随）。
 *
 * 为什么单独一层而不在组件里直接算：换算公式来自引擎视口（`@dforge/engine` 的
 * `worldToScreen` / `screenToWorld`），组件只做「读视口 → 换算 → 定位」；
 * 把换算抽成纯函数后，缩放跟随与命中判定都能在 jsdom 里逐值断言（无需真实布局）。
 * 命中半径用**屏幕像素**：缩小时钉点视觉大小不变，可点性也不该变小。
 */
import { screenToWorld, type Viewport, worldToScreen } from '@dforge/engine';

/** 屏幕坐标点。 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** 世界坐标锚点（与 `threads.ts` 的 `CommentAnchor` 同形状）。 */
export interface WorldAnchor {
  x: number;
  y: number;
}

/** 钉点（钉在画布某世界坐标上的评论线程的最小读法）。 */
export interface PinLike {
  id: string;
  anchor: WorldAnchor;
}

/** 世界锚点 → 屏幕位置（跟随缩放/平移）。 */
export function pinScreenPoint(viewport: Viewport, anchor: WorldAnchor): ScreenPoint {
  return worldToScreen(viewport, anchor);
}

/** 屏幕点 → 世界锚点（在画布上点一下新建评论时用）。 */
export function worldAnchorAt(viewport: Viewport, screen: ScreenPoint): WorldAnchor {
  return screenToWorld(viewport, screen);
}

/**
 * 屏幕空间命中：返回最近的钉点 id；半径外（或空集）返回 null。
 * 距离并列时取先出现者（列表顺序稳定 → 命中结果可复现）。
 */
export function hitTestPins(
  pins: readonly PinLike[],
  viewport: Viewport,
  screen: ScreenPoint,
  radiusScreen: number,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pin of pins) {
    const at = pinScreenPoint(viewport, pin.anchor);
    const distance = Math.hypot(at.x - screen.x, at.y - screen.y);
    if (distance <= radiusScreen && distance < bestDistance) {
      bestId = pin.id;
      bestDistance = distance;
    }
  }
  return bestId;
}
