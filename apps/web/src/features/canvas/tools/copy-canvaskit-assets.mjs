#!/usr/bin/env node
/**
 * 复制 CanvasKit 运行时资产到 `public/canvaskit/`（FE-06）。
 *
 * 为什么走「复制到 public + script 标签加载」而不是打包器 import：
 * - CanvasKit 的 emscripten 胶水脚本对打包器不友好（wasm 定位要靠 `locateFile`），
 *   public + 显式 script 标签是最稳的一条路，且在 `next dev` / `next start` / 静态导出三种形态下行为一致；
 * - 资产是**第三方二进制**（wasm 7.3MB + 字体 3.5MB），不入 Git（`.gitignore` 排除），
 *   由本脚本从 node_modules 复制——版本漂移只可能来自 lockfile。
 *
 * 字体：Noto Sans SC（ADR-0003 离线捆绑）的 woff2 播子集。
 * 为什么用「单文件 chinese-simplified + latin」而不是逐 unicode-range 切片：
 * CanvasKit 的 FontMgr 按**字形覆盖**做回退，单文件即可覆盖 CJK 全量，切片反而要注册上百个 buffer。
 * 依赖侧不做 woff2→ttf 转码——CanvasKit 的 FreeType 直接支持 woff2（已在 0.42.0 上验证）。
 *
 * 用法：`node src/features/canvas/tools/copy-canvaskit-assets.mjs`（幂等；已在且大小一致则跳过）。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 资产目标目录：apps/web/public/canvaskit（Next 静态服务根：/canvaskit/*）。 */
const OUT_DIR = resolve(HERE, '../../../../public/canvaskit');
const FONT_OUT_DIR = join(OUT_DIR, 'fonts');

const require = createRequire(import.meta.url);
/** 解析依赖内文件（pnpm 软链下 require.resolve 给出真实路径）。 */
function resolveFromPackage(specifier) {
  return require.resolve(specifier);
}

/** 字重档：与 `apps/web/src/app/layout.tsx` 引入的 400/500/700 对齐。 */
const FONT_WEIGHTS = [400, 500, 700];
/** 子集文件：CJK 全量 + 拉丁（ASCII 与标点）。 */
const FONT_SUBSETS = ['chinese-simplified', 'latin'];

/** 幂等复制：目标已存在且字节数一致即跳过。 */
function copyFile(sourcePath, targetPath) {
  const size = statSync(sourcePath).size;
  try {
    if (statSync(targetPath).size === size) return { skipped: true, size };
  } catch {
    // 目标不存在：走复制
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(sourcePath));
  return { skipped: false, size };
}

const canvasKitDir = dirname(resolveFromPackage('canvaskit-wasm/bin/canvaskit.js'));
/** 字体文件所在目录（@fontsource 包内 files/）。 */
const fontsourceDir = (() => {
  const entry = resolveFromPackage('@fontsource/noto-sans-sc/400.css');
  return join(dirname(entry), 'files');
})();

const plan = [
  { from: join(canvasKitDir, 'canvaskit.js'), to: join(OUT_DIR, 'canvaskit.js') },
  { from: join(canvasKitDir, 'canvaskit.wasm'), to: join(OUT_DIR, 'canvaskit.wasm') },
];
for (const weight of FONT_WEIGHTS) {
  for (const subset of FONT_SUBSETS) {
    const name = `noto-sans-sc-${subset}-${weight}-normal.woff2`;
    plan.push({ from: join(fontsourceDir, name), to: join(FONT_OUT_DIR, name) });
  }
}

let copied = 0;
let skipped = 0;
let bytes = 0;
for (const entry of plan) {
  const result = copyFile(entry.from, entry.to);
  bytes += result.size;
  if (result.skipped) skipped += 1;
  else copied += 1;
}

console.log(
  `[canvas] CanvasKit 资产就绪：${OUT_DIR}（复制 ${String(copied)}，跳过 ${String(skipped)}，共 ${(bytes / 1024 / 1024).toFixed(1)}MB）`,
);
