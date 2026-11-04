/**
 * apps/web 组件测试公共装配（FE-02 / FE-09 引入；其他前端票按需复用）。
 *
 * - RTL 自动清理：vitest 未开 `globals`，RTL 不会自动 cleanup，此处显式在 afterEach 卸载
 *   （否则同一文件内多次 render 会互相污染查询结果）；
 * - `matchMedia` 兜底：jsdom 未实现（组件若按视口降级不会误崩）；
 * - **跨文件卫生兜底（tp2-05 · F-3 五点的结构修）**：主题 / localStorage / 编辑器注册表
 *   三件套在每个用例后复位——这是 `isolate: false`（同 worker 跨文件共享 DOM、localStorage
 *   与模块单例）的前置条件，五处历史泄漏点（editor-bootstrap / market register /
 *   ComponentPanel / entries / market panel page）以此兜底 + 各自文件的 afterEach 作双层保险。
 * 与 `packages/ui/src/test-setup.ts` 同口径（跨包一致）。
 *
 * **模块图每文件重建（tp2-05 · isolate:false 的第二道结构前提）**：本文件除 vitest 外
 * 一律动态导入——`vi.resetModules()` 在 setup 最前清空 worker 共享的模块缓存，本文件的
 * 动态导入先执行并把「本文件将用到的同一实例」种回缓存，测试文件随后的静态导入命中
 * 同一实例（cleanup 与测试的 RTL 不分家；钩子闭包不持有过期模块）。
 */
import { afterEach, beforeEach, vi } from 'vitest';

// 为什么必须最先执行：isolate:false 下同一 worker 的模块缓存在文件间共享，
// `vi.mock('next/navigation')` 等按文件注册的 mock 在「真实模块已被同 worker 前序文件
// 加载」时不生效——组件拿到真实 `useRouter` 即抛 `invariant expected app router to be
// mounted`，或拿到前序文件的 mock 实例（断言句柄 0 调用）——E1' 翻车 6 failed 中
// register / panel 两族即此机制（vitest 已知问题族 vitest-dev/vitest#11152 同族）。
// 此处清空缓存 → 本文件全部导入按本文件的 mock 注册重新解析（worker 与 jsdom 环境
// 的复用收益保留；等价于把 isolate:true 的「每文件新模块图」语义补回非隔离运行）。
// 文件内模块单例照常共享，不受影响。
vi.resetModules();

const { cleanup } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
});

/**
 * 全局卫生兜底（每个用例后执行；注册次序早于各测试文件自身的 afterEach，
 * 按钩子逆序语义最后落账 = 兜底语义；node 环境文件无 DOM，逐项守卫跳过）。
 */
const preTestTheme: { value: string | null } = { value: null };

beforeEach(() => {
  if (typeof document === 'undefined') return;
  // 快照用例前的根元素主题（通常为空），afterEach 据此还原
  preTestTheme.value = document.documentElement.getAttribute('data-theme');
});

afterEach(async () => {
  if (typeof document === 'undefined') return;
  // ① 主题还原：任何文件遗留的 `data-theme`（dark/light）不跨用例、不跨文件残留
  if (preTestTheme.value === null) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preTestTheme.value);
  }
  // ② localStorage 清空：FEEDBACK_KEY 等跨文件残留源（Drawer rememberKey 等）一并清账
  window.localStorage.clear();
  // ③ 编辑器注册表复位：命令 + 插槽两类模块单例（动态解析当前实例，见文件头说明；
  //   叶子模块直引而非公开面——test-setup 属 src 根测试基础设施，guard-feature-boundaries
  //   判据外区域同 `verify/`；公开面会把组件树拖进每个测试文件的模块图）
  const [{ resetCommandRegistry }, { resetEditorSlots }] = await Promise.all([
    import('@/features/editor-shell/commands/registry'),
    import('@/features/editor-shell/slots/registry'),
  ]);
  resetCommandRegistry();
  resetEditorSlots();
});

if (typeof window !== 'undefined' && window.matchMedia === undefined) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
