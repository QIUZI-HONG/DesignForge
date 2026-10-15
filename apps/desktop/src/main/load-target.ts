/**
 * 壳的装载目标解析 —— 「先 dev server、再静态产物、最后壳内诊断页」三段口径。
 *
 * 为什么单列：装载目标决定壳里跑的是哪份产物，是「壳内与浏览器一致」的前提
 * （验收标准 §3 壳内条款）。解析结果要写进壳自检 JSON 作证据，故它是纯函数 + 可注入存在谓词。
 *
 * 环境变量（壳的对外开关，仅这两个）：
 * - `DFORGE_SHELL_URL`：开发态指向 dev server（如 http://localhost:3000）；仅接受 http(s)。
 * - `DFORGE_SHELL_STATIC`：静态产物目录（或指向其 index.html）；接受绝对路径。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** dev server 开关（开发态）。 */
export const SHELL_URL_ENV = 'DFORGE_SHELL_URL';
/** 静态产物目录开关（构建产物）。 */
export const SHELL_STATIC_ENV = 'DFORGE_SHELL_STATIC';

/** 装载计划：三种目标各带 `reason`（证据友好，写进壳自检 JSON）。 */
export type ShellLoadPlan =
  | { kind: 'dev-server'; url: string; reason: string }
  | { kind: 'static-export'; rootDir: string; reason: string }
  | { kind: 'fallback'; fileUrl: string; reason: string };

/** 解析入参；`exists` 注入以便单测不触盘。 */
export interface ResolveLoadPlanInput {
  /** 环境变量表（生产传 `process.env`）。 */
  env: Record<string, string | undefined>;
  /** 壳资源根（apps/desktop）。 */
  shellRoot: string;
  /** 仓库根（定位 apps/web/out）。 */
  repoRoot: string;
  /** 文件存在谓词。 */
  exists: (path: string) => boolean;
}

/** 是否是可直接装载的 http(s) 地址。 */
function asHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** 把「目录」或「目录/index.html」统一成目录。 */
function asStaticRoot(raw: string): string {
  return raw.endsWith('index.html') ? dirname(raw) : raw;
}

/**
 * 解析装载计划。
 *
 * 优先序：`DFORGE_SHELL_URL`（dev）→ `DFORGE_SHELL_STATIC` → 仓库内 `apps/web/out`（Next
 * `output:'export'` 产物）→ 壳内诊断页。被忽略的候选会把原因并进 `reason`，便于证据侧溯源。
 */
export function resolveLoadPlan({
  env,
  shellRoot,
  repoRoot,
  exists,
}: ResolveLoadPlanInput): ShellLoadPlan {
  const notes: string[] = [];

  const rawUrl = env[SHELL_URL_ENV]?.trim();
  if (rawUrl) {
    const url = asHttpUrl(rawUrl);
    if (url) {
      return { kind: 'dev-server', url, reason: `env ${SHELL_URL_ENV}` };
    }
    notes.push(`env ${SHELL_URL_ENV} 非 http(s) URL，已忽略`);
  }

  const staticCandidates: Array<{ rootDir: string; reason: string }> = [];
  const rawStatic = env[SHELL_STATIC_ENV]?.trim();
  if (rawStatic) {
    staticCandidates.push({ rootDir: asStaticRoot(rawStatic), reason: `env ${SHELL_STATIC_ENV}` });
  }
  staticCandidates.push({
    rootDir: join(repoRoot, 'apps', 'web', 'out'),
    reason: 'apps/web/out（静态产物）',
  });

  for (const candidate of staticCandidates) {
    if (exists(join(candidate.rootDir, 'index.html'))) {
      return { kind: 'static-export', rootDir: candidate.rootDir, reason: candidate.reason };
    }
    notes.push(`${candidate.rootDir} 缺 index.html，已忽略`);
  }

  const fallbackPath = join(shellRoot, 'resources', 'fallback.html');
  const fallbackUrl = pathToFileURL(fallbackPath).href;
  if (!exists(fallbackPath)) {
    // 回退页本身缺失：仍返回确定目标（装载必然失败，由冒烟段如实判 fail），不在此抛异常。
    notes.push('回退诊断页缺失，装载将失败');
  }
  notes.unshift('web 产物缺失');
  return { kind: 'fallback', fileUrl: fallbackUrl, reason: notes.join('；') };
}

/** 生产用：按本机 `process.env` 与真实文件系统解析（`shellRoot` = apps/desktop，`repoRoot` = 仓库根）。 */
export function resolveLoadPlanFromDisk(options: {
  env?: Record<string, string | undefined>;
  shellRoot: string;
  repoRoot: string;
}): ShellLoadPlan {
  return resolveLoadPlan({
    env: options.env ?? process.env,
    shellRoot: options.shellRoot,
    repoRoot: options.repoRoot,
    exists: existsSync,
  });
}
