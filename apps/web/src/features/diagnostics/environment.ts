/**
 * FE-10 · 诊断面板的纯逻辑（环境快照）。
 *
 * 口径（清单 F8：版本/环境/日志/连通性自检）：
 * - 本模块只产出**数据**（快照 / 平台家族 / 时长分段），**不含任何界面文案**——
 *   文案一律由面板取 i18n（ADR-0003：zh-CN 唯一暴露，界面文案走 ICU 消息）；
 * - daemon 未连接时快照为 `null`（面板渲染「未连接」，门禁对两态都可断言）；
 * - 日志尾部在 `logs.ts`（纯逻辑，单独成块便于复用）。
 */
import type { DaemonHealthResponse } from '@dforge/contracts';

/** 平台家族（只看 UA 家族，不引 UA 解析依赖）。 */
export type PlatformFamily = 'windows' | 'macos' | 'linux' | 'unknown';

/** 环境行 id（面板据此取 i18n 标签；顺序即展示顺序）。 */
export type EnvironmentRowId =
  | 'daemon-version'
  | 'daemon-uptime'
  | 'data-root'
  | 'workspace'
  | 'renderer'
  | 'platform'
  | 'locale'
  | 'viewport'
  | 'dpr';

/** 环境行展示顺序。 */
export const ENVIRONMENT_ROW_IDS: readonly EnvironmentRowId[] = [
  'daemon-version',
  'daemon-uptime',
  'data-root',
  'workspace',
  'renderer',
  'platform',
  'locale',
  'viewport',
  'dpr',
];

/** 渲染环境（浏览器 / Electron 最小壳）。 */
export type RendererFamily = 'browser' | 'desktop';

/** 环境快照（面板逐行渲染 + 门禁取证的对象）。 */
export interface EnvironmentSnapshot {
  /** daemon 握手信息；未连接为 null。 */
  daemon: {
    name: string;
    version: string;
    uptimeMs: number;
    dataRoot: string;
    workspaceDir: string;
  } | null;
  renderer: RendererFamily;
  platform: PlatformFamily;
  locale: string;
  viewport: { width: number; height: number };
  dpr: number;
}

/** 运行时长分段（面板用 ICU 消息拼中文，不做本地化字符串拼接）。 */
export interface UptimeParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** 从 UA 识别平台家族。 */
export function detectPlatform(userAgent: string): PlatformFamily {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return 'unknown';
}

/** 是否在 Electron 壳内（壳的 UA 带 Electron 标记）。 */
export function isElectron(userAgent: string): boolean {
  return /Electron/i.test(userAgent);
}

/** 运行时长分段（负数按 0）。 */
export function uptimeParts(ms: number): UptimeParts {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}

/** 环境快照输入（浏览器侧可注入，便于测试与门禁）。 */
export interface EnvironmentInput {
  health: DaemonHealthResponse | null;
  userAgent: string;
  language: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
}

/** 组装环境快照。 */
export function environmentSnapshot(input: EnvironmentInput): EnvironmentSnapshot {
  return {
    daemon:
      input.health === null
        ? null
        : {
            name: input.health.name,
            version: input.health.version,
            uptimeMs: input.health.uptimeMs,
            dataRoot: input.health.dataRoot,
            workspaceDir: input.health.workspaceDir,
          },
    renderer: isElectron(input.userAgent) ? 'desktop' : 'browser',
    platform: detectPlatform(input.userAgent),
    locale: input.language,
    viewport: input.viewport,
    dpr: input.devicePixelRatio,
  };
}
