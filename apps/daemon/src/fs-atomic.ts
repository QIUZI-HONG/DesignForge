/**
 * @dforge/daemon · 原子文件读写工具。
 *
 * 崩溃安全纪律（`_shared.md` §「文档落 .dfg 目录态、原子写 + 崩溃安全」）：
 * 写入 = 临时文件（同目录）→ fsync → rename 覆盖 → fsync 目录。
 * 读者任何时刻只会看到「旧版本或新版本」，绝无半截文件；临时文件带随机后缀，
 * 残留也不污染读取（读取只认目标名）。
 */

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** JSON 文件读取结果（缺失/不可读/解析失败均为显式分支，调用方自行决策）。 */
export type JsonFileResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'missing' | 'unreadable' | 'invalid-json'; message: string };

/** 确保目录存在（递归创建）。 */
export async function ensureDir(dir: string, mode?: number): Promise<void> {
  await mkdir(dir, { recursive: true, ...(mode === undefined ? {} : { mode }) });
}

/**
 * 原子写文件：临时文件 + fsync + rename。
 * mode 缺省 0o600（凭据类敏感文本），显式传入可放宽（如 0o644 的文档正文）。
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  const dir = dirname(filePath);
  await ensureDir(dir);
  const tempPath = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(tempPath, 'w', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  await syncDir(dir);
}

/** 读取 JSON 文件；缺失/解析失败返回结构化原因（不抛异常）。 */
export async function readJsonFileOrNull(filePath: string): Promise<JsonFileResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing', message: '文件不存在' };
    return { ok: false, reason: 'unreadable', message: `文件不可读：${code ?? 'unknown'}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, reason: 'invalid-json', message: 'JSON 解析失败' };
  }
}

/** 判断路径是否可写（不存在时返回 false；由调用方决定是否先创建）。 */
export async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 目录 fsync（rename 的持久化保证）。
 * 说明：个别文件系统/平台不支持对目录 fd fsync（EINVAL/EPERM/ENOTSUP），
 * 此时静默跳过——rename 本身已保证可见性原子性，目录 fsync 只影响掉电持久性。
 */
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 见上方说明：不支持目录 fsync 的平台静默降级
  }
}

/** 追加一行 JSONL（原子追加：open append + write；单进程 daemon 无并发写者）。 */
export async function appendJsonLine(
  filePath: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { flag: 'a', mode });
}

/** 计算内容 sha256（hex）。 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(data).digest('hex');
}
