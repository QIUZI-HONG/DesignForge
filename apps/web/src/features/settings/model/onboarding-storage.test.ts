/**
 * 引导进度本地持久化测试（票 17 · spec P2「引导：四步进度本地持久化」）。
 *
 * seam：`createOnboardingPersistence` 的对外行为。契约：
 * - 存取往返：保存的状态原样读回（刷新/后退后从原进度续作的数据面依据）；
 * - 坏数据不炸：JSON 损坏、形状不符、越界下标一律当「无存档」（null），永不抛错；
 * - 写入失败（配额满 / 隐私模式）静默降级——进度只在内存，不影响本次会话；
 * - 无后端（SSR / node）= 不读不写（本地优先纪律：进度只存本机）。
 */
import { describe, expect, it } from 'vitest';

import {
  advanceOnboarding,
  backOnboarding,
  createOnboardingState,
  type OnboardingState,
} from './onboarding';
import {
  createOnboardingPersistence,
  type KeyValueBackend,
  ONBOARDING_STORAGE_KEY,
} from './onboarding-storage';

/** 内存后端（模拟 localStorage；可注入写入失败）。 */
function memoryBackend(seed: Record<string, string> = {}): KeyValueBackend & {
  dump: () => Record<string, string>;
  failWrites: () => void;
} {
  const data = new Map(Object.entries(seed));
  let writesFail = false;
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (writesFail) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    dump: () => Object.fromEntries(data),
    failWrites: () => {
      writesFail = true;
    },
  };
}

/** 「第 1 步已跳过、停在第 2 步」的样例状态（走真状态机生成，不手搓）。 */
function stateAfterSkipStep1(): OnboardingState {
  return advanceOnboarding(createOnboardingState(), 'skipped');
}

describe('引导进度持久化 · createOnboardingPersistence', () => {
  it('保存后读回：状态原样往返（含各步结果与当前步下标）', () => {
    const backend = memoryBackend();
    const persistence = createOnboardingPersistence(backend);
    const state = stateAfterSkipStep1();

    persistence.save(state);

    expect(persistence.load()).toEqual(state);
  });

  it('落在约定键 `dfg:onboarding:progress`（与评审域 `dfg:*` 键空间同族）', () => {
    const backend = memoryBackend();
    const persistence = createOnboardingPersistence(backend);

    persistence.save(stateAfterSkipStep1());

    expect(Object.keys(backend.dump())).toEqual([ONBOARDING_STORAGE_KEY]);
  });

  it('无存档：load 返回 null（首次进入 = 从第 1 步开始）', () => {
    const persistence = createOnboardingPersistence(memoryBackend());
    expect(persistence.load()).toBeNull();
  });

  it('坏 JSON：当无存档（不抛错，下次进入从第 1 步开始）', () => {
    const persistence = createOnboardingPersistence(
      memoryBackend({ [ONBOARDING_STORAGE_KEY]: '{ 坏了' }),
    );
    expect(persistence.load()).toBeNull();
  });

  it('形状不符：数组 / 字符串 / 缺字段 / 字段类型错 → 一律当无存档', () => {
    const shapes = [
      JSON.stringify([1, 2]),
      JSON.stringify('done'),
      JSON.stringify({ index: 1 }),
      JSON.stringify({ index: '0', outcomes: {}, finished: false }),
      JSON.stringify({ index: 1, outcomes: { workspace: '完成' }, finished: false }),
      JSON.stringify({ index: 1, outcomes: { workspace: 'skipped' } }),
    ];
    for (const raw of shapes) {
      const persistence = createOnboardingPersistence(
        memoryBackend({ [ONBOARDING_STORAGE_KEY]: raw }),
      );
      expect(persistence.load(), `形状应被拒：${raw}`).toBeNull();
    }
  });

  it('越界下标（负数 / 超出步数）：当无存档，不越权渲染', () => {
    for (const index of [-1, 4, 99]) {
      const raw = JSON.stringify({ index, outcomes: { workspace: 'done' }, finished: false });
      const persistence = createOnboardingPersistence(
        memoryBackend({ [ONBOARDING_STORAGE_KEY]: raw }),
      );
      expect(persistence.load(), `下标应被拒：${index}`).toBeNull();
    }
  });

  it('缺步的 outcomes：缺的键按待办（null）补齐，其余结果保留', () => {
    const raw = JSON.stringify({ index: 1, outcomes: { workspace: 'done' }, finished: false });
    const persistence = createOnboardingPersistence(
      memoryBackend({ [ONBOARDING_STORAGE_KEY]: raw }),
    );
    const state = persistence.load();
    expect(state).not.toBeNull();
    expect(state?.outcomes.workspace).toBe('done');
    expect(state?.outcomes.ai).toBeNull();
    expect(state?.outcomes.comfy).toBeNull();
    expect(state?.outcomes.telemetry).toBeNull();
  });

  it('finished 态原样往返（完成卡刷新后仍在的数据面依据）', () => {
    const backend = memoryBackend();
    const persistence = createOnboardingPersistence(backend);
    let state = createOnboardingState();
    for (const result of ['done', 'skipped', 'done', 'done'] as const) {
      state = advanceOnboarding(state, result);
    }

    persistence.save(state);

    expect(persistence.load()).toEqual(state);
    expect(state.finished).toBe(true);
  });

  it('读回的状态可继续推进：续作一步后结果接得上（中断续作的语义）', () => {
    const backend = memoryBackend();
    const persistence = createOnboardingPersistence(backend);
    const interrupted = stateAfterSkipStep1();
    persistence.save(interrupted);

    const restored = persistence.load();
    expect(restored).not.toBeNull();
    const resumed = advanceOnboarding(restored as OnboardingState, 'done');
    expect(resumed.index).toBe(2);
    expect(resumed.outcomes.workspace).toBe('skipped');
    expect(resumed.outcomes.ai).toBe('done');
  });

  it('回退后的状态也能存读（后退不丢进度）', () => {
    const backend = memoryBackend();
    const persistence = createOnboardingPersistence(backend);
    const state = backOnboarding(stateAfterSkipStep1());

    persistence.save(state);

    expect(persistence.load()).toEqual(state);
  });

  it('写入失败（配额满）：save 静默降级，不抛错', () => {
    const backend = memoryBackend();
    backend.failWrites();
    const persistence = createOnboardingPersistence(backend);

    expect(() => persistence.save(stateAfterSkipStep1())).not.toThrow();
  });

  it('无后端（SSR / node）：load 返回 null、save 空操作', () => {
    const persistence = createOnboardingPersistence(undefined);

    expect(persistence.load()).toBeNull();
    expect(() => persistence.save(stateAfterSkipStep1())).not.toThrow();
  });
});
