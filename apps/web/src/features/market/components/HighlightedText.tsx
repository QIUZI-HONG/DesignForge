'use client';

/**
 * HighlightedText —— 搜索命中高亮（D3）。
 *
 * 切分逻辑在有测试的纯函数里（`filters.highlightSegments`，断言「不丢字符」）；
 * 本组件只负责把片段渲染成 `<mark>`（样式走令牌 `--dfg-color-selection`）。
 * 空查询或无命中时渲染原文，不产生额外 DOM 噪音。
 */

import { Fragment } from 'react';

import { highlightSegments } from '../filters';

import '../market.css';

/** 高亮文本。 */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  if (segments.length === 1 && segments[0]?.hit !== true) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark key={`hit-${String(index)}`} className="dfg-market__mark" data-df-market="hit">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={`plain-${String(index)}`}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
