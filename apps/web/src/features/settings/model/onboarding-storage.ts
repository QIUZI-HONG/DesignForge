/**
 * 引导进度的本地持久化（票 17 · spec P2「引导：四步进度本地持久化」）。
 *
 * **为什么是本地而不是 daemon**：引导进度是纯界面态（哪些步完成/跳过、停在第几步），
 * 不属于任何文档或凭据数据；按本地优先纪律只存本机（localStorage 键空间 `dfg:*`），
 * 不联网、不上云。
 *
 * 健壮性契约（同 lib `local-store.ts`）：存储是**可丢的缓存**——
 * 坏 JSON、形状不符、越界下标、写入配额失败一律不炸界面：读回 null（从头开始），
 * 写失败静默降级（本次会话内存态不受影响）。
 *
 * 票 D 收编口径：键值后端接口 re-export lib 单一真源（原逐字重复副本删除）；
 * 缺省后端解析经 lib `browserBackend`。**不走 createLocalStore 列表册**——
 * 进度是单对象形状（`{index, outcomes, finished}`），存储格式冻结（旧数据原样兼容），
 * 解析是领域逻辑（outcomes 逐步校验），留在本模块。
 */
import { browserBackend, type KeyValueBackend } from '@/lib/local-store';

import type { OnboardingOutcome, OnboardingState } from './onboarding';
import { ONBOARDING_STEP_IDS } from './onboarding';
import type { SettingsSectionId } from './sections';

/** 最小键值后端（lib 单一真源；re-export 保持既有导入路径不变）。 */
export type { KeyValueBackend };

/** 引导进度持久化。 */
export interface OnboardingPersistence {
  /** 读已存进度（无存档 / 坏数据一律 null，永不抛错）。 */
  load: () => OnboardingState | null;
  /** 覆盖写进度（失败静默降级，不抛错）。 */
  save: (state: OnboardingState) => void;
}

/** 本地存储键（引导进度是全局单份状态，不按文档隔离）。 */
export const ONBOARDING_STORAGE_KEY = 'dfg:onboarding:progress';

/** 取缺省后端（浏览器 localStorage；SSR / 纯 node / 隐私模式下为 undefined）。 */
function defaultBackend(): KeyValueBackend | undefined {
  try {
    return browserBackend();
  } catch {
    // 隐私模式等场景下访问 localStorage 本身会抛错：降级为不持久化
    return undefined;
  }
}

/** 解析已存进度：形状不符（含旧版本数据与手改坏数据）一律 null，缺步按待办补齐。 */
function parseOnboardingState(raw: string | null): OnboardingState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;

  const index = record.index;
  if (typeof index !== 'number' || !Number.isInteger(index)) return null;
  if (index < 0 || index >= ONBOARDING_STEP_IDS.length) return null;

  const finished = record.finished;
  if (typeof finished !== 'boolean') return null;

  const outcomesRaw = record.outcomes;
  if (typeof outcomesRaw !== 'object' || outcomesRaw === null || Array.isArray(outcomesRaw)) {
    return null;
  }
  const source = outcomesRaw as Record<string, unknown>;
  const outcomes: Record<SettingsSectionId, OnboardingOutcome | null> = {
    workspace: null,
    ai: null,
    comfy: null,
    telemetry: null,
  };
  for (const id of ONBOARDING_STEP_IDS) {
    const value = source[id];
    if (value === null || value === undefined) continue;
    if (value !== 'done' && value !== 'skipped') return null;
    outcomes[id] = value;
  }
  return { index, outcomes, finished };
}

/** 建引导进度持久化（后端省略时用浏览器 localStorage，非浏览器环境为空操作）。 */
export function createOnboardingPersistence(
  backend?: KeyValueBackend | undefined,
): OnboardingPersistence {
  const resolved = backend ?? defaultBackend();
  return {
    load: () => {
      if (resolved === undefined) return null;
      let raw: string | null;
      try {
        raw = resolved.getItem(ONBOARDING_STORAGE_KEY);
      } catch {
        return null;
      }
      return parseOnboardingState(raw);
    },
    save: (state) => {
      if (resolved === undefined) return;
      const payload = JSON.stringify({
        index: state.index,
        outcomes: state.outcomes,
        finished: state.finished,
      });
      try {
        resolved.setItem(ONBOARDING_STORAGE_KEY, payload);
      } catch {
        // 写入失败（配额满 / 隐私模式）：进度只在内存，本次会话不受影响。
      }
    },
  };
}
