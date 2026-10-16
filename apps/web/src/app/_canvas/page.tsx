'use client';

/**
 * `/_canvas` —— 画布宿主页（**内部工具，非对标页**，FE-06）。
 *
 * 用途（本票门禁的直接入口）：
 * 1. `scripts/verify-canvas.mjs` 在这里做**挂载 6 断言**（Skia 初始化 / 首帧 / 点选高亮 /
 *    拖动改 transform / 滚轮缩放视口 / 保存-重载往返）与 13 类交互接线断言；
 * 2. `scripts/e2e/scenarios/canvas.mjs` 在这里跑「拖画 → 持久化 → 导出/导入往返」。
 *
 * 为什么单独开一条内部路由（而不是用编辑器路由）：编辑器路由（`/editor`）归 FE-03，
 * 本票落地时它还没进集成分支；本页只做宿主壳，FE-03 合入后画布本体（`CanvasStage`）
 * 与自动载入逻辑原样搬进编辑器路由即可。
 *
 * 查询参数：`?doc=<documentId>`（从 daemon 载入）、`?daemon=<url>`（覆盖 daemon 基址）。
 * 之所以在客户端读查询串（而不是用 Next 的 searchParams）：本页要能在
 * 静态导出（`output: 'export'` 预留口径）与 jsdom 测试下同样工作，且不引入 Suspense 约束。
 */

import { useEffect, useState } from 'react';

import { CanvasStudio } from '@/features/canvas/studio/canvas-studio';

/** 查询参数（客户端解析）。 */
export interface CanvasPageQuery {
  doc: string | null;
  daemon: string | null;
}

/** 从查询串解析参数。 */
export function parseCanvasQuery(search: string): CanvasPageQuery {
  const params = new URLSearchParams(search);
  return { doc: params.get('doc'), daemon: params.get('daemon') };
}

/** 画布宿主页。 */
export default function CanvasPage() {
  const [query, setQuery] = useState<CanvasPageQuery>({ doc: null, daemon: null });

  useEffect(() => {
    setQuery(parseCanvasQuery(window.location.search));
  }, []);

  return (
    <div className="dfc-canvas-page" data-df-canvas-page="">
      <CanvasStudio
        documentId={query.doc}
        {...(query.daemon === null ? {} : { daemonUrl: query.daemon })}
      />
    </div>
  );
}
