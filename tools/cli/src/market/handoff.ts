/**
 * `df market index` 完成后的**落点交接指引**（票 #15 · 方案 2）。
 *
 * 背景（证据 §C2）：CLI 缺省把 ADS 产物写 `<CWD>/data/ads/`，daemon 只探数据根下的
 * `market[/ads]/`；两边单方测试都绿，但「同一数据根」这一跳没有任何用例，用户照市场页
 * 空态指令跑完三连后永远空态、再次看到同一条指令。
 *
 * 方案定案：**方案 2（CLI 输出明确指引）+ 方案 1 的数据根同源候选**（见 daemon `context.ts`）——
 * 不在 daemon 里补裸 `process.cwd()` 候选（daemon 由壳/系统启动时 CWD 不可控，且违反
 * 「所有持久化路径从 DataRoot 派生」的模块纪律），改由 CLI 把落点与接线动作写清楚。
 *
 * 本模块只产**可执行信息**（绝对路径 + 三条命令），文案改动不影响调用点与测试锚点。
 */

/** 交接指引入参：两条路径都应为绝对路径（调用方负责 resolve）。 */
export interface IndexHandoffPaths {
  /** CLI 数据面根（`--data` 缺省为 `<CWD>/data` 的绝对形态）。 */
  dataRoot: string;
  /** 索引产物绝对路径。 */
  indexPath: string;
}

/**
 * 生成交接指引（逐行；调用方原样 log）。
 *
 * 只给两条**无副作用**的接线方式：`DF_MARKET_INDEX`（推荐，不动 daemon 数据根）与
 * 复制到 daemon 数据根。刻意不建议 `DF_DATA_ROOT=<CLI 数据面>` 同根启动——daemon 的
 * 数据根同时存 config/凭据，指进项目目录会把密钥写进工作区（`data/` 未被 gitignore）。
 *
 * 复制源用整个 `ads/` 目录（`*.json`）：索引与 BM25 检索索引同族搬运，避免 daemon 检索降级。
 */
export function buildIndexHandoffLines(paths: IndexHandoffPaths): string[] {
  return [
    `索引落点：${paths.indexPath}`,
    'daemon 接线（任选其一；索引缺失空态会随之消失）：',
    `  · 指定索引文件（推荐，不动 daemon 数据根）：DF_MARKET_INDEX=${paths.indexPath} pnpm --filter @dforge/daemon dev`,
    `  · 复制到 daemon 数据根（缺省 ~/.dforge，DF_DATA_ROOT 可覆盖）：mkdir -p ~/.dforge/market/ads && cp ${paths.dataRoot}/ads/*.json ~/.dforge/market/ads/`,
  ];
}
