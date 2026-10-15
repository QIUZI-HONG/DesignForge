# 对照工具链选型 v0

> 票：`QIUZI-HONG/DesignForge#5`（wayfinder:research）· 日期：2026-10-15 · 状态：**v0 草案，待 #7《前端验收标准与判定线》与 #12《新仓工程化落点》消费**
> 本文件是「差异 → 修复 → 复核 → 关闭」闭环的**工具面**输入；判定线（A/B 分级、阈值拍定）由 #7 出。
> 旧仓只读参照：`DesignForge-legacy` 的 `docs/bench.md`、`docs/agents/implementation-workflow.md`（「断言 + 证据 JSON + 退出码」文化）。
> 本轮所有数字均为**本机实跑**（2026-10-15，WSL2），复现命令见 §8；原始留痕在 `/home/QIU/df-research/_visual-diff-scratch/`（未入仓）。

---

## 0. 结论（先读这段）

### 0.1 选型结论

| 面 | 选型 | 理由（一句话） |
| --- | --- | --- |
| 截图执行 | **playwright-core 1.63.0**（复用 `~/.cache/ms-playwright/chromium-1243`），**显式给 `executablePath`** | 缓存里的 Chromium 还能用（Chrome for Testing 153.0.8010.12），但 1.64.x 只认 revision 1248 → 必须钉版本或显式指定可执行文件（§2.3）|
| 像素比对（主） | **pixelmatch 8.0.0** | 纯 JS、零依赖、无安装门槛；内置**抗锯齿像素检测与忽略**、OKLab HyAB 感知色差；`ignoreMask` 支持按像素遮罩（文本区可排除）|
| 像素比对（可选/加速） | **odiff-bin 4.5.0** | 原生 SIMD，**自带退出码语义**（0 相同 / 22 有像素差 / 21 尺寸不符），`-i x1:y1-x2:y2` 区域忽略、`--aa` 忽略锯齿、`--parsable-stdout` 机读——与旧仓「断言 + 退出码」文化最贴的一把工具（§2.4）|
| 判定与证据框架 | **自建 verify-figma-\* 家族脚本**（照旧仓 verify-\* 先例），**不用** `@playwright/test` 的 `toHaveScreenshot` 作为主判据 | 自建脚本能直出旧仓格式的证据 JSON、退出码 0/1/2、差异包围盒与复验哈希；`toHaveScreenshot` 的基线文件名含浏览器+平台、阈值语义是另一套（默认 0.2），可作**辅助**但会引入第二套口径（§2.5、§6）|
| 归一化基准 | **视口 1440×900 + deviceScaleFactor = 1**，字体以**随应用打包的 webfont** 为准 | 沿用旧仓受控环境口径（bench.md §1）；DPR 与字体是两大噪声源，本机实测已量化（§3.4、§4）|
| 对照方法 | **混合**：几何/色值/静态终态走自动断言；字形/动效/主观质感走人工并排取样（登记为 B 级视觉等价）| 实测：字体替换的 diff 量（5398px）**大于**真实 4px 布局回归（3722px）——不钉字体就无法用像素数判布局（§3.4、§5）|

### 0.2 一句话可行性

**可行，且今天就能跑通**：本机已实跑「缓存 Chromium 截图 → pixelmatch/odiff 比对 → 差异像素数与退出码」全链路（§3）。最大的坑不是工具，而是**字体**：本机**没有 Noto Sans SC**（也无任何 Noto），CJK 靠 `Microsoft YaHei` 系拷贝字体兜底，且**声明缺失时会静默回退**（§4.3）。这直接决定 #7 的 A/B 分级必须把「字形差异」单列。

### 0.3 与 #7 的接口（本报告能拍的三条）

1. **A 级像素等价**可自动断言的对象：布局几何（位置/尺寸/间距/圆角/描边）、纯色与色值、层级遮挡、图标几何（前提：图标资产同源且同为矢量或同图）。
2. **B 级视觉等价**必须人工复核的对象：**一切文本字形**（除非 webfont 已钉死且逐字体文件校验）、抗锯齿边缘、滚动条/光标、动效与过渡（自动截图只能取终态）、阴影与模糊的次像素形态、主观质感。
3. **判定单位建议**：`差异像素数 + 差异包围盒 + 判定等级`，**不要**只用一个「百分比阈值」——百分比会让「大片低对比渐变区微差」淹没「小面积高对比几何错位」。

---

## 1. 票面回执（逐条对齐 #5）

| 票面要求 | 落点 |
| --- | --- |
| 1. 本机可用性核查（node/pnpm/playwright/比对库/归一化要点） | §2、§4 |
| 2. 对照方法对比（自动 / 人工 / 混合）与可行性结论 | §5 |
| 3. 证据与门禁设计输入（门禁清单、证据字段、CI 接线） | §6 |
| 4. 产出《对照工具链选型 v0》 | 本文件 |

---

## 2. 本机可用性清单（实测命令 + 版本号）

实测日期 2026-10-15，WSL2（linux 6.18.33.2-microsoft-standard-WSL2 x64），`nproc` = 24。

### 2.1 运行时

| 工具 | 实际命令 | 结果 | 判定 |
| --- | --- | --- | --- |
| node（PATH 首位） | `node -v` | **v24.9.0**（`/home/QIU/.local/bin/node` → `/home/QIU/.local/lib/node-v24.9.0-linux-x64/bin/node`）| ✅ |
| node（`~/.local/node`） | `~/.local/node/bin/node -v` | **v24.22.0**（票面提到的「新版本」在；比 PATH 里的还新）| ✅ |
| node（系统） | `/usr/bin/node -v` | v22.22.1 | ✅ 可作兜底 |
| node（Windows 侧） | `/mnt/c/Program Files/nodejs/` | 存在（WSL interop）| 注意别误用 |
| pnpm（PATH 首位） | `pnpm -v` | **10.33.2**（corepack shim：`~/.local/bin/pnpm` → `.local/lib/node-v24.9.0.../pnpm.js`）| ✅ |
| pnpm（另一份） | `/usr/local/bin/pnpm -v` | 12.6.0 | ✅ 两份并存 |
| corepack | `~/.local/node/bin/corepack -v` | 0.36.0 | ✅ |
| npm | `npm -v` | 11.6.0 | ✅ |

> **口径提醒**：node/pnpm 各有 3–4 份在不同 PATH 位置（含 Windows 侧）。门禁脚本必须靠**绝对路径或 `engines` + `packageManager` 字段**锁死，否则同一命令在不同 shell 下行为不同。落点：**#12 新仓工程化落点**。

### 2.2 浏览器与截图执行

| 项 | 实测 | 判定 |
| --- | --- | --- |
| Playwright 缓存根 | `~/.cache/ms-playwright/` | ✅ 在 |
| chromium | `chromium-1243/chrome-linux64/chrome` → `Google Chrome for Testing **153.0.8010.12**`（393 MB）| ✅ 在 |
| chromium-headless-shell | `chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`（261 MB）| ✅ 在 |
| ffmpeg | `ffmpeg-1011`（4.9 MB）| ✅ |
| 安装完成标记 | `INSTALLATION_COMPLETE`、`DEPENDENCIES_VALIDATED` 均在 `chromium_headless_shell-1243/` | ✅ 依赖已校验 |
| `.links/` 登记 | 2 条：`/home/QIU/TravelPulse/.venv/.../python playwright`、`/home/QIU/OpenDesign/node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core` | ⚠️ 后者路径**已不存在**（OpenDesign 的 node_modules 已清）→ 该 link 是**陈旧登记** |
| 截图实跑 | playwright-core 1.64.1 + `executablePath` 指向缓存 chrome | ✅ **成功**，`browser.version() = 153.0.8010.12`，1440×900 DPR1 截图 21–22 KB |

> 旧仓 bench.md §6 的浏览器探测顺序（`BENCH_CHROME_EXECUTABLE` → 缓存 `chromium-*` → 系统 Chrome）**可直接移植**，且本机实测证明**必须走「显式 executablePath」这条路**（见 2.3）。

### 2.3 ⚠️ 关键坑：playwright 版本 ↔ chromium revision 不匹配

| playwright-core | `browsers.json` 期望 revision | 本机缓存 | 结果 |
| --- | --- | --- | --- |
| 1.64.1（npm latest） | chromium **1248** / headless-shell 1248 | 只有 **1243** | ❌ 默认启动失败 |
| 1.64.0 | chromium **1248** | 只有 1243 | ❌ |
| 1.62.1 | chromium 1234 | 只有 1243 | ❌ |
| **1.63.0** | chromium **1243** | **1243** ✅ | ✅ **匹配** |

默认启动的真实报错（实测，`playwright-core@1.64.1`）：

```
browserType.launch: Executable doesn't exist at
/home/QIU/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
→ Looks like Playwright was just installed or updated.
```

**三条出路（推荐 A）**：

| 方案 | 做法 | 代价 | 备注 |
| --- | --- | --- | --- |
| **A（推荐）** | 任何 playwright-core 版本 + `launch({ executablePath: '<缓存>/chrome-linux64/chrome' })` | 零下载；需自行维护探测逻辑 | 旧仓 bench.md §6 探测顺序就是这个形状；**实测可行** |
| B | 钉 `playwright-core@1.63.0`，让默认解析命中 1243 | 版本被绑；升级 playwright 就要同步下载浏览器 | 干净但脆 |
| C | `npx playwright install chromium`（下 1248）| ~650 MB 下载（缓存 393+261 MB 的同量级），需网络 | 一次性，但打破「本机零网络」前提 |

> 「推断」：`.links` 里 1.64.0 的登记与缓存 1243 不匹配，说明缓存**不是**由 1.64.0 装的，而由更早的 1.63.x 装（1234→1243 的跃迁在 1.62→1.63 之间，1.62.1 = 1234 已实测）。

### 2.4 比对库（npm 可用性 + 本地实跑）

| 包 | npm 版本 | 本地安装/实跑 | 关键事实（来自本机安装的包内文档/源码，非二手）|
| --- | --- | --- | --- |
| **pixelmatch** | **8.0.0** | ✅ 实跑 | ISC、**零依赖**、~几百行；`threshold` 默认 **0.1**（OKLab **HyAB** 感知色差，1 = 黑白之差）；`includeAA` 默认 `false` = **默认检测并忽略抗锯齿像素**；另可 `ignoreMask`（每像素一个字节，非零即跳过）、`windowSize`（N×N 滑窗最大差像素数，比全局百分比更能抓「小面积高对比错位」）、`diffMask`/`diffColorAlt`（区分增减）|
| **odiff-bin** | **4.5.0** | ✅ 实跑 | 原生 SIMD 二进制（`@odiff/linux-x64`）；**退出码**：`0` 相同 / `22` 有像素差 / `21` 尺寸不符（后者需 `--fail-on-layout`）；`-t/--threshold` 默认 0.1；`--aa` 忽略抗锯齿；`-i x1:y1-x2:y2` **区域忽略**；`--parsable-stdout`、`--server`（stdin JSON）机读模式 |
| pngjs | 7.0.0 | ✅ 实跑（解码/编码） | 与 pixelmatch 配套的纯 JS PNG 读写 |
| sharp | 0.35.5 | npm 可装（未实跑） | 需要时做重采样/裁剪/合成（如把 Figma 导出稿缩放到视口尺寸）|
| @playwright/test | 1.64.1 | npm 可装（未装） | 见 §2.5 |
| playwright-core | 1.64.1 | ✅ 实跑 | 截图与浏览器驱动的执行面 |

> `npm view` 全部命中 registry（这些包的版本号即 registry 查询结果，本机 npm 11.6.0，网络通）。

### 2.5 `toHaveScreenshot` 的定位（辅助，不作主判据）

Playwright 官方文档（`playwright.dev/docs/test-snapshots`）给出的事实：`threshold` 默认 **0.2**、「可接受的感知色差，0 严格 / 1 宽松」；`maxDiffPixels`「可接受的不同像素量，默认不设」；基线更新走 `--update-snapshots`；**基线文件名含浏览器名与平台名**（例：`example-test-1-chromium-darwin.png`），官方明说「渲染因浏览器与平台而异（不同渲染、字体等）」，并要求「在生成基线的同一环境里跑测试」；警告渲染会随宿主 OS、版本、设置、硬件、电源、headless 与否而变。

**结论**：它是「基线 + 自动更新」的现成实现，但**口径与旧仓不同**（阈值为 0.2、`maxDiffPixels` 语义、跨平台基线分裂）。若同时引入 pixelmatch 口径与它，会出现两套阈值语义对抗。**建议**：主判据走自建脚本（pixelmatch/odiff，口径自主、证据 JSON 自定、退出码自控）；`toHaveScreenshot` 仅在 #7 判定线定稿后、作为**交互态用例**的便捷补充被评估（「推断」：它对「逐元素对照」的裁剪能力不如自建 `clip` 截图直接）。

---

## 3. 实测证据（本轮自跑，可复现）

### 3.1 实验构造

对照页 `page-a.html`（1440×900 白底）：一个 `#3B82F6` 圆角方块（`left:100px; top:100px; 200×120; radius 8px`）+ 两行中文文本（24px 标题 / 14px 副标题，`font-family:"Microsoft YaHei"`）。
变体：`page-b`（方块 `left:104px`、色 `#4B8BF6`、标题 `24.5px`）、`page-c`（字体换 `SimHei`）、`page-d`（字体声明为无 CJK 字形的 `DejaVu Sans`）。

### 3.2 确定性与灵敏度（pixelmatch，1440×900，DPR1）

| 用例 | 差异像素 | 占比 | 读法 |
| --- | --- | --- | --- |
| 同页两次截图 `a1` vs `a2` | **0** | 0 | ✅ **确定性成立**：同机同轮重复截图**字节相同**（21887 B），diff 为 0 |
| `a1` vs `b1`（方块 +4px、色变、字号 +0.5px）| **3722** | 0.287% | ✅ **灵敏度足够**：4px 位移级改动被清晰捕获 |
| `a1` vs `c1`（同一文案，YaHei → SimHei）| **5398** | 0.417% | ⚠️ **字形噪声 > 真实布局回归**（见表下） |
| `a1` vs `d1`（声明 DejaVu Sans，静默回退）| 3779 | 0.291% | ⚠️ 回退与真实改动**同量级**，肉眼几乎不可辨 |
| `a1` vs `a_dpr2`（DPR1 vs DPR2）| — | — | ✅ **尺寸守卫生效**：1440×900 vs 2880×1800 → 立即报 size-mismatch，不会静默错比 |

**最重要的一个数字**：字形替换产生的差异像素（5398）**大于**真实「4px 位移 + 变色 + 字号变化」（3722）。推论（「推断」，但由本机数字直接支撑）：**如果不把字体钉死，像素差异数就无法区分「布局回归」与「字体漂移」** —— 这是 #7 A/B 分级必须把字形单列为 B 级的**量化依据**。

### 3.3 阈值扫描（同一对图 `a1` vs `b1`）

| `threshold` | 差异像素 | 占比 | 备注 |
| --- | --- | --- | --- |
| **0** | **27380** | 2.113% | 🚫 全为抗锯齿噪声：是 0.1 档的 **7.4 倍** |
| 0.05 | 3800 | 0.293% | |
| 0.1（默认）| 3722 | 0.287% | ✅ 建议起点 |
| 0.2 | 3452 | 0.266% | 与 Playwright `toHaveScreenshot` 默认同档 |
| 0.3 | 3183 | 0.246% | 接近「丢真差异」的边缘 |

结论：**`threshold: 0` 不可用于门禁**（抗锯齿会淹没信号）；0.1 是有依据的默认起点，#7 拍定终值时应带这组数字。

### 3.4 odiff vs pixelmatch（口径不可互换）

| 工具（同一对 `a1`/`b1`）| 输出 | 退出码 |
| --- | --- | --- |
| pixelmatch 8.0.0（threshold 0.1，`includeAA:false`）| `3722` 差异像素 | 由脚本自定 |
| odiff 4.5.0（`--threshold 0.1`）| `Found 4610 different pixels (0.36%)` | **22** |
| odiff（同一对相同图）| `Images are identical` | **0** |

两个库对同一对图给出 **3722 vs 4610**（差 24%）——因为抗锯齿判定算法不同（pixelmatch 用「强度斜率 + 3+ 同色兄弟」启发式；odiff 有自己的 AA 路径）。推论：**门禁一旦选了库，差异计数就绑定在该库的版本上**；升级比对库 = 重定基线（照旧仓「锁步对齐实际运行时」的教训）。

### 3.5 渲染事实（字体）

| 页面 | 声明字体 | 计算宽度（标题）| 文本带墨迹像素 | 说明 |
| --- | --- | --- | --- | --- |
| a/c | Microsoft YaHei | 235.98 px | 6410 | 正常渲染 |
| c | SimHei | 264.00 px | 5625 | 同文案**宽度差 28px** → 字形宽度不一致会直接改变布局 |
| d | DejaVu Sans（无 CJK 字形）| 238.89 px | 6342 | ⚠️ **静默回退**：墨迹量与 YaHei 几乎一样（肉眼难辨），但 diff 3779 px |

---

## 4. 截图归一化要点（票面第 1 条后半）

### 4.1 视口与 DPR（硬约束）

- **基准：1440×900、`deviceScaleFactor = 1`** —— 沿用旧仓 bench.md §1 受控环境口径，本机实测可复现。
- DPR 必须显式固定：DPR2 → 截图 2880×1800，与基线**尺寸不符**（实测已触发守卫）。三方都要对齐：命令行 `--force-device-scale-factor`、`newContext({ deviceScaleFactor })`、以及截图 `scale: 'css' | 'device'`（Playwright 提供该选项，默认 `'device'`）。
- 断点档（#7 提到 1280 / 1023 / 767）：每档**各自一套基线**，不与 1440×900 混存。

### 4.2 确定性开关（全部来自本机 playwright-core 类型定义）

| 开关 | 取值 | 作用 |
| --- | --- | --- |
| `animations` | `'disabled'` | 停 CSS 动画/过渡/Web Animations（有限动画快进到终点、无限动画回初始态）→ **但只能测终态，动效本身测不了**（§5）|
| `caret` | 默认 `'hide'` | 隐藏文本光标（避免闪烁 caret 入图）|
| `mask` / `maskColor` | 传 Locator 数组 | 元素位置涂成纯色块（默认粉色）→ 遮时间戳/头像/随机图等**非确定元素** |
| `clip` | `{x,y,width,height}` | **逐元素对照的关键**：按包围盒裁图，让「元素级 diff」成为 `clip` + 两次截图 |
| `style` | CSS 字符串 | 截图前注入样式（如隐藏滚动条、关阴影）|
| `colorScheme` / `reducedMotion` / `forcedColors` / `locale` / `timezoneId` / `userAgent` / `hasTouch` / `isMobile` / `offline` | 固定取值 | 上下文级环境钉死（避免宿主机偏好泄漏进渲染）|

### 4.3 字体（本机最大的不确定性）

- **本机字体清单（实测）**：无 Noto、无任何 CJK 专用字体；CJK 实际来自 `~/.local/share/fonts/` 的**拷贝自 Windows 的字体**：`msyh.ttc`（Microsoft YaHei / UI）、`msyhbd.ttc`（Bold）、`simhei.ttf`（SimHei）。其他为 DejaVu / Liberation / Ubuntu 系。
- `fc-match "sans-serif:lang=zh-cn"` → **`msyh.ttc`（Microsoft YaHei）**；`fc-match "Noto Sans CJK SC"` → **DejaVu Sans**（= 该字体不存在）。
- **与 #7 提到的先例冲突**：票面写「沿用先例『Noto Sans SC 字形差异登记为视觉等价而非像素等价』」，但本机**没有** Noto Sans SC。两条出路：
  - (a) **把 Noto Sans SC（woff2, subset）随应用打包**，并在截图前 `await document.fonts.ready` + 校验 `document.fonts.check()`（**推荐**：渲染进入版本控制，跨机一致，字形差异从「不可控」变「可控」）；
  - (b) 继续用系统字体兜底 → 那么**每一次字体替换都必须登记为 B 级视觉等价**，且 A 级像素断言必须用 `mask`/`ignoreMask` **排除全部文本区域**（实测：文本区墨迹 ~6400 px，是有效信号的主要载体）。
- **「推断」**：Figma 本体在其自有渲染（Skia）里的字形度量与 Chromium 不同，即使同为 Noto Sans SC，行高/字距也可能有 1px 级差异 → **文本块的 A 级比对建议落在「文本框几何（位置/尺寸/行高）」而非「字形像素」**。

### 4.4 其他噪声源清单（供 #7 写判定线时逐条裁）

平台/hinting 差异 · 滚动条（overlay 与否、宽度随平台）· 图片解码（AVIF/WebP 路径）· 字体平滑（LCD subpixel vs grayscale，本机 headless 走软件光栅 SwiftShader）· 阴影/模糊的次像素扩散 · 反向代理/压缩导致的原图重采样 · 网络字体加载时序（未 `fonts.ready` 就截图）· 时间/随机 ID/头像等非确定内容。

---

## 5. 对照方法对比（票面第 2 条）

### 5.1 三类方法

| 方法 | 做法 | 本机成本 | 覆盖差异类型 |
| --- | --- | --- | --- |
| **A 自动截图 diff** | Playwright 截图 → pixelmatch/odiff → 差异像素数/包围盒/退出码 | 低（秒级/页）| 几何、色值、层序、静态终态 |
| **B 人工并排取样** | 参考图与实现图并排（side-by-side）+ 叠加/差分图，人眼逐区过 | 高（分钟级/页）| 字形、抗锯齿、阴影质感、动效节奏、主观一致度 |
| **C 混合（推荐）** | A 做**回归哨兵**（对已裁定的基线持续守线），B 做**首轮裁定与主观面** | 中 | 全 |

### 5.2 逐类差异的判定归属（建议给 #7 的输入）

| 差异类型 | 自动可断言？ | 依据 |
| --- | --- | --- |
| 布局几何（位置/尺寸/间距/圆角/描边）| ✅ **A 级** | 实测 4px 位移/色变 → 3722 px 稳定捕获 |
| 纯色与色值 | ✅ **A 级** | 同上；且可用局部取样（旧仓 §9.4 ② 已有「读中心像素」先例）|
| 层级/遮挡顺序 | ✅ **A 级** | 像素结果直接反映 |
| 图标几何 | ⚠️ 条件 A 级 | 需图标资产同源（同 SVG/同图）；换成等价但不同源的图标 → 必然大 diff |
| **文本字形/字距** | ❌ **B 级** | 实测字形替换 5398 px > 真实布局回归 3722 px |
| **抗锯齿边缘** | ❌ **B 级** | 实测 threshold 0 时噪声放大 7.4 倍；库间差异 24% |
| 滚动条 / 光标 / caret | ❌ **B 级**（或遮罩排除）| 平台相关；`caret` 默认已 hide |
| **动效/过渡/悬停瞬态** | ❌ **B 级** | `animations:'disabled'` 只能取终态；帧序列比对是另一套工具（**缺口**，见 §7）|
| 阴影/模糊质感、主观「像不像 Figma」| ❌ **B 级** | 无可判定的机读口径 |
| 响应式断点（1280/1023/767）| ✅ A 级（逐档独立基线）| 每档各自截图比对 |

### 5.3 可行性结论

1. **自动断言可行且已实测**：几何/色值/层序/静态终态 → 差异像素数 + 包围盒 + 退出码，配套旧仓式证据 JSON（§6）。
2. **人工复核不可省**：字形、抗锯齿、动效、主观质感必须人工签字（登记为 B 级视觉等价），**且必须有「谁在何时凭什么豁免」的字段**（§6.2），否则豁免会变成橡皮图章。
3. **闭环可跟踪的机制**：把「参考图基线的哈希 + 实现截图哈希 + 差异图哈希 + 判定等级 + 豁免理由」写进证据 JSON 并入库 —— 复验时哈希不变即为「未被悄悄改口径」（照旧仓「大件换 sha256 指纹」的约定）。
4. **逐页 / 逐组件 / 逐元素三粒度**同一套工具即可：页 = 整视口截图；组件 = Locator 包围盒 `clip`；元素 = 更小 `clip` + 局部取样。**无需**三套机制（「推断」：Playwright 的 `locator.screenshot()` 与 `clip` 等价，选一即可）。

---

## 6. 证据与门禁设计输入（票面第 3 条）

### 6.1 门禁清单草案（verify-figma-\* 家族）

照旧仓 `verify-*` 命名与「自起依赖 + 端口预检 + 退出码 0/1/2 + 证据 JSON」的形状（bench.md §8.6/§9.5 已固化），设界侧建议：

| 门禁 | 判什么 | 跑在哪 | 依赖 |
| --- | --- | --- | --- |
| `verify-figma-page` | 逐页整视口对照：对每个页面 × 每个视口档，出差异像素/包围盒/等级 | 本地受控（绝对阈值）| 生产构建 + 参考图基线 |
| `verify-figma-component` | 逐组件（`clip` 到 Locator 包围盒）：几何/色值/状态 | 本地受控 | 同上 + 组件用例清单（#8 出）|
| `verify-figma-element` | 逐元素：单点色值 + 小区域裁图（照旧仓「读中心像素」先例）| 本地受控 | 同上 |
| `verify-figma-states` | 状态矩阵：hover / active / disabled / loading / empty / error | 本地受控（`animations:'disabled'`）| 交互驱动脚本 |
| `verify-figma-diff-gate` | **汇总门**：读以上证据 JSON，按 #7 判定线给 `PASS/FAIL/NEEDS-HUMAN`，出总退出码 | 本地 + CI（宽松哨兵）| 全部证据文件 |
| `verify-figma-baseline` | **基线卫生**：哈希清单校验（基线文件未被无记录改动）、参考图与 `docs/` 参照的对应关系 | CI 可跑（纯文件校验）| 基线目录 + 清单 |

> 命名可议（`figma` 还是 `ref` 前缀，取决于 #7/#8 定稿是否把「Figma 本体截图」正式作为参考源）；门禁的**形状**（自起依赖、端口预检、退出码、证据 JSON）建议照旧仓固化，不重新发明。

### 6.2 证据 JSON 字段草案

照旧仓约定（`docs/bench-data/<name>-<ts>.json`、判定面数据原样保留、大件换 `{sha256,length}` 指纹、每条断言带 `id/ok/expected/actual/note`）：

```jsonc
{
  "ok": false,                      // 顶层：门禁自身是否跑通（照旧仓 probe 先例：顶层 ok 表示「探针跑通」）
  "gate": "verify-figma-component",
  "script": "scripts/figma/verify-component.ts",
  "ts": "2026-10-15T22:40:00+08:00",
  "env": {                          // 受控环境快照（bench.md §1 的机器可读版）
    "host": "wsl2", "node": "v24.9.0", "pnpm": "10.33.2",
    "browser": "153.0.8010.12", "browserPath": "~/.cache/ms-playwright/chromium-1243",
    "viewport": [1440, 900], "dpr": 1,
    "commit": "<git sha>", "build": "production",
    "fonts": { "declared": "Noto Sans SC", "resolved": "msyh.ttc", "check": true }
  },
  "params": { "threshold": 0.1, "engine": "pixelmatch@8.0.0", "aaIgnore": true },
  "checks": [                       // 逐元素/逐组件一条
    {
      "id": "hero.title.geometry",
      "ok": true,
      "level": "A-pixel",           // A-pixel | B-visual-equivalent
      "expected": { "box": [100, 100, 200, 120] },
      "actual":   { "box": [100, 100, 200, 120] },
      "diff": { "pixels": 0, "ratio": 0, "bbox": null, "threshold": 0.1,
                "diffImage": { "sha256": "...", "length": 21887 } },
      "artifacts": {
        "baseline": { "path": "docs/figma-baselines/hero.png", "sha256": "..." },
        "actual":   { "path": "docs/figma-data/hero-actual.png", "sha256": "..." }
      },
      "note": ""
    },
    {
      "id": "hero.title.glyph",
      "ok": false,
      "level": "B-visual-equivalent",   // 字形：不参与机读判定，转人工
      "diff": { "pixels": 5398, "ratio": 0.0042, "bbox": [100, 258, 340, 30] },
      "humanReview": { "required": true, "verdict": "pending",
                       "reviewer": null, "reviewedAt": null,
                       "reason": "引用字体与 Figma 渲染字形差异（先例：Noto Sans SC）" }
    }
  ],
  "summary": { "total": 12, "passed": 10, "failed": 1, "needsHuman": 1 },
  "exitCode": 1                     // 0 全绿 / 1 有 FAIL / 2 环境或前置失败（照旧仓三态）
}
```

要点（每条都有旧仓先例）：
- **退出码三态 0/1/2**：0 全绿、1 判定失败、2 环境/前置失败（旧仓 `verify-collab`/`verify-ai` 的「端口被占立即退出码 2」）。
- **复验哈希**：基线/实现/差异图各存 `{sha256,length}`（旧仓 §8.6 末尾「证据体积约定」正是这么做的：整份 2.3MB → 84KB）。
- **判定等级字段 `level`**：A/B 分级落在**每条断言**上，而不只是文档里的一句话 —— #7 的判定线由此机器可读。
- **人工复核位 `humanReview`**：`verdict: pending|pass|waived|fail` + 复核人 + 时间 + 理由 → 「差异 → 修复 → 复核 → 关闭」的闭环状态机（旧仓有 `notes` 字段声明「未验（待人工）」的先例）。
- **`env.fonts`**：把「声明字体 vs 实际解析字体」钉进证据（本机实测证明这是最大噪声源）。

### 6.3 CI 接线方式

沿用旧仓两条硬教训：**「CI 只做宽松硬顶，绝对阈值不在 CI 判」**（bench.md §2.1/§2.2、§8.6 的 `--ci` 只放哨兵），以及「推送后必须读 CI 结果」：

| 内容 | 进 CI？ | 理由 |
| --- | --- | --- |
| 基线哈希清单校验（`verify-figma-baseline`）| ✅ **进** | 纯文件校验，零渲染依赖，能抓「基线被悄悄改」 |
| 页面可渲染 + 关键元素几何存在（DOM/`boundingBox` 断言）| ✅ **进** | 不依赖像素/字体，等价旧仓 `bench:verify-canvas` 的定位 |
| 逐页像素 diff **绝对阈值** | ❌ **不进**（仅本地受控）| 跨 OS/字体/hinting 漂移是已知事实（Playwright 官方警告 + 本机实测）|
| 逐页像素 diff **宽松哨兵**（如 `maxDiffPixelRatio` 放到极大，只抓「整页白屏/大量元素丢失」）| ⚠️ 可选 | 照 `--ci` 先例；需先有稳定基线 |
| 状态矩阵、动效终态 | ❌ 不进（本地/手动）| 需交互驱动 + 稳定渲染环境 |
| 证据 JSON 归档（含人工复核位）| ✅ 进（作为 artifact 上传）| 闭环可跟踪的载体 |

> 前置事实：**新仓当前只有文档、无 `package.json`/无 CI**（`git log` 仅 1 个初始化提交；`AGENTS.md` 只有三个技能约定）。所以「CI 接线」本节是**设计输入**，#12 落工程化时消费。

---

## 7. 缺口与后续验证项

| # | 缺口 / 待验 | 为什么重要 | 建议动作 |
| --- | --- | --- | --- |
| G1 | **动效/过渡的自动对照手段未选型** | 票面要「逐元素对照」但动效是 B 级人工项；`animations:'disabled'` 只能取终态 | 单列一票研究（截图序列 + 帧间 diff？视觉回归的动画支持普遍弱）|
| G2 | **参考图来源与版权口径未定** | 判据是「与 Figma 本体逐页对照」，但参照图怎么取得、能否入仓 | 由 #2《Figma 本体页面盘点与参照采集》覆盖 → 本报告只依赖「有基线与哈希」 |
| G3 | **Noto Sans SC 的获取/打包未定** | 本机无该字体，A/B 分级与渲染确定性都挂在它上面 | #7 判定线拍定后：webfont 入仓（subset woff2）或明示「系统字体 + 字形差异登记 B 级」|
| G4 | **本机 headed（WSLg `DISPLAY=:0`）截图未实测** | 若某些渲染（阴影/模糊/合成）在 headed 与 headless 不同 | 门禁统一 headless（旧仓先例）；headed 仅调试用，需一次对照实测 |
| G5 | **`pnpm`/`node` 多版本共存未收口** | 同命令在不同 shell 可能用不同版本（4 份 node、3 份 pnpm）| #12 落 `packageManager` + `engines` + 脚本内绝对路径 |
| G6 | **阈值终值未拍** | 本报告给了扫描（0/0.05/0.1/0.2/0.3）与默认建议 0.1 | #7 按分级元素清单逐类拍；建议用 `windowSize` 或「包围盒面积」补充全局百分比 |
| G7 | **图标资产的对照口径未定** | 图标几何是 A 级候选，但「等价不同源图标」必然大 diff | #7 明确「同源资产才判 A 级」；否则登记 B 级 |
| G8 | **CI 运行环境未定** | 像素绝对阈值不进 CI → 需要「本地受控机」的角色定义 | #12 落定；建议与旧仓一致：绝对判定只在本机受控环境跑，CI 只哨兵 |
| G9 | **截图存储策略未定** | 每页每档位每状态的 PNG 会快速膨胀（本机单图 21–53 KB，整页实景更大）| 照旧仓「大件换 sha256 指纹」：只入仓**基线**与**差异图**，实现截图按需重生成 |
| G10 | **odiff 的 `--aa` 默认行为未逐档实测** | odiff 与 pixelmatch 计数差 24%，选哪个 `--aa` 会再改口径 | 若选 odiff 作主判据，补一轮 `--aa` 开/关的对照表 |
| G11 | **旧仓 `docs/bench.md` 中的「复刻计时」人工口径与「逐页对照」的关系未理** | 一个是 8 分钟复刻计时，一个是视觉验收，文化与工具不同 | 明确两者并存（复刻计时属性能验收，不在本报告范围）|

**未做（如实登记）**：未在真实应用页面上跑过对照（新仓尚无应用代码）；未测 `sharp`、未测 `@playwright/test` 实跑、未测 headed 模式、未测多档断点、未测 CI。

---

## 8. 复现命令（本轮实测的完整路径）

```bash
# 工作目录（本报告实验区，未入仓）
mkdir -p /home/QIU/df-research/_visual-diff-scratch && cd /home/QIU/df-research/_visual-diff-scratch
npm init -y && npm i playwright-core@1.64.1 pixelmatch@8.0.0 pngjs@7.0.0 odiff-bin@4.5.0

# 版本与 revision 核对
node -e "const b=require('playwright-core/browsers.json');console.log(b.browsers.find(x=>x.name==='chromium').revision)"   # → 1248（缓存是 1243 → 用 executablePath）
ls ~/.cache/ms-playwright/                                                                  # chromium-1243 / chromium_headless_shell-1243 / ffmpeg-1011
~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome --version                        # Google Chrome for Testing 153.0.8010.12

# 截图（显式 executablePath；1440×900、DPR1、animations 关、等字体就绪）—— 见附录 A
node shot.mjs a1.png /path/page-a.html 1
node shot.mjs a_dpr2.png /path/page-a.html 2        # → 2880×1800，验证尺寸守卫

# 比对
node diff.mjs a1.png a2.png 0.1                     # → diffPixels 0（确定性）
node diff.mjs a1.png b1.png 0.1                     # → diffPixels 3722（灵敏度）
./node_modules/.bin/odiff a1.png b1.png out.png --threshold 0.1 ; echo "exit=$?"   # → exit 22
./node_modules/.bin/odiff a1.png a2.png out.png --threshold 0.1 ; echo "exit=$?"   # → exit 0
```

（§8 引用的 `shot.mjs` / `diff.mjs` 全文见附录 A；四份 HTML、十张 PNG、日志均在 `/home/QIU/df-research/_visual-diff-scratch/`，如需入仓请另立票定存储策略——见 G9。）

---

## 附录 A：本轮实验脚本（可移植骨架，#12 可据此起 verify-figma-\* 的截图/比对层）

`shot.mjs` —— 截图（显式 executablePath、固定视口与 DPR、等字体就绪）：

```js
import { chromium } from 'playwright-core';
const [, , out, url, dprArg, dsfArg] = process.argv;
const dpr = Number(dprArg || 1);
const EXE = process.env.CHROME || '/home/QIU/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath: EXE,                                        // ← 必给：1.64.x 默认解析 1248，缓存是 1243
  args: ['--no-sandbox', ...(dsfArg ? [] : ['--force-device-scale-factor=' + dpr])],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
await page.goto('file://' + url);
await page.evaluate(() => document.fonts.ready);              // ← 等字体，否则时序噪声
const img = await page.screenshot({ path: out, animations: 'disabled' });
console.log(JSON.stringify({ out, dpr, browser: browser.version(), bytes: img.length }));
await browser.close();
```

`diff.mjs` —— pixelmatch 比对（尺寸守卫 + 阈值参数化 + 差异图落盘）：

```js
import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
const [, , fA, fB, thrArg, outDiff] = process.argv;
const a = PNG.sync.read(fs.readFileSync(fA));
const b = PNG.sync.read(fs.readFileSync(fB));
if (a.width !== b.width || a.height !== b.height) {           // ← DPR/视口跑偏时立即可见
  console.log(JSON.stringify({ error: 'size-mismatch', a: [a.width, a.height], b: [b.width, b.height] }));
  process.exit(1);
}
const { width, height } = a;
const diff = new PNG({ width, height });
const n = pixelmatch(a.data, b.data, diff.data, width, height,
  { threshold: Number(thrArg ?? 0.1), includeAA: false });      // ← threshold 0 禁用；AA 默认忽略
if (outDiff) fs.writeFileSync(outDiff, PNG.sync.write(diff));
console.log(JSON.stringify({ size: [width, height], diffPixels: n, diffRatio: +(n / (width * height)).toFixed(6) }));
```

---

## 9. 来源清单

**一手来源（本机实跑，2026-10-15）**
1. 本机 `node/pnpm/npm` 版本输出（§2.1）。
2. `~/.cache/ms-playwright/` 目录清单、`INSTALLATION_COMPLETE`/`DEPENDENCIES_VALIDATED` 标记、`chrome --version`、`.links/` 登记（§2.2）。
3. 本机安装的 `playwright-core@1.64.1` / `@1.64.0` / `@1.63.0` / `@1.62.1` 各自 `browsers.json` 的 `revision`（§2.3）。
4. 默认启动失败的真实报错（§2.3）。
5. 本机安装的 `pixelmatch@8.0.0` 的 `README.md` 与 `index.js` JSDoc/源码（threshold、includeAA、ignoreMask、windowSize 语义）（§2.4）。
6. `odiff@4.5.0 --help`（退出码表、`--aa`、`-i`、`--parsable-stdout`）（§2.4）。
7. 本机 `playwright-core/types/types.d.ts` 中 `PageScreenshotOptions` 与 `BrowserContextOptions`（`animations`/`caret`/`mask`/`clip`/`style`/`scale`/`colorScheme`/`locale`/`timezoneId` 等）（§4.2）。
8. `fc-list` / `fc-match` 输出与 `~/.local/share/fonts/` 字体文件清单（§4.3）。
9. 本报告 §3 的全部差异像素数字（`pixelmatch`/`odiff` 实跑输出、阈值扫描、ink 分析）。

**一手来源（远程）**
10. Playwright 官方文档 `https://playwright.dev/docs/test-snapshots`：`threshold` 默认 0.2、`maxDiffPixels`、`--update-snapshots`、基线文件名含浏览器+平台、跨环境渲染差异警告（§2.5）。
11. npm registry（`npm view`）：pixelmatch 8.0.0 / odiff-bin 4.5.0 / playwright-core 1.64.1 / pngjs 7.0.0 / sharp 0.35.5 / @playwright/test 1.64.1（§2.4）。

**旧仓只读参照（`QIUZI-HONG/DesignForge-legacy`）**
12. `docs/bench.md`（经 `gh api` 读取）：§1 受控环境清单（1440×900、DPR1、Chrome for Testing 153.0.8010.12、chromium-1243、中位数不取 min）、§2.1/§2.2 CI 宽硬顶与「绝对阈值不在 CI 判」、§5.3 画布装配 6 断言、§6 浏览器探测顺序与复现命令速查、§8.6/§9.5 门禁形状（自起依赖、端口预检、退出码 0/1/2、反例探针、证据体积约定 `{sha256,length}`）、§9.4 ②「读中心像素」先例、§9.5 ④ 反例鉴别力探针。
13. `docs/agents/implementation-workflow.md`：一票一工作树、推送走 SSH、推送后必须读 CI 结果、浏览器验收门禁清单（verify-canvas/e2e:smoke/collab-verify-\*）、半成品提交用 `--no-verify`。
14. `DesignForge` 票面：#1（寻路图：前端验收机制 + 对照页面清单 + 判定线）、#5（本票）、#7（A/B 分级、响应式档位、证据与复验闭环、Noto Sans SC 先例）、#8、#12（新仓工程化落点）。

**标注说明**：文中凡标「推断」者为基于实测数字的推论而非直接观测；未实测项已在 §7「未做」逐条登记。
