/**
 * 本地列表存储引擎（web 侧 `localStorage` 册的单一真源）。
 *
 * **来源（票 D 收编）**：机制半部提升自 `features/editor-review/storage.ts`——
 * 评审域留下自己的键空间与形状校验（该文件 re-export 本模块，导入路径不变）；
 * market 装载册 / 回流计数、editor-shell 最近命令、settings 引导进度、home 回收站
 * 等原先各自手写的 localStorage 读写克隆一律收编到 {@link createLocalStore}
 * （读写机制单份实现，形状差异由各册以 validate 注入）。
 *
 * 健壮性契约：存储是**可丢的缓存**——坏 JSON、形状不符、读取失败一律当空/过滤，
 * 永不抛错；写入失败经 `onWriteError` 回调（配额满 / 隐私模式），缺省吞掉不炸界面；
 * 需要写失败上抛语义的册（market 两册、home 回收站的既有口径）自行在 onWriteError 里 rethrow。
 */

/** 最小键值后端（`localStorage` 的形状子集；便于测试注入与 SSR 判空）。 */
export interface KeyValueBackend {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** 册引擎实际依赖的读写子集（removeItem 属键空间管理，不在「列表册读写」语义内；
 * market/home 既有注入替身只实现这两个方法，可直接注入）。 */
export type KeyValueReadWriter = Pick<KeyValueBackend, 'getItem' | 'setItem'>;

/** 本地列表存储。 */
export interface LocalStore<T> {
  /** 读全部条目（坏数据一律当空/过滤，永不抛错）。 */
  load: () => T[];
  /** 覆盖写全部条目（失败只回调，不抛错）。 */
  save: (items: readonly T[]) => void;
}

/** createLocalStore 选项。 */
export interface LocalStoreOptions<T> {
  key: string;
  /** 后端；省略时用 `localStorage`（不存在则退化为空操作）。 */
  backend?: KeyValueReadWriter | undefined;
  /** 形状校验（逐条过滤，挡住旧版本数据与手改坏数据）。 */
  validate?: (value: unknown) => value is T;
  /** 写入失败回调（配额满 / 隐私模式），供上层提示「本地保存失败」。 */
  onWriteError?: (error: unknown) => void;
}

/** 浏览器后端（非浏览器环境返回 undefined）。 */
export function browserBackend(): KeyValueBackend | undefined {
  if (typeof window === 'undefined') return undefined;
  const storage = (window as { localStorage?: KeyValueBackend }).localStorage;
  return storage ?? undefined;
}

/** 解析后端里的 JSON 列表：坏数据不进界面。 */
function readList<T>(
  backend: KeyValueReadWriter | undefined,
  key: string,
  validate: ((value: unknown) => value is T) | undefined,
): T[] {
  if (backend === undefined) return [];
  let raw: string | null;
  try {
    raw = backend.getItem(key);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (validate === undefined) return parsed as T[];
  return parsed.filter((item) => validate(item));
}

/** 建本地列表存储。 */
export function createLocalStore<T>(options: LocalStoreOptions<T>): LocalStore<T> {
  const backend = options.backend ?? browserBackend();
  return {
    load: () => readList(backend, options.key, options.validate),
    save: (items) => {
      if (backend === undefined) return;
      try {
        backend.setItem(options.key, JSON.stringify(items));
      } catch (error) {
        options.onWriteError?.(error);
      }
    },
  };
}

/** 内存后端（测试与「本次会话内有效」的降级路径）。 */
export function createMemoryBackend(seed: Record<string, string> = {}): KeyValueBackend {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
