'use client';

/**
 * 诊断数据（React 侧）——health / connectivity / events 三源一次拉齐。
 *
 * 纪律：格式与人话化都在纯模块（`environment.ts` / `logs.ts`）；这里只管
 * 「并行拉取 → 落 state → 失败归一为不可达错误态（可重试）」。
 */
import type { ConnectivityReport, DaemonHealthResponse, TelemetryEvent } from '@dforge/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DiagnosticsPort } from '../client';

/** hook 返回值。 */
export interface UseDiagnosticsResult {
  health: DaemonHealthResponse | null;
  connectivity: ConnectivityReport | null;
  events: TelemetryEvent[];
  /** 任一数据源失败 → 错误文案（daemon 不可达）；成功为 null。 */
  error: string | null;
  loading: boolean;
  /** 重新拉取三源（自检/重试共用入口）。 */
  reload: () => void;
}

/** 日志尾部条数（面板展示上限）。 */
export const LOG_TAIL_LIMIT = 8;

/** 创建诊断数据状态。 */
export function useDiagnostics(options: { port: DiagnosticsPort }): UseDiagnosticsResult {
  const { port } = options;
  const [health, setHealth] = useState<DaemonHealthResponse | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityReport | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([port.health(), port.connectivity(), port.events(LOG_TAIL_LIMIT)])
      .then(([healthValue, report, telemetry]) => {
        if (!mountedRef.current) return;
        setHealth(healthValue);
        setConnectivity(report);
        setEvents(telemetry.events);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current) return;
        setError(caught instanceof Error ? caught.message : '诊断请求失败');
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [port]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { health, connectivity, events, error, loading, reload };
}
