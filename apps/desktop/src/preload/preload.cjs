/**
 * 壳 → 渲染进程的 preload（**必须 CJS**：Electron 沙箱 preload 不走 ESM 加载器）。
 *
 * 口径：`contextIsolation: true` + `sandbox: true` 下，渲染进程**只能**看到这里显式挂上的只读壳信息；
 * 本地能力（文档读写 / AI / 导出）后续一律经此白名单走 IPC 或 daemon——「与 daemon 的本地连接口径预留」
 * （issue #25）即指此处：接口形状先立住，握手全量属圈外。
 */
const { contextBridge } = require('electron');

/** 只读壳信息；键名变更视为接口变更（渲染侧据此判读运行环境）。 */
contextBridge.exposeInMainWorld('dforgeShell', {
  /** 壳标识（与 @dforge/desktop 包名一致，供渲染侧判「是否在壳内」）。 */
  runtime: '@dforge/desktop',
  /** Electron / Chromium / Node 版本（诊断页与证据用）。 */
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** 平台标识（本地优先口径下用于路径与快捷键分支）。 */
  platform: process.platform,
  /**
   * 安全开关的**运行时**实测（壳自检用；只读布尔，不构成攻击面）。
   *
   * 为什么放在 preload：这两个标志只有 preload 里的 `process` 才权威（渲染页面看不出来）。
   * Electron 44 已无 `webContents.getLastWebPreferences()`（票面写法对不上实现），
   * 故运行时口径 = preload 侧 sandbox/contextIsolation + 页面侧「无 Node 全局」+ 跨源探针（见主进程）。
   */
  security: {
    contextIsolated: process.contextIsolated === true,
    sandboxed: process.sandboxed === true,
  },
});
