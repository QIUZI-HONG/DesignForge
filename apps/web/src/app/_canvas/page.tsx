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
 * 查询参数：`?doc=<documentId>`（从 daemon 载入）。daemon 基址一律经单点模块
 * `@/lib/daemon-endpoint` 解析（`?daemon=` 的读取只在那里发生，ADR-0004 裁决 ①）——
 * 本页不自行解析端口相关参数。
 * 之所以在客户端读查询串（而不是用 Next 的 searchParams）：本页要能在
 * 静态导出（`output: 'export'` 预留口径）与 jsdom 测试下同样工作，且不引入 Suspense 约束。
 */

import { useEffect, useState } from 'react';

import { CanvasStudio } from '@/features/canvas';
import { resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';

/** 查询参数（客户端解析）。 */
export interface CanvasPageQuery {
  doc: string | null;
}

/** 从查询串解析参数。 */
export function parseCanvasQuery(search: string): CanvasPageQuery {
  const params = new URLSearchParams(search);
  return { doc: params.get('doc') };
}

/** 画布宿主页。 */
export default function CanvasPage() {
  const [query, setQuery] = useState<CanvasPageQuery>({ doc: null });
  const [daemonUrl, setDaemonUrl] = useState<string | null>(null);

  useEffect(() => {
    setQuery(parseCanvasQuery(window.location.search));
    // 基址经单点模块解析：显式 `?daemon=` 原样采用，缺省 = 构建期 env / 端口窗起点
    setDaemonUrl(resolveDaemonEndpointSync());
  }, []);

  return (
    <div className="dfc-canvas-page" data-df-canvas-page="">
      <CanvasStudio documentId={query.doc} {...(daemonUrl === null ? {} : { daemonUrl })} />
    </div>
  );
}
