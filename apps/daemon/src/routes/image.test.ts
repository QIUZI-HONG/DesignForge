import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 假产出字节（内容不到图像语义层——daemon 只做哈希与落盘）。 */
const FAKE_IMAGE_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);

/** 假 ComfyUI 上游（覆盖探测/提交/历史/队列/取回/中断）。 */
function fakeComfy(options: {
  reachable?: boolean;
  checkpoints?: string[];
  history?: 'success' | 'oom' | 'none';
}): (url: string, init?: RequestInit) => Promise<Response> {
  const reachable = options.reachable ?? true;
  const json = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return async (url, _init) => {
    if (!reachable) throw new TypeError('fetch failed: ECONNREFUSED');
    if (url.endsWith('/system_stats')) {
      return json({ devices: [{ name: 'RTX 4060', vram_total: 8589934592 }] });
    }
    if (url.endsWith('/object_info')) {
      return json({
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [options.checkpoints ?? []] } } },
        LoraLoader: { input: { required: { lora_name: [[]] } } },
      });
    }
    if (url.endsWith('/prompt')) return json({ prompt_id: 'p1' });
    if (url.includes('/history/')) {
      if (options.history === 'success') {
        return json({
          p1: {
            status: { status_str: 'success', messages: [] },
            outputs: {
              '9': { images: [{ filename: 'dforge_00001_.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      if (options.history === 'oom') {
        return json({
          p1: {
            status: {
              status_str: 'error',
              messages: [['execution_error', { exception_message: 'CUDA out of memory' }]],
            },
          },
        });
      }
      return json({});
    }
    if (url.endsWith('/queue')) return json({ queue_running: [], queue_pending: [] });
    if (url.includes('/view')) return new Response(FAKE_IMAGE_BYTES, { status: 200 });
    if (url.endsWith('/interrupt')) return new Response('', { status: 200 });
    return new Response('not found', { status: 404 });
  };
}

async function createImageDaemon(options: Parameters<typeof fakeComfy>[0]): Promise<TestDaemon> {
  return createTestDaemon({
    comfyBaseUrl: 'http://127.0.0.1:8188',
    fetchImpl: fakeComfy(options),
  });
}

const RUN_REQUEST = {
  inputs: {
    positive: 'wasteland gear icon',
    negative: 'text',
    width: 768,
    height: 768,
    steps: 24,
    seed: 123456,
  },
};

describe('image · 探测（未启动是一等状态）', () => {
  it('未启动：reachable=false + comfy_unreachable + 可执行动作（不抛异常）', async () => {
    const daemon = await createImageDaemon({ reachable: false });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/image/probe',
      });
      expect(statusCode).toBe(200);
      const probe = (
        payload as {
          result: {
            reachable: boolean;
            failure: { code: string; actions: string[] } | null;
            baseUrl: string;
          };
        }
      ).result;
      expect(probe.reachable).toBe(false);
      expect(probe.failure?.code).toBe('comfy_unreachable');
      expect(probe.failure?.actions).toEqual(['retry-probe', 'set-base-url']);
      expect(probe.baseUrl).toBe('http://127.0.0.1:8188');
    } finally {
      await daemon.cleanup();
    }
  });

  it('已启动：模型清单（checkpoint）与设备信息回填', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['anything-v5.safetensors'] });
    try {
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/image/probe' });
      const probe = (
        payload as {
          result: {
            reachable: boolean;
            models: { checkpoints: string[] };
            device: { name: string } | null;
          };
        }
      ).result;
      expect(probe.reachable).toBe(true);
      expect(probe.models.checkpoints).toEqual(['anything-v5.safetensors']);
      expect(probe.device?.name).toBe('RTX 4060');
    } finally {
      await daemon.cleanup();
    }
  });

  it('模板清单：默认模板可用', async () => {
    const daemon = await createImageDaemon({ checkpoints: [] });
    try {
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/image/templates' });
      const result = (
        payload as { result: { templates: { templateId: string }[]; defaultTemplateId: string } }
      ).result;
      expect(result.defaultTemplateId).toBe('default-txt2img-v1');
      expect(result.templates.map((template) => template.templateId)).toContain(
        'default-txt2img-v1',
      );
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('image · 提交（缺模型态）', () => {
  it('未启动提交 → 503 comfy_unreachable（details.actions 供前端给三个动作）', async () => {
    const daemon = await createImageDaemon({ reachable: false });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: RUN_REQUEST,
      });
      expect(statusCode).toBe(503);
      const error = (payload as { error: { code: string; details: { actions: string[] } } }).error;
      expect(error.code).toBe('comfy_unreachable');
      expect(error.details.actions).toContain('retry-probe');
    } finally {
      await daemon.cleanup();
    }
  });

  it('服务在线但没有可用 checkpoint → 422 comfy_model_missing（缺什么 + 可用清单）', async () => {
    const daemon = await createImageDaemon({ checkpoints: [] });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: RUN_REQUEST,
      });
      expect(statusCode).toBe(422);
      const error = (
        payload as { error: { code: string; details: { missing: string[]; available: string[] } } }
      ).error;
      expect(error.code).toBe('comfy_model_missing');
      expect(error.details.missing.length).toBeGreaterThan(0);
      expect(error.details.available).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('指定的 checkpoint 不在本地清单 → 422（available 列出真实可用项）', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['anything-v5.safetensors'] });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: { inputs: { ...RUN_REQUEST.inputs, checkpoint: 'missing-model.safetensors' } },
      });
      expect(statusCode).toBe(422);
      const error = (payload as { error: { details: { missing: string[]; available: string[] } } })
        .error;
      expect(error.details.missing).toEqual(['missing-model.safetensors']);
      expect(error.details.available).toEqual(['anything-v5.safetensors']);
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知模板 → 422 comfy_invalid_template（带 available）', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['a.safetensors'] });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: { templateId: '不存在的模板', inputs: RUN_REQUEST.inputs },
      });
      expect(statusCode).toBe(422);
      const error = (payload as { error: { code: string; details: { available: string[] } } })
        .error;
      expect(error.code).toBe('comfy_invalid_template');
      expect(error.details.available).toContain('default-txt2img-v1');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('image · 提交成功与状态机', () => {
  it('提交成功：202 句柄；上游收到注入后的 workflow（prompt 文本/尺寸/seed）', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['anything-v5.safetensors'] });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: RUN_REQUEST,
      });
      expect(statusCode).toBe(202);
      const handle = (payload as { result: { runId: string; state: string } }).result;
      expect(handle.runId).toBe('p1');
      expect(handle.state).toBe('queued');

      const promptCall = daemon.fetchCalls.find((call) => call.url.endsWith('/prompt'));
      expect(promptCall).toBeDefined();
      const sent = JSON.parse(promptCall?.body ?? '{}') as {
        prompt: Record<string, { inputs: Record<string, unknown> }>;
        client_id: string;
      };
      expect(sent.client_id).toContain('dforge-');
      expect(sent.prompt['6']?.inputs.text).toBe('wasteland gear icon');
      expect(sent.prompt['7']?.inputs.text).toBe('text');
      expect(sent.prompt['5']?.inputs.width).toBe(768);
      expect(sent.prompt['3']?.inputs.seed).toBe(123456);
      expect(sent.prompt['4']?.inputs.ckpt_name).toBe('anything-v5.safetensors');
    } finally {
      await daemon.cleanup();
    }
  });

  it('成功终态：状态 succeeded + 产出按内容哈希落盘（sha256 与字节一致）', async () => {
    const daemon = await createImageDaemon({
      checkpoints: ['anything-v5.safetensors'],
      history: 'success',
    });
    try {
      await injectJson(daemon.app, { method: 'POST', url: '/image/runs', payload: RUN_REQUEST });
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/image/runs/p1',
      });
      expect(statusCode).toBe(200);
      const status = (
        payload as {
          result: {
            state: string;
            artifacts: { sha256: string; sizeBytes: number; storedPath: string }[];
            provenance: { seed: number; checkpoint: string; positive: string } | null;
          };
        }
      ).result;
      expect(status.state).toBe('succeeded');
      const artifact = status.artifacts[0];
      expect(artifact).toBeDefined();
      const expectedSha = createHash('sha256').update(FAKE_IMAGE_BYTES).digest('hex');
      expect(artifact?.sha256).toBe(expectedSha);
      expect(artifact?.sizeBytes).toBe(FAKE_IMAGE_BYTES.length);
      expect(artifact?.storedPath).toBe(
        join(daemon.dataRoot, 'image', 'assets', `${expectedSha}.png`),
      );
      expect((await stat(artifact?.storedPath ?? '')).isFile()).toBe(true);
      expect((await readFile(artifact?.storedPath ?? '')).equals(FAKE_IMAGE_BYTES)).toBe(true);
      // 溯源可复现：seed/checkpoint/prompt 全量留痕
      expect(status.provenance?.seed).toBe(123456);
      expect(status.provenance?.checkpoint).toBe('anything-v5.safetensors');
      expect(status.provenance?.positive).toBe('wasteland gear icon');
    } finally {
      await daemon.cleanup();
    }
  });

  it('OOM 失败态：comfy_oom + 降档动作建议', async () => {
    const daemon = await createImageDaemon({
      checkpoints: ['anything-v5.safetensors'],
      history: 'oom',
    });
    try {
      await injectJson(daemon.app, { method: 'POST', url: '/image/runs', payload: RUN_REQUEST });
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/image/runs/p1' });
      const status = (
        payload as { result: { state: string; failure: { code: string; actions: string[] } } }
      ).result;
      expect(status.state).toBe('failed');
      expect(status.failure.code).toBe('comfy_oom');
      expect(status.failure.actions).toContain('lower-resolution');
    } finally {
      await daemon.cleanup();
    }
  });

  it('取消：静默成功（canceled，非错误）；取消后状态保持 canceled', async () => {
    const daemon = await createImageDaemon({
      checkpoints: ['anything-v5.safetensors'],
      history: 'none',
    });
    try {
      await injectJson(daemon.app, { method: 'POST', url: '/image/runs', payload: RUN_REQUEST });
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs/p1/cancel',
      });
      expect(statusCode).toBe(200);
      expect((payload as { result: { state: string } }).result.state).toBe('canceled');
      const after = await injectJson(daemon.app, { method: 'GET', url: '/image/runs/p1' });
      expect((after.payload as { result: { state: string } }).result.state).toBe('canceled');
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知 runId → 404 comfy_run_not_found；参数越界 → 400 comfy_invalid_request', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['anything-v5.safetensors'] });
    try {
      const unknown = await injectJson(daemon.app, { method: 'GET', url: '/image/runs/nope' });
      expect(unknown.statusCode).toBe(404);
      expect((unknown.payload as { error: { code: string } }).error.code).toBe(
        'comfy_run_not_found',
      );

      const badParams = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: { inputs: { positive: 'x', width: 100 } },
      });
      expect(badParams.statusCode).toBe(400);
      expect((badParams.payload as { error: { code: string } }).error.code).toBe(
        'comfy_invalid_request',
      );
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('image · 自定义模板（templates.json）', () => {
  it('用户模板覆盖内置：更窄区间生效（越界 → 400 提及区间）', async () => {
    const daemon = await createImageDaemon({ checkpoints: ['custom.safetensors'] });
    try {
      const templatesDir = join(daemon.dataRoot, 'image');
      await mkdir(templatesDir, { recursive: true });
      const customTemplate = {
        templateId: 'icon-fantasy-v1',
        templateVersion: 3,
        title: '废土图标（自定义）',
        workflow: {
          '1': {
            class_type: 'CheckpointLoaderSimple',
            inputs: { ckpt_name: 'custom.safetensors' },
          },
          '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
          '3': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        },
        params: {
          positive: { path: '3.inputs.text', type: 'string' },
          width: { path: '2.inputs.width', type: 'int', range: [256, 320] },
        },
        requiredModels: { checkpoints: ['custom.safetensors'], loras: [], controlnets: [] },
      };
      await writeFile(
        join(templatesDir, 'templates.json'),
        JSON.stringify({ templates: [customTemplate] }),
      );

      const listed = await injectJson(daemon.app, { method: 'GET', url: '/image/templates' });
      const ids = (
        listed.payload as { result: { templates: { templateId: string }[] } }
      ).result.templates.map((template) => template.templateId);
      expect(ids).toContain('icon-fantasy-v1');

      const outOfRange = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: { templateId: 'icon-fantasy-v1', inputs: { positive: 'x', width: 768 } },
      });
      expect(outOfRange.statusCode).toBe(400);
      expect((outOfRange.payload as { error: { message: string } }).error.message).toContain(
        '[256, 320]',
      );

      const inRange = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs',
        payload: { templateId: 'icon-fantasy-v1', inputs: { positive: 'x', width: 300 } },
      });
      expect(inRange.statusCode).toBe(202);
      const promptCall = daemon.fetchCalls.filter((call) => call.url.endsWith('/prompt')).pop();
      expect(JSON.parse(promptCall?.body ?? '{}')).toMatchObject({
        prompt: { '2': { inputs: { width: 300 } } },
      });
    } finally {
      await daemon.cleanup();
    }
  });
});
