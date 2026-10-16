/**
 * @dforge/daemon · 本地遥测存储（JSONL 追加，**默认仅本地**）。
 *
 * 纪律（架构 v1.1 §4.4.5 / 市场规格 §8.3）：事件只落本地 `<dataRoot>/telemetry/events.jsonl`；
 * 写入前经契约层脱敏（敏感键值替换为占位符）——**key/token 永不落盘**；
 * 配置开关关闭时只回执不落盘；支持一键查看原始记录与一键删除。
 */

import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import type { TelemetryEvent, TelemetryEventName } from '@dforge/contracts';
import { sanitizeTelemetryPayload } from '@dforge/contracts';

import type { ConfigStore } from '../config/store.ts';
import { appendJsonLine } from '../fs-atomic.ts';

/** 写入请求（daemon 侧解析后的形态）。 */
export interface TelemetryAppendInput {
  name: TelemetryEventName;
  payload: Record<string, unknown>;
  sessionId: string | null;
  appVersion: string | null;
  at: string | null;
}

/** 遥测存储接口。 */
export interface TelemetryStore {
  load(): Promise<void>;
  append(input: TelemetryAppendInput): Promise<{ stored: boolean; id: string | null }>;
  /** 返回最新在前的记录（limit 缺省 200，上限 1000）。 */
  query(limit?: number): Promise<TelemetryEvent[]>;
  count(): Promise<number>;
  clear(): Promise<number>;
}

/** 创建遥测存储（eventsPath 为注入点）。 */
export function createTelemetryStore(options: {
  eventsPath: string;
  config: ConfigStore;
}): TelemetryStore {
  const { eventsPath, config } = options;

  const readRaw = async (): Promise<string> => {
    try {
      return await readFile(eventsPath, 'utf8');
    } catch {
      return '';
    }
  };

  const readAll = async (): Promise<TelemetryEvent[]> => {
    const raw = await readRaw();
    const events: TelemetryEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          events.push(parsed as TelemetryEvent);
        }
      } catch {
        // 单行损坏跳过（追加式日志的容忍度）
      }
    }
    return events;
  };

  return {
    async load(): Promise<void> {
      // 追加式存储无加载步骤；保留钩子以便将来校验/迁移
    },

    async append(input: TelemetryAppendInput) {
      if (!config.get().telemetry.enabled) {
        return { stored: false, id: null };
      }
      const { payload } = sanitizeTelemetryPayload(input.payload);
      const event: TelemetryEvent = {
        id: `evt_${randomBytes(8).toString('hex')}`,
        name: input.name,
        at: input.at ?? new Date().toISOString(),
        sessionId: input.sessionId,
        appVersion: input.appVersion,
        payload,
      };
      await appendJsonLine(eventsPath, event, 0o600);
      return { stored: true, id: event.id };
    },

    async query(limit = 200): Promise<TelemetryEvent[]> {
      const capped = Math.min(Math.max(1, limit), 1000);
      const events = await readAll();
      return events.slice(-capped).reverse();
    },

    async count(): Promise<number> {
      return (await readAll()).length;
    },

    async clear(): Promise<number> {
      const removed = (await readAll()).length;
      await rm(eventsPath, { force: true });
      return removed;
    },
  };
}
