/**
 * 出图失败态与降档逻辑测试（seam：纯函数——错误信封 → UI 模型；OOM → 降档参数）。
 *
 * 断言口径：daemon 契约的失败形状（code/details.actions/missing/available）
 * 必须逐项映射到 UI 可渲染的字段；降档只动分辨率与步数且不越界。
 */
import { describe, expect, it } from 'vitest';

import {
  canDowngrade,
  downgradeInputs,
  failureFromError,
  failureFromStatus,
  isOom,
} from './failure';

describe('出图失败态映射', () => {
  it('未启动（comfy_unreachable）：保留可执行动作，供逐项渲染', () => {
    const view = failureFromError({
      code: 'comfy_unreachable',
      message: '未检测到本地 ComfyUI 服务（http://127.0.0.1:8188）',
      details: { actions: ['retry-probe', 'set-base-url', 'launch'], missing: [], available: [] },
    });
    expect(view.code).toBe('comfy_unreachable');
    expect(view.actions).toEqual(['retry-probe', 'set-base-url', 'launch']);
    expect(view.isOom).toBe(false);
  });

  it('缺模型（comfy_model_missing）：缺失与可用清单原样保留（前端原样展示）', () => {
    const view = failureFromError({
      code: 'comfy_model_missing',
      message: '模板引用的模型不存在：sdxl.safetensors',
      details: {
        actions: ['check-model-list'],
        missing: ['sdxl.safetensors'],
        available: ['sd15.safetensors'],
      },
    });
    expect(view.missing).toEqual(['sdxl.safetensors']);
    expect(view.available).toEqual(['sd15.safetensors']);
  });

  it('OOM（comfy_oom）被识别（UI 据此给「降档重试」）', () => {
    const view = failureFromError({
      code: 'comfy_oom',
      message: '显存不足（OOM）：建议降一档分辨率/步数后重试',
      details: { actions: ['lower-resolution', 'lower-steps', 'retry-later'] },
    });
    expect(view.isOom).toBe(true);
    expect(isOom('comfy_oom')).toBe(true);
    expect(isOom('comfy_unreachable')).toBe(false);
  });

  it('details 缺失时容错为空清单（错误信封仍可渲染）', () => {
    const view = failureFromError({ code: 'comfy_timeout', message: '提交出图任务超时' });
    expect(view.actions).toEqual([]);
    expect(view.missing).toEqual([]);
    expect(view.available).toEqual([]);
  });

  it('任务终态里的失败（ImageRunStatus.failure 平铺形状）同样映射为可渲染视图', () => {
    const view = failureFromStatus({
      code: 'comfy_oom',
      message: '显存不足（OOM）：建议降一档分辨率/步数后重试',
      actions: ['lower-resolution', 'lower-steps', 'retry-later'],
      missing: [],
      available: [],
    });
    expect(view.isOom).toBe(true);
    expect(view.actions).toContain('lower-resolution');
  });
});

describe('OOM 降档', () => {
  it('分辨率与步数各降一档（768→576、20→15），其余参数保持不变', () => {
    const lowered = downgradeInputs({
      positive: 'wasteland gear icon',
      negative: 'text',
      width: 768,
      height: 768,
      steps: 20,
      cfg: 7,
    });
    expect(lowered.width).toBe(576);
    expect(lowered.height).toBe(576);
    expect(lowered.steps).toBe(15);
    expect(lowered.cfg).toBe(7);
    expect(lowered.positive).toBe('wasteland gear icon');
  });

  it('未给出尺寸时按 daemon 缺省（512）起降', () => {
    const lowered = downgradeInputs({ positive: 'icon' });
    expect(lowered.width).toBe(384);
    expect(lowered.height).toBe(384);
  });

  it('触及下限后不再降（256 为分辨率下限；按钮据此禁用）', () => {
    const lowered = downgradeInputs({ positive: 'icon', width: 300, height: 300, steps: 1 });
    expect(lowered.width).toBe(256);
    expect(lowered.height).toBe(256);
    expect(lowered.steps).toBe(1);
    expect(canDowngrade({ positive: 'icon', width: 256, height: 256, steps: 1 })).toBe(false);
    expect(canDowngrade({ positive: 'icon', width: 512, height: 512, steps: 20 })).toBe(true);
  });
});
