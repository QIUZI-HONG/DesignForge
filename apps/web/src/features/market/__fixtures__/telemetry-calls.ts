/**
 * 遥测断言测试工具（D-18 #4：三处复制的 `telemetryCalls` 辅助收敛一处，只被 `*.test.ts(x)` 引用）。
 *
 * 口径：断言组件/页面在用户行为后发出的 `market.*` 埋点（票②）——从假 fetch 桩的调用记录里
 * 抽出打到 `/telemetry/events` 的请求体（`name` + `payload`）。桩由各测试文件自己持有
 * （模块级 `vi.fn()` + `vi.stubGlobal('fetch', …)`），本工具只读它的 `mock.calls`，不替测试
 * 管理桩生命周期。跨 feature 的测试经 `features/market` 公开面的 `marketTestUtils` 命名空间取；
 * feature 内测试可走本目录深路径（与 `__fixtures__/market` 同规）。生产代码不得引用。
 */

/** 一次遥测调用体（信封 `result` 之外的业务载荷：事件名 + 载荷）。 */
export interface TelemetryCall {
  name: string;
  payload: Record<string, unknown>;
}

/** 假 fetch 桩的最小形状（`vi.fn()` 的调用记录面；结构化类型，不绑 vitest 泛型）。 */
interface FetchStubLike {
  mock: { calls: unknown[][] };
}

/** 抽取假 fetch 桩里打到 `/telemetry/events` 的调用体（埋点断言用）。 */
export function telemetryCalls(fetchMock: FetchStubLike): TelemetryCall[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes('/telemetry/events'))
    .map((call) => JSON.parse(String((call[1] as { body: string }).body)) as TelemetryCall);
}
