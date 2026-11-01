/**
 * @dforge/daemon · 原子文件读写工具。
 *
 * 崩溃安全纪律（`_shared.md` §「文档落 .dfg 目录态、原子写 + 崩溃安全」）：
 * 写入 = 临时文件（同目录）→ fsync → rename 覆盖 → fsync 目录。
 * 读者任何时刻只会看到「旧版本或新版本」，绝无半截文件；临时文件带随机后缀，
 * 残留也不污染读取（读取只认目标名）。
 *
 * 提交并发纪律（票 19 DA-2）：本模块另给 `stageFileAtomic`（暂存，提交点之后才发布）与
 * `claimCommit`（O_EXCL 独占声明「同一 base 我在提交」）。**两者都不是跨进程互斥**：
 * 声明只覆盖单笔提交的写窗口，真正的文档跨进程锁属票 21。
 */

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
 * 已落盘但**尚未发布**的暂存文件：内容已经 fsync 到同目录的临时名上，
 * 由持有者决定何时让它出现在目标名上（`publish`）或作废（`discard`）。
 */
export interface StagedFile {
  /** 临时文件路径（同目录、点前缀 + 随机后缀，读者不会看到）。 */
  tempPath: string;
  /** 发布：rename 到目标名 + 目录 fsync；失败即清理临时文件并抛出。 */
  publish: () => Promise<void>;
  /** 作废：删掉临时文件（目标名保持原样）。 */
  discard: () => Promise<void>;
}

/**
 * 提交声明（CAS 用的「同一 base 只允许一个提交者」凭据）。
 *
 * 纪律：**成功提交之后 `release()`**（声明只在该笔提交在飞的窗口内占名），
 * 否则会把后续写者永久挡在 EEXIST 上（崩溃残留由过期接管兜底）。
 */
export interface CommitClaim {
  /** 声明文件路径（`<dir>/.commit-<baseToken>`，O_EXCL 创建成功才存在）。 */
  claimPath: string;
  /** 释放声明（提交成功或本次放弃都要调用）；不存在即视作已释放。 */
  release: () => Promise<void>;
}

/** 提交声明目录前缀（点前缀：读者与文档内容清单都不把它当作文档的一部分）。 */
const CLAIM_PREFIX = '.commit-';

/**
 * 声明过期上界：持有者进程崩溃留下的声明若比这更老，允许后来者接管。
 * 一笔记税提交的全部窗口是「临时文件 fsync + 一次 rename + 一次复读」（毫秒级），
 * 30s 已经极宽；真正的跨进程存活检测（心跳/接管协议）属票 21，不在这里做。
 */
const CLAIM_STALE_MS = 30_000;

/**
 * 独占声明「我要从 baseToken 这一份状态提交」。
 *
 * - 创建成功 → 调用方持有声明，提交结束**必须** `release()`；
 * - 同名已存在 → 抛 `code='EEXIST'`（另一写者正从同一 base 提交；调用方据此判冲突）；
 * - 已存在但超过 {@link CLAIM_STALE_MS} 未释放 → 视为持有者崩溃，删除后重试一次
 *   （两个接管者竞速时 `open('wx')` 仍保证恰一个成功）。
 *
 * 这不是文档锁：它只覆盖**单笔提交的写窗口**，不覆盖读-改-写全程（票 21）。
 */
export async function claimCommit(
  dir: string,
  baseToken: string,
  content: string,
  now: () => number = Date.now,
): Promise<CommitClaim> {
  const claimPath = join(dir, `${CLAIM_PREFIX}${baseToken}`);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(claimPath, 'wx', 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        claimPath,
        release: async (): Promise<void> => {
          // 只删自己那一笔：`claimPath` 是**确定名字**（`.commit-<baseToken>`），过期接管后同
          // 一路径上挂的是别人的声明。无条件 rm 会把接管者的在飞声明摘掉，让第三个写者以为
          // 无人在飞——「同一 base 恰一个提交者」这条保证就此打穿（三轮 S2）。
          const held = await readFile(claimPath, 'utf8').catch(() => null);
          if (held !== null && held !== content) return;
          await rm(claimPath, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt > 0) throw error;
      const info = await stat(claimPath).catch(() => null);
      if (info === null) continue; // 竞速：对方已释放，直接重试创建
      if (now() - info.mtimeMs > CLAIM_STALE_MS) {
        await rm(claimPath, { force: true });
        continue; // 过期接管：重试一次创建
      }
      throw error;
    }
  }
}

/**
 * 暂存写：临时文件 + fsync，但**不**rename。
 * 需要「提交点之后才让内容可见」的场合用它（文档正文——manifest 才是提交点，票 19）。
 */
export async function stageFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  mode = 0o600,
): Promise<StagedFile> {
  const dir = dirname(filePath);
  await ensureDir(dir);
  const tempPath = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(tempPath, 'w', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    // open 已成功、写/同步阶段才失败（ENOSPC/EIO/分离缓冲等）：临时文件此刻已在盘上，
    // 必须就地清掉——否则「失败」的一方把半截内容以 .tmp 留在目录里，违背「失败 = 盘上没变」。
    await handle.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return {
    tempPath,
    publish: async (): Promise<void> => {
      try {
        await rename(tempPath, filePath);
      } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
      }
      await syncDir(dir);
    },
    discard: async (): Promise<void> => {
      await rm(tempPath, { force: true });
    },
  };
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
  const staged = await stageFileAtomic(filePath, data, mode);
  await staged.publish();
}

/**
 * 递归删除目录树，带瞬时错误重试（ENOTEMPTY/EBUSY：在途写入与删竞速）。
 * 生产路径（回滚、删除文档）与测试清理共用同一口径，不在各处手写 `rm` 参数。
 */
export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
