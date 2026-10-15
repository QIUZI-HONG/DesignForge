/**
 * @dforge/daemon · 配置与凭据路由（FE-09 设置页 / FE-10 诊断面板消费）。
 *
 * - GET /config：当前配置 + DeepSeek 凭据摘要（**只回掩码**，永不含明文 key）；
 * - PUT /config：局部更新（工作目录规范化 + 可写性校验；非法值统一错误形状）；
 * - PUT /config/credentials：写入 key（0600 加密落盘，响应只回掩码）；
 * - DELETE /config/credentials：清除 key（AI 随即进入降级态，不报错）；
 * - POST /config/connectivity：连通性自检（daemon / ComfyUI / AI 配置，**不真调云端**）。
 */

import type {
  ConfigResponse,
  ConnectivityItem,
  ConnectivityReport,
  CredentialSummary,
} from '@dforge/contracts';
import { DAEMON_ROUTES, isPlausibleApiKey } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

function configResponse(context: DaemonContext): ConfigResponse {
  return {
    config: context.config.get(),
    credentials: { deepseek: context.credentials.summary() },
  };
}

/** 连通性自检（不触达云端：AI 项只检查是否已配置）。 */
async function buildConnectivityReport(context: DaemonContext): Promise<ConnectivityReport> {
  const items: ConnectivityItem[] = [];

  items.push({
    id: 'daemon',
    label: '本地服务',
    status: 'ok',
    detail: `运行中（数据目录 ${context.paths.dataRoot}）`,
    actions: [],
    code: null,
  });

  const probe = await context.comfy.probe({ force: true });
  if (probe.reachable) {
    const modelHint =
      probe.models === null
        ? '（模型清单未返回）'
        : `，可用 checkpoint ${probe.models.checkpoints.length} 个`;
    items.push({
      id: 'comfyui',
      label: 'ComfyUI 出图',
      status: 'ok',
      detail: `已连接 ${probe.baseUrl}${modelHint}`,
      actions: [],
      code: null,
    });
  } else {
    items.push({
      id: 'comfyui',
      label: 'ComfyUI 出图',
      status: 'unavailable',
      detail: probe.failure?.message ?? `未检测到本地服务（${probe.baseUrl}）`,
      actions: probe.failure?.actions ?? ['retry-probe', 'set-base-url'],
      code: 'comfy_unreachable',
    });
  }

  const summary: CredentialSummary = context.credentials.summary();
  items.push(
    summary.hasKey
      ? {
          id: 'ai',
          label: 'DeepSeek（文本 AI）',
          status: 'ok',
          detail: `已配置（${summary.maskedKey ?? 'sk-…'}，来源：${summary.source === 'env' ? '环境变量' : '本地凭据库'}）`,
          actions: [],
          code: null,
        }
      : {
          id: 'ai',
          label: 'DeepSeek（文本 AI）',
          status: 'not-configured',
          detail: '未配置 key：AI 功能当前为降级态（不影响编辑与出图）',
          actions: ['configure-credentials'],
          code: null,
        },
  );

  return { checkedAt: context.now().toISOString(), items };
}

/** 注册配置/凭据/连通性路由。 */
export function registerConfigRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.get(DAEMON_ROUTES.config.path, () => ({ ok: true, result: configResponse(context) }));

  app.put(DAEMON_ROUTES.configUpdate.path, async (request, reply) => {
    const result = await context.config.patch(request.body);
    if (!result.ok) {
      return sendFail(reply, 'config_invalid', result.message, result.details);
    }
    return sendOk(reply, configResponse(context));
  });

  app.put(DAEMON_ROUTES.configCredentialsSet.path, async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return sendFail(reply, 'credential_invalid', '请求体必须是 JSON 对象');
    }
    const record = body as Record<string, unknown>;
    if (record.provider !== undefined && record.provider !== 'deepseek') {
      return sendFail(reply, 'credential_invalid', 'provider 仅支持 deepseek');
    }
    const apiKey = record.apiKey;
    if (typeof apiKey !== 'string' || !isPlausibleApiKey(apiKey)) {
      return sendFail(reply, 'credential_invalid', 'API key 形态不合法（期望 sk- 前缀 + 长串）');
    }
    const result = await context.credentials.setDeepseekKey(apiKey);
    if (!result.ok) {
      return sendFail(reply, 'credential_invalid', result.message);
    }
    // 响应只回掩码摘要（maskedKey），明文 key 不出本次请求作用域
    return sendOk(reply, { summary: result.summary });
  });

  app.delete(DAEMON_ROUTES.configCredentialsClear.path, async (_request, reply) => {
    const summary = await context.credentials.clear();
    return sendOk(reply, { cleared: true, summary });
  });

  app.post(DAEMON_ROUTES.configConnectivity.path, async (_request, reply) => {
    return sendOk(reply, await buildConnectivityReport(context));
  });
}
