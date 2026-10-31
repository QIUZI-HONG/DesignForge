'use client';

// 组件层统一声明客户端边界（与同目录组件同一口径）：web 应用里任何服务端组件都能直接引用。

/**
 * TechnicalDetails —— 可折叠技术详情（票 06 / spec P1-2）。
 *
 * 口径：**人话在主位、技术细节沉进折叠**（G6/UX-16 的同族延伸）。`ErrorState` 的
 * 诊断折叠只收错误码；本组件补齐「错误码 + 原始技术信息」的双件折叠——网络层失败
 * （fetch/TypeError 族）的原始 message（如 `Failed to fetch`）不再直接铺在界面上，
 * 收进这里供报障时展开引用。默认收起；码与原文都没有时不渲染。
 * 文案（折叠标签）由调用方给——组件不内置任何语言（与状态族同纪律）。
 */
export interface TechnicalDetailsProps {
  /** 折叠标签（调用方经 i18n 传入，如「技术详情」）。 */
  label: string;
  /** 错误码（如 `DAEMON_UNREACHABLE`）；没有则不渲染码位。 */
  code?: string | null;
  /** 原始技术信息（如浏览器 fetch 失败原文）；没有则不渲染原文位。 */
  raw?: string | null;
  className?: string;
}

/** 可折叠技术详情（`data-df-error-code` / `data-df-error-raw` 是门禁与测试共用的挂点）。 */
export function TechnicalDetails({ label, code, raw, className }: TechnicalDetailsProps) {
  const hasCode = typeof code === 'string' && code.length > 0;
  const hasRaw = typeof raw === 'string' && raw.length > 0;
  if (!hasCode && !hasRaw) return null;
  return (
    <details className={className} data-df-technical-details="">
      <summary className="dfg-technical-details__toggle">{label}</summary>
      {hasCode ? (
        <span className="dfg-technical-details__code" data-df-error-code={code}>
          {code}
        </span>
      ) : null}
      {hasRaw ? (
        <code className="dfg-technical-details__raw" data-df-error-raw="">
          {raw}
        </code>
      ) : null}
    </details>
  );
}
