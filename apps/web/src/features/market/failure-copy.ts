/**
 * 市场失败文案的单点（票 06 / spec P1-2：错误面中文化）。
 *
 * 口径：客户端层（`api.ts`）只透传原始 message 与归一码，**界面文案由展示层生成**——
 * 本模块经共享归类（`@/lib/daemon-failure`）判定失败族：网络层失败（fetch/TypeError 族）
 * 给中文人话（下一步与场景匹配：重试 / 检查 daemon），其余失败原样透传
 * （daemon 拒绝的 message 本就是可读中文）。错误态主位与行内小面（分页「加载更多」/
 * 装载提案横幅）共用同一判定，不再各自拼裸英文技术串。
 */

import { t } from '@/i18n';
import { classifyDaemonFailure } from '@/lib/daemon-failure';

/** 市场失败文案选项：网络失败的人话键 + 可选的「{message}」组合键（无则原样透传）。 */
export interface MarketFailureCopy {
  /** 网络层失败时的人话文案键（zh-CN 目录）。 */
  network: string;
  /** 非网络失败时的组合文案键（含 `{message}` ICU 参数）；省略则直接透传原始 message。 */
  composed?: string;
}

/** 取失败文案（纯函数 × i18n；错误态与行内提示共用）。 */
export function marketFailureText(
  input: { message: string; code?: string | null },
  copy: MarketFailureCopy,
): string {
  const view = classifyDaemonFailure(input);
  if (view.isNetwork) return t(copy.network);
  return copy.composed === undefined ? input.message : t(copy.composed, { message: input.message });
}
