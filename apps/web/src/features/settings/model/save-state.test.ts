/**
 * 保存态机测试（FE-09 · 清单 E3「保存态」：保存中 / 已保存 / 失败重试）。
 *
 * 纯函数 reducer 的直接测试：断言状态迁移与失败文案的保留/清除，
 * 覆盖需求里的三条路径——成功、失败、失败后重试成功。
 */
import { describe, expect, it } from 'vitest';

import { INITIAL_SAVE_STATE, reduceSaveState } from './save-state';

describe('保存态机', () => {
  it('初始为 idle（无错误文案）', () => {
    expect(INITIAL_SAVE_STATE).toEqual({ phase: 'idle', message: null });
  });

  it('保存中 → 已保存', () => {
    const saving = reduceSaveState(INITIAL_SAVE_STATE, { type: 'start' });
    expect(saving.phase).toBe('saving');
    const saved = reduceSaveState(saving, { type: 'succeeded' });
    expect(saved).toEqual({ phase: 'saved', message: null });
  });

  it('失败：进入 failed 并保留 daemon 文案（原样展示，供重试判断）', () => {
    const failed = reduceSaveState(reduceSaveState(INITIAL_SAVE_STATE, { type: 'start' }), {
      type: 'failed',
      message: '工作目录不可写：/root/x',
    });
    expect(failed.phase).toBe('failed');
    expect(failed.message).toBe('工作目录不可写：/root/x');
  });

  it('失败后重试成功：failed → saving → saved（文案清除）', () => {
    const failed = { phase: 'failed', message: 'daemon 未启动' } as const;
    const retrying = reduceSaveState(failed, { type: 'start' });
    expect(retrying.phase).toBe('saving');
    const saved = reduceSaveState(retrying, { type: 'succeeded' });
    expect(saved).toEqual({ phase: 'saved', message: null });
  });

  it('保存中重复 start 幂等（防双击造成双提交）', () => {
    const saving = reduceSaveState(INITIAL_SAVE_STATE, { type: 'start' });
    expect(reduceSaveState(saving, { type: 'start' })).toEqual(saving);
  });

  it('编辑草稿（edit）：已保存/失败指示让位回 idle', () => {
    const saved = { phase: 'saved', message: null } as const;
    expect(reduceSaveState(saved, { type: 'edit' })).toEqual({ phase: 'idle', message: null });
    const failed = { phase: 'failed', message: 'x' } as const;
    expect(reduceSaveState(failed, { type: 'edit' })).toEqual({ phase: 'idle', message: null });
  });

  it('保存中收到 edit 不打断（在飞请求的终态由 succeeded/failed 决定）', () => {
    const saving = reduceSaveState(INITIAL_SAVE_STATE, { type: 'start' });
    expect(reduceSaveState(saving, { type: 'edit' })).toEqual(saving);
  });
});
