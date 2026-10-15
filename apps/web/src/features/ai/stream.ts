/**
 * FE-10 · AI 流式适配（SSE 文本 → 四步状态更新序列）——**步骤时序的单一真源**。
 *
 * 输入是 daemon `/ai/chat`（stream: true）原样吐出的 SSE 文本块（任意切分），
 * 输出是 `AiRunState` 的更新序列 + 步骤转移时间线。
 * React 抽屉（`use-ai-run`）与 `scripts/verify-ai-two-state.mjs` 都跑这一个模块：
 * 门禁断言的时序 = 用户看到的时序，降级/真态走同一条路径（UI 不分支）。
 *
 * 帧格式与 daemon 一致（apps/daemon/src/routes/ai.ts）：`event: <type>` + `data: <JSON>` 双行 + 空行。
 */
import type { AiStreamEvent } from '@dforge/contracts';

import {
  type AiRunState,
  type AiStepId,
  advanceAiRun,
  beginAiRun,
  completeAiRun,
  failAiRun,
  finishSteps,
  initialAiRun,
  retryAiRun,
} from './steps';

/** 一次步骤转移（时间线的一条）。 */
export interface AiStepTransition {
  step: AiStepId;
  /** 单调时钟毫秒（门禁据此做步骤耗时断言）。 */
  atMs: number;
}

/** 一次状态更新（transition 为 null 表示只是数据累积，比如 delta）。 */
export interface AiStreamUpdate {
  state: AiRunState;
  transition: AiStepTransition | null;
}

/** 阅读器接口。 */
export interface AiRunReader {
  /** 开始一次运行（queued 进入 active）；重试也走这里（尝试次数递增）。 */
  begin(): AiStreamUpdate;
  /** 失败后重试（仅 failed 态有效，其余为 no-op）。 */
  retry(): AiStreamUpdate;
  /** 喂一段 SSE 文本，返回由此产生的一串状态更新。 */
  pushText(chunk: string): AiStreamUpdate[];
  /** 传输层失败（fetch 抛错 / 非 2xx）：落在当前活动步上。 */
  fail(message: string): AiStreamUpdate;
  /** 当前状态快照（结构拷贝，外部改不动内部）。 */
  snapshot(): AiRunState;
  /** 步骤转移时间线（含 begin 的 queued）。 */
  timeline(): AiStepTransition[];
}

/** 解析单条 SSE 帧文本（`event:`/`data:` 行；data 多行按 SSE 规范以换行拼接）。 */
function parseFrameText(block: string): AiStreamEvent | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join('\n'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    if (type !== 'start' && type !== 'delta' && type !== 'done' && type !== 'error') return null;
    return parsed as AiStreamEvent;
  } catch {
    return null;
  }
}

/** 创建流式阅读器（`now` 可注入，测试与门禁控制时间戳）。 */
export function createAiRunReader(options: { now?: () => number } = {}): AiRunReader {
  const now = options.now ?? (() => Date.now());
  let state = initialAiRun();
  let buffer = '';
  const timeline: AiStepTransition[] = [];

  const stepTo = (step: AiStepId): AiStreamUpdate | null => {
    const next = advanceAiRun(state, step);
    if (next === state) return null;
    state = next;
    const transition: AiStepTransition = { step, atMs: now() };
    timeline.push(transition);
    return { state: { ...state, steps: { ...state.steps } }, transition };
  };

  const update = (): AiStreamUpdate => ({
    state: { ...state, steps: { ...state.steps } },
    transition: null,
  });

  return {
    begin() {
      state = beginAiRun(state);
      const transition: AiStepTransition = { step: 'queued', atMs: now() };
      timeline.push(transition);
      return { state: { ...state, steps: { ...state.steps } }, transition };
    },

    retry() {
      const next = retryAiRun(state);
      if (next === state) return update();
      state = next;
      const transition: AiStepTransition = { step: 'queued', atMs: now() };
      timeline.push(transition);
      return { state: { ...state, steps: { ...state.steps } }, transition };
    },

    pushText(chunk: string) {
      buffer += chunk;
      const updates: AiStreamUpdate[] = [];
      // SSE 帧以空行分隔；只消费完整帧，残缺尾巴留在缓冲里等下一个块
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) break;
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrameText(block);
        if (event === null) continue;

        if (event.type === 'start') {
          const moved = stepTo('llm');
          // start 帧携带降级开关：此刻即可确定角标（同构，不改变步骤路径）
          state = { ...state, degraded: event.degraded, runId: event.runId };
          if (moved !== null) updates.push(moved);
          continue;
        }
        if (event.type === 'delta') {
          state = { ...state, content: state.content + event.delta };
          updates.push(update());
          continue;
        }
        if (event.type === 'error') {
          state = failAiRun(state, event.error.message);
          updates.push(update());
          continue;
        }
        // done：先落到 validate → compile（校验与编译是收口前的两段），再以完整响应收口
        const validate = stepTo('validate');
        if (validate !== null) updates.push(validate);
        const compile = stepTo('compile');
        if (compile !== null) updates.push(compile);
        state = finishSteps(state);
        state = completeAiRun(state, event.response);
        updates.push(update());
      }
      return updates;
    },

    fail(message: string) {
      state = failAiRun(state, message);
      return update();
    },

    snapshot() {
      return { ...state, steps: { ...state.steps }, suggestions: [...state.suggestions] };
    },

    timeline() {
      return timeline.map((entry) => ({ ...entry }));
    },
  };
}
