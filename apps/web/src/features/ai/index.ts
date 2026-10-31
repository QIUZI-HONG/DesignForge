/**
 * `@dforge/web` AI 特性（FE-10 · F4 AI 抽屉）——公开面。
 *
 * 消费方（FE-03 编辑器壳等）只需要：
 * - `AiDrawer`：可直接挂载的 AI 抽屉（右滑入 + 关闭记忆，端口可注入）；
 * - 纯逻辑：`steps.ts`（步骤状态机）与 `stream.ts`（SSE → 步骤时序的单一真源）——
 *   `scripts/verify-ai-two-state.mjs` 也跑同一份，门禁断言 = 用户可见时序。
 *
 * 时序口径（票 02 / spec P0-3）：可见三段「排队 → 模型生成 → 完成」
 * （`AI_VISIBLE_STEPS`）；validate/compile 保留在机器时序（`AI_STEPS`）作为 P5 扩展位。
 *
 * 纪律：降级（无 key / 上游失败）不在此处分支——daemon 以同构响应表达，
 * 抽屉只读 `degraded` 渲染角标「本地建议」。
 */

export {
  type AiPort,
  createAiPort,
  DaemonRequestError,
  readEnvelope,
  resolveDaemonBaseUrl,
} from './client';
export { AiDrawer, type AiDrawerProps } from './components/AiDrawer';
export { type UseAiRunResult, useAiRun } from './components/use-ai-run';
export {
  AI_STEPS,
  AI_VISIBLE_STEPS,
  type AiRunPhase,
  type AiRunState,
  type AiStepId,
  type AiStepStatus,
  type AiVisibleStepId,
  advanceAiRun,
  beginAiRun,
  completeAiRun,
  failAiRun,
  finishSteps,
  initialAiRun,
  isAiRunActive,
  retryAiRun,
  visibleAiStepStatus,
} from './steps';
export {
  type AiRunReader,
  type AiStepTransition,
  type AiStreamUpdate,
  createAiRunReader,
} from './stream';
