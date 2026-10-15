import { IntlMessageFormat } from 'intl-messageformat';

import en from '../../messages/en.json';
import zhCN from '../../messages/zh-CN.json';

/**
 * 设界 Web i18n（骨架期最小实现）。
 *
 * 口径（ADR-0003 + 前端实现规格 v1 §一.4）：
 * - zh-CN **唯一暴露**——不提供语言切换入口，Locale 参数仅供内部与测试使用；
 * - en 仅为工程兜底目录（缺译兜底），不是可切换的界面语言；
 * - 文案以 ICU MessageFormat 解析（intl-messageformat），键为「点号扁平键」（如 home.title）；
 * - 文案用词以 Figma 本体中文界面校准（术语对照表，清单附录 B），违反词表 = A 级缺陷。
 */
export type Locale = 'zh-CN' | 'en';

/** 唯一暴露的界面语言。 */
export const PRIMARY_LOCALE: Locale = 'zh-CN';

/** 工程兜底语言（缺译时回落，不暴露给界面）。 */
export const FALLBACK_LOCALE: Locale = 'en';

/** 消息目录：zh-CN 主目录 + en 兜底目录。 */
const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  en,
};

/**
 * 取文案：先查目标语言目录，缺译回落 en，再缺则原样回键（便于门禁发现漏译）。
 *
 * @param key 点号扁平键（如 home.title）
 * @param values ICU 参数
 * @param locale 目标语言（默认 PRIMARY_LOCALE；界面不传）
 */
export function t(
  key: string,
  values?: Record<string, string | number>,
  locale: Locale = PRIMARY_LOCALE,
): string {
  const pattern = catalogs[locale][key] ?? catalogs[FALLBACK_LOCALE][key] ?? key;
  return String(new IntlMessageFormat(pattern, locale).format(values));
}
