import { describe, expect, it } from 'vitest';

import { IMAGE_PARAM_RANGES, parseImageRunRequest } from './index.ts';

const hex64 = 'a'.repeat(64);

describe('image · df.image-run/v1 请求解析', () => {
  it('接受最小请求（仅 positive）', () => {
    const result = parseImageRunRequest({ inputs: { positive: 'wasteland gear icon' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputs.positive).toBe('wasteland gear icon');
  });

  it('接受完整参数并按区间校验', () => {
    const result = parseImageRunRequest({
      templateId: 'icon-fantasy-v1',
      templateVersion: 3,
      targetNodeId: 'frame:1',
      documentId: 'demo',
      inputs: {
        positive: 'p',
        negative: 'text, watermark',
        checkpoint: 'anything-v5.safetensors',
        width: 768,
        height: 768,
        steps: 24,
        cfg: 7,
        sampler: 'dpmpp_2m',
        seed: 123456,
        controlnets: [{ name: 'depth', assetSha256: hex64, strength: 0.7 }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.templateVersion).toBe(3);
    expect(result.value.inputs.controlnets?.[0]?.strength).toBe(0.7);
  });

  it('seed 允许 null（随机）', () => {
    const result = parseImageRunRequest({ inputs: { positive: 'p', seed: null } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.inputs.seed).toBeNull();
  });

  it('拒绝空 positive / 越界尺寸 / 浮点 steps / 越界 cfg', () => {
    expect(parseImageRunRequest({ inputs: { positive: '  ' } }).ok).toBe(false);
    expect(parseImageRunRequest({ inputs: { positive: 'p', width: 100 } }).ok).toBe(false);
    expect(parseImageRunRequest({ inputs: { positive: 'p', width: 4096 } }).ok).toBe(false);
    expect(parseImageRunRequest({ inputs: { positive: 'p', steps: 2.5 } }).ok).toBe(false);
    expect(parseImageRunRequest({ inputs: { positive: 'p', cfg: 20 } }).ok).toBe(false);
    expect(parseImageRunRequest({ inputs: { positive: 'p', seed: -1 } }).ok).toBe(false);
  });

  it('拒绝坏 ControlNet（sha256 形态 / 强度区间）', () => {
    expect(
      parseImageRunRequest({
        inputs: {
          positive: 'p',
          controlnets: [{ name: 'depth', assetSha256: 'nope', strength: 0.5 }],
        },
      }).ok,
    ).toBe(false);
    expect(
      parseImageRunRequest({
        inputs: {
          positive: 'p',
          controlnets: [{ name: 'depth', assetSha256: hex64, strength: 3 }],
        },
      }).ok,
    ).toBe(false);
  });

  it('参数区间是契约级常量（前端滑块与 daemon 校验同源）', () => {
    expect(IMAGE_PARAM_RANGES.width).toEqual([256, 2048]);
    expect(IMAGE_PARAM_RANGES.cfg).toEqual([1, 12]);
  });
});
