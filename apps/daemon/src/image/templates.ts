/**
 * @dforge/daemon · 出图 workflow 模板（参数化注入，架构 v1.1 §4.5.6）。
 *
 * 模板 = API 格式 workflow JSON + 一张**参数占位表**（path 指向节点字段）。
 * 本段提供内置默认模板 `default-txt2img-v1`（SD1.5 系通用文生图）；
 * 用户模板落 `<dataRoot>/image/templates.json`（`{ "templates": [...] }`），
 * 与内置模板合并（同 templateId 以用户模板为准）。
 */

import type { ImageTemplate, ImageTemplateParamSpec } from '@dforge/contracts';

import { readJsonFileOrNull } from '../fs-atomic.ts';

/** 内置默认模板 id。 */
export const DEFAULT_TEMPLATE_ID = 'default-txt2img-v1';

/** 内置默认模板（缺省 512 边长起步——8GB 显存约束，§4.5.6 硬件闸门）。 */
export function builtinTemplate(): ImageTemplate {
  return {
    templateId: DEFAULT_TEMPLATE_ID,
    templateVersion: 1,
    title: '默认文生图（SD1.5 系）',
    workflow: {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 0,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'dforge', images: ['8', 0] } },
    },
    params: {
      positive: { path: '6.inputs.text', type: 'string', from: 'prompt' },
      negative: { path: '7.inputs.text', type: 'string', from: 'negative' },
      checkpoint: { path: '4.inputs.ckpt_name', type: 'enum', from: 'model' },
      width: { path: '5.inputs.width', type: 'int', range: [256, 2048] },
      height: { path: '5.inputs.height', type: 'int', range: [256, 2048] },
      seed: { path: '3.inputs.seed', type: 'int', from: 'user|random' },
      steps: { path: '3.inputs.steps', type: 'int', range: [1, 60] },
      cfg: { path: '3.inputs.cfg', type: 'float', range: [1, 12] },
      sampler: { path: '3.inputs.sampler_name', type: 'enum' },
    },
    requiredModels: { checkpoints: [], loras: [], controlnets: [] },
  };
}

function isTemplateParamSpec(value: unknown): value is ImageTemplateParamSpec {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string') return false;
  return (
    record.type === 'string' ||
    record.type === 'int' ||
    record.type === 'float' ||
    record.type === 'enum' ||
    record.type === 'asset'
  );
}

function parseTemplate(value: unknown): ImageTemplate | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.templateId !== 'string' || record.templateId.length === 0) return null;
  if (typeof record.templateVersion !== 'number' || !Number.isInteger(record.templateVersion))
    return null;
  if (typeof record.workflow !== 'object' || record.workflow === null) return null;
  if (typeof record.params !== 'object' || record.params === null) return null;
  const params: Record<string, ImageTemplateParamSpec> = {};
  for (const [key, spec] of Object.entries(record.params as Record<string, unknown>)) {
    if (!isTemplateParamSpec(spec)) return null;
    params[key] = spec;
  }
  const required = record.requiredModels as Record<string, unknown> | undefined;
  const asList = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  return {
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    title: typeof record.title === 'string' ? record.title : record.templateId,
    workflow: record.workflow as Record<string, unknown>,
    params,
    requiredModels: {
      checkpoints: asList(required?.checkpoints),
      loras: asList(required?.loras),
      controlnets: asList(required?.controlnets),
    },
  };
}

/** 加载模板集（内置 + 用户文件合并；文件损坏时只用内置，不失败）。 */
export async function loadTemplates(templatesPath: string): Promise<ImageTemplate[]> {
  const builtin = builtinTemplate();
  const result = await readJsonFileOrNull(templatesPath);
  if (!result.ok) return [builtin];
  const raw = result.value;
  const list =
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as Record<string, unknown>).templates)
      ? ((raw as Record<string, unknown>).templates as unknown[])
      : [];
  const userTemplates: ImageTemplate[] = [];
  for (const entry of list) {
    const parsed = parseTemplate(entry);
    if (parsed !== null) userTemplates.push(parsed);
  }
  const merged = new Map<string, ImageTemplate>();
  merged.set(builtin.templateId, builtin);
  for (const template of userTemplates) merged.set(template.templateId, template);
  return [...merged.values()];
}

/** 按 id 选模板（缺省取内置），并校验版本一致（不一致时以本地为准并在溯源中记录）。 */
export function selectTemplate(
  templates: ImageTemplate[],
  templateId: string | undefined,
): ImageTemplate | null {
  const wanted = templateId ?? DEFAULT_TEMPLATE_ID;
  return templates.find((template) => template.templateId === wanted) ?? null;
}

/** 依参数占位表向 workflow 注入值（path 形如 `6.inputs.text`）。 */
export function applyParam(
  workflow: Record<string, unknown>,
  spec: ImageTemplateParamSpec,
  value: unknown,
): void {
  const segments = spec.path.split('.');
  let cursor: Record<string, unknown> = workflow;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) return;
    cursor = next as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined) cursor[last] = value;
}
