/**
 * 壳自检报告与判据 —— 冒烟段（`scripts/verify-shell-parity.mjs`）的判据地基。
 *
 * 为什么要这一层：Electron 只能用真实运行时探（vitest 里起不了壳），故把「测量」留在主进程、
 * 把「判据」抽成这里可注入的纯函数——四顶基线与尺寸口径都在单测里被钉死，冒烟段只负责搬运与退出码。
 *
 * 报告字段即证据：`scripts/verify-shell-parity.mjs` 会把 shell 侧报告与守卫的静态断言交叉核对。
 */
import { SECURITY_BASELINE } from './window-options.js';

/** 报告 schema 版本（字段变更即升版本，证据侧据此判读）。 */
export const SHELL_SELF_CHECK_SCHEMA = 'dforge.shell-selfcheck/1';

/** 五项安全开关的实测快照（来自 `webContents.getLastWebPreferences()`）；`null` = 运行时未测得该键。 */
export interface SecuritySnapshot {
  contextIsolation: boolean | null;
  sandbox: boolean | null;
  nodeIntegration: boolean | null;
  webSecurity: boolean | null;
  allowRunningInsecureContent: boolean | null;
}

/** 装载落点与页面事实（由主进程在 did-finish-load 后测量）。 */
export interface ShellPageSnapshot {
  /** 实际装载到的 URL（可能被 302 / 服务端改写，故与目标分开记录）。 */
  href: string;
  title: string;
  readyState: string;
  bodyChildren: number;
  /** 回退诊断页自报的标记（web 产物页为 null）。 */
  marker: string | null;
}

/** 壳自检报告（`--df-shell-smoke` 写出的 JSON）。 */
export interface ShellSelfCheckReport {
  schema: typeof SHELL_SELF_CHECK_SCHEMA;
  mode: 'smoke' | 'capture';
  /** 装载目标（含 reason，便于证据溯源）。 */
  target: { kind: string; url: string; reason: string };
  /**
   * 窗口实测尺寸与页面 DPR。`width/height` 是窗口内容区（诊断用）；
   * **对照判据看 `innerWidth/innerHeight`**——那才是页面真正拿到的 CSS 视口（窗口装饰/合成器
   * 取整都会让两者差 1px，而一致性对照只认视口）。
   */
  window: {
    width: number;
    height: number;
    devicePixelRatio: number;
    innerWidth: number;
    innerHeight: number;
  };
  security: SecuritySnapshot;
  page: ShellPageSnapshot;
  /** 取自检过程的说明性事实（视口校正、装载来源等）——不参与判据，只作证据。 */
  notes?: string[];
}

/** 基线探针报告（`--df-baseline-probe` 打印的 JSON；只需安全快照）。 */
export interface ShellBaselineProbeReport {
  schema: typeof SHELL_SELF_CHECK_SCHEMA;
  mode: 'probe';
  security: SecuritySnapshot;
}

/** 对照态附带的尺寸约束（验收标准 §3：1440×900 / DPR 1.5）。 */
export interface SelfCheckExpectation {
  expectViewport?: { width: number; height: number; dpr: number };
}

/**
 * 拆解五项安全开关的实测结果。
 *
 * 为什么要分开：`null`（运行时测不到，如 `webSecurity` 只能靠跨源探针间接测）**不是违规**，
 * 而是「无法据此结论」——守卫遇到它必须退到 exit 2（阻塞），绝不能当成通过（禁假绿）。
 */
export function splitSecurityFindings(security: SecuritySnapshot): {
  violations: string[];
  undetermined: string[];
  /** 未测得的键位（结构化：守卫据此与静态结论**逐键**比对，而不是比字符串）。 */
  undeterminedKeys: Array<keyof SecuritySnapshot>;
} {
  const violations: string[] = [];
  const undetermined: string[] = [];
  const undeterminedKeys: Array<keyof SecuritySnapshot> = [];
  for (const [key, expected] of Object.entries(SECURITY_BASELINE)) {
    const actual = security[key as keyof SecuritySnapshot];
    if (actual === null || actual === undefined) {
      undeterminedKeys.push(key as keyof SecuritySnapshot);
      undetermined.push(`安全基线 ${key} 运行时未测得（期望 ${String(expected)}）`);
    } else if (actual !== expected) {
      violations.push(`安全基线 ${key} 期望 ${String(expected)} 实际 ${String(actual)}`);
    }
  }
  return { violations, undetermined, undeterminedKeys };
}

/**
 * 逐项比对五项安全开关，返回失败描述（空数组 = 全过）。
 *
 * `requireAll`（默认 true）：`null` 记「未测得」为失败——守卫的运行时探针口径；
 * `requireAll: false`：只报**实测到的不符**——冒烟段口径（未测得的两项由静态守卫覆盖，见 `verify-shell-parity.mjs`）。
 */
export function evaluateSecurityBaseline(
  security: SecuritySnapshot,
  options: { requireAll?: boolean } = {},
): string[] {
  const { requireAll = true } = options;
  const { violations, undetermined } = splitSecurityFindings(security);
  return requireAll ? [...violations, ...undetermined] : violations;
}

/** 仅比五项的探针判据（守卫的运行时探针用）。 */
export function evaluateBaselineProbe(probe: ShellBaselineProbeReport): string[] {
  return evaluateSecurityBaseline(probe.security, { requireAll: true });
}

/** 判据：装载完成、有内容、落点与目标同源，五项基线与（可选）尺寸口径相符。 */
export function evaluateSelfCheck(
  report: ShellSelfCheckReport,
  expectation: SelfCheckExpectation = {},
): string[] {
  const failures = evaluateSecurityBaseline(report.security, { requireAll: false });

  if (report.page.readyState !== 'complete') {
    failures.push(`页面未装载完成（readyState=${report.page.readyState}）`);
  }
  if (report.page.bodyChildren <= 0) {
    failures.push(`页面无内容（bodyChildren=${report.page.bodyChildren}）`);
  }
  if (!isSameOrigin(report.target.url, report.page.href)) {
    failures.push(`装载落点与目标不同源（target=${report.target.url} page=${report.page.href}）`);
  }

  const viewport = expectation.expectViewport;
  if (viewport) {
    if (
      report.window.innerWidth !== viewport.width ||
      report.window.innerHeight !== viewport.height
    ) {
      failures.push(
        `页面视口与验收基准不符（期望 ${viewport.width}×${viewport.height} CSS，实际 ${report.window.innerWidth}×${report.window.innerHeight}；窗口内容区 ${report.window.width}×${report.window.height}）`,
      );
    }
    if (Math.abs(report.window.devicePixelRatio - viewport.dpr) > 1e-6) {
      failures.push(
        `devicePixelRatio 与验收基准不符（期望 ${viewport.dpr}，实际 ${report.window.devicePixelRatio}）`,
      );
    }
  }

  return failures;
}

/** 同源判定（file: 协议下 origin 为 "null"，退化为整串比较，仍足以发现「装到别处」）。 */
function isSameOrigin(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    if (a.origin === 'null' || b.origin === 'null') {
      return a.protocol === b.protocol && a.pathname === b.pathname;
    }
    return a.origin === b.origin;
  } catch {
    return false;
  }
}
