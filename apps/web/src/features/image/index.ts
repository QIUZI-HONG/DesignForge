/**
 * `@dforge/web` 出图特性（FE-10 · F5 出图面板）——公开面。
 *
 * 消费方（FE-03 编辑器壳等）只需要：
 * - `ImagePanel`：可直接挂载的出图面板（端口可注入）；
 * - 纯逻辑：`failure.ts`（失败态映射 + OOM 降档规则）与 `run.ts`（轮询器）——
 *   `scripts/verify-image-two-state.mjs` 用同一份降档/映射规则对真 daemon 取证。
 */

export {
  createImagePort,
  DaemonRequestError,
  type ImagePort,
  readEnvelope,
  resolveDaemonBaseUrl,
} from './client';
export { ImagePanel, type ImagePanelProps } from './components/ImagePanel';
export { type UseImageRunResult, useImageRun } from './components/use-image-run';
export {
  type ComfyFailureView,
  canDowngrade,
  downgradeInputs,
  failureFromError,
  failureFromStatus,
  failureOf,
  isOom,
} from './failure';
export {
  IMAGE_POLL_INTERVAL_MS,
  IMAGE_TERMINAL_STATES,
  type ImageRunPort,
  type ImageRunTracker,
  isTerminal,
  trackImageRun,
} from './run';
