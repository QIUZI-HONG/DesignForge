/**
 * 壳的运行模式解析与自检硬超时口径 —— 从 `main.ts` 抽出的纯函数层（不触碰 Electron，可单测）。
 *
 * 为什么单列：D-8 的根因是「自检硬超时在所有模式武装、交互分支从未清除」——「哪种模式该被
 * 硬超时兜底」必须是一条**可被单测钉死的判据**，而不是散落在启动流程里的副作用。Electron
 * 只能在真运行时里跑（vitest 起不了壳），故把判据留在这一层，主进程只负责按判据分派。
 */

/** 壳的运行模式（`process.argv` 开关的解析结果）。 */
export type ShellRunMode =
  /** `--df-baseline-probe`：不开窗只读一次运行时偏好（守卫的运行时兜底）。 */
  | { kind: 'probe' }
  /** `--df-shell-smoke=<jsonPath>`（可带 `--df-capture=<pngPath>`）：装载 → 测事实 → 写自检 JSON。 */
  | { kind: 'smoke'; reportPath: string; capturePath?: string }
  /** 开关组合不成立（如 `--df-capture` 单独出现）：按用法错误退出 2。 */
  | { kind: 'usage-error'; message: string }
  /** 无任何自检开关：正常交互壳（单窗口单工作区，长期存活）。 */
  | { kind: 'interactive' };

/** 自检硬超时窗口（毫秒）：装载卡死或渲染进程崩掉时，自检段不能无限等。 */
export const SELF_CHECK_TIMEOUT_MS = 30_000;

/** 取 argv 里 `--name=value` 形式的值（`main.ts` 的 `--df-dpr` 等也走这里）。 */
export function readArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/**
 * 解析运行模式。判定顺序与既有口径一致：探针 → 冒烟/截图 → 用法错误 → 交互。
 *
 * `--df-dpr` 不参与模式判定（它只是显示口径开关，任何模式都可带）。
 */
export function resolveRunMode(argv: readonly string[]): ShellRunMode {
  const smokeReportPath = readArg(argv, 'df-shell-smoke');
  const capturePath = readArg(argv, 'df-capture');

  if (argv.includes('--df-baseline-probe')) {
    return { kind: 'probe' };
  }
  if (smokeReportPath !== undefined) {
    return capturePath === undefined
      ? { kind: 'smoke', reportPath: smokeReportPath }
      : { kind: 'smoke', reportPath: smokeReportPath, capturePath };
  }
  if (capturePath !== undefined) {
    // 截图必须与冒烟报告同批产出（证据要能互相对上）；单独给 PNG 路径视为用法错误。
    return { kind: 'usage-error', message: '用法错误：--df-capture 只能与 --df-shell-smoke 同用' };
  }
  return { kind: 'interactive' };
}

/**
 * 自检硬超时是否武装。
 *
 * **只有自检类运行（probe / smoke / capture）需要兜底**——它们的契约是「跑完就退出」，卡死必须
 * 被硬超时掐断（门禁不能无限等）。交互壳的契约正相反：它要一直用下去，任何硬超时都会把它误杀
 * （D-8 / UX-04：交互壳存活恰好 30 秒后 exit 1）。所以这里是白名单而非黑名单——将来新增模式时
 * 默认**不武装**，不会再出现「忘了清除超时」这一类缺陷。
 */
export function armsSelfCheckTimeout(mode: ShellRunMode): boolean {
  return mode.kind === 'probe' || mode.kind === 'smoke';
}
