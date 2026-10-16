/**
 * @dforge/daemon · 凭据库（BYOK，**key 只在 daemon 解密使用**）。
 *
 * 落盘：`~/.dforge/credentials.json`（0600），内容为 AES-256-GCM 密文；
 * 加密主密钥在同目录 `credentials.key`（0600，首次写入时随机生成）。
 * 纪律（架构 v1.1 §5.6）：
 * - 明文永不落盘、永不进响应/日志/埋点（对外只出掩码摘要，见 CredentialSummary）；
 * - 来源优先级：环境变量 `DF_DEEPSEEK_API_KEY`（只读）> 本地凭据库；
 * - 清除凭据后 AI 立即降级为「未配置」，不报错。
 * 说明：桌面壳的 OS 钥匙串/safeStorage 由 FE-12 接入；daemon 侧先以「主密钥分离的
 * 静态加密 + 0600」实现最低承诺，将来可无损替换加密后端（文件形状已 version 化）。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import type { CredentialSummary } from '@dforge/contracts';
import { isPlausibleApiKey, maskSecret } from '@dforge/contracts';

import { readJsonFileOrNull, writeFileAtomic } from '../fs-atomic.ts';

/** 单条密文条目。 */
interface EncryptedEntry {
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

/** credentials.json 文件形状（version 化，便于将来换加密后端）。 */
interface CredentialsFile {
  version: 1;
  cipher: 'aes-256-gcm';
  entries: Record<string, EncryptedEntry>;
}

/** 凭据存储接口。 */
export interface CredentialStore {
  /** 从磁盘加载（缺失/损坏视为空库，不崩溃——用户可重设 key）。 */
  load(): Promise<void>;
  /** 对外摘要（**永不含明文**）。 */
  summary(): CredentialSummary;
  /** 仅 daemon 内部使用（AI 客户端调用上游前解密）；env 优先。 */
  resolveApiKey(): string | null;
  /** 写入 DeepSeek key（校验形态后加密落盘），返回掩码摘要。 */
  setDeepseekKey(
    apiKey: string,
  ): Promise<{ ok: true; summary: CredentialSummary } | { ok: false; message: string }>;
  /** 清除本地 key（env 只读，不受影响），返回新摘要。 */
  clear(): Promise<CredentialSummary>;
}

const DEEPSEEK = 'deepseek' as const;

function encrypt(plaintext: string, key: Buffer, updatedAt: string): EncryptedEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    updatedAt,
  };
}

function decrypt(entry: EncryptedEntry, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // 主密钥不匹配/密文损坏 → 视为无凭据（不抛出，避免阻断启动）
    return null;
  }
}

function emptySummary(): CredentialSummary {
  return { provider: DEEPSEEK, hasKey: false, maskedKey: null, source: null, updatedAt: null };
}

/** 创建凭据存储。credentialsPath / keyFilePath 为注入点（默认落 `~/.dforge/`）。 */
export function createCredentialStore(options: {
  credentialsPath: string;
  keyFilePath: string;
  envApiKey?: string | null;
}): CredentialStore {
  let entries: Record<string, EncryptedEntry> = {};
  let masterKey: Buffer | null = null;
  const envApiKey = options.envApiKey ?? null;

  const loadMasterKey = async (create: boolean): Promise<Buffer | null> => {
    if (masterKey !== null) return masterKey;
    let raw: string | null = null;
    try {
      raw = await readFile(options.keyFilePath, 'utf8');
    } catch {
      raw = null;
    }
    if (raw !== null) {
      const decoded = Buffer.from(raw.trim(), 'base64');
      if (decoded.length === 32) {
        masterKey = decoded;
        return masterKey;
      }
      // 已存在但损坏：绝不覆盖（覆盖会让既有密文永久不可解），按不可用处理
      return null;
    }
    if (!create) return null;
    masterKey = randomBytes(32);
    await writeFileAtomic(options.keyFilePath, `${masterKey.toString('base64')}\n`, 0o600);
    return masterKey;
  };

  const buildSummary = (): CredentialSummary => {
    if (envApiKey !== null && envApiKey.length > 0) {
      return {
        provider: DEEPSEEK,
        hasKey: true,
        maskedKey: maskSecret(envApiKey),
        source: 'env',
        updatedAt: null,
      };
    }
    const entry = entries[DEEPSEEK];
    if (entry !== undefined && masterKey !== null) {
      const secret = decrypt(entry, masterKey);
      if (secret !== null) {
        return {
          provider: DEEPSEEK,
          hasKey: true,
          maskedKey: maskSecret(secret),
          source: 'stored',
          updatedAt: entry.updatedAt,
        };
      }
    }
    return emptySummary();
  };

  const persist = async (): Promise<void> => {
    const file: CredentialsFile = { version: 1, cipher: 'aes-256-gcm', entries };
    // 0600：凭据文件永不放宽权限
    await writeFileAtomic(options.credentialsPath, `${JSON.stringify(file, null, 2)}\n`, 0o600);
  };

  return {
    async load(): Promise<void> {
      const result = await readJsonFileOrNull(options.credentialsPath);
      if (!result.ok) {
        entries = {};
        return;
      }
      const raw = result.value;
      if (typeof raw !== 'object' || raw === null) {
        entries = {};
        return;
      }
      const record = raw as Record<string, unknown>;
      entries =
        record.version === 1 && typeof record.entries === 'object' && record.entries !== null
          ? (record.entries as Record<string, EncryptedEntry>)
          : {};
      // 有存量条目时预加载主密钥，保证 summary() 在重启后立即可用（键不存在则静默跳过）
      if (Object.keys(entries).length > 0) {
        await loadMasterKey(false);
      }
    },

    summary: buildSummary,

    resolveApiKey(): string | null {
      if (envApiKey !== null && envApiKey.length > 0) return envApiKey;
      const entry = entries[DEEPSEEK];
      if (entry === undefined || masterKey === null) return null;
      return decrypt(entry, masterKey);
    },

    async setDeepseekKey(apiKey: string) {
      if (!isPlausibleApiKey(apiKey)) {
        return { ok: false as const, message: 'API key 形态不合法（期望 sk- 前缀 + 长串）' };
      }
      const key = await loadMasterKey(true);
      if (key === null) {
        return { ok: false as const, message: '本地加密主密钥不可用（credentials.key 损坏？）' };
      }
      entries[DEEPSEEK] = encrypt(apiKey, key, new Date().toISOString());
      await persist();
      return { ok: true as const, summary: buildSummary() };
    },

    async clear(): Promise<CredentialSummary> {
      delete entries[DEEPSEEK];
      if (Object.keys(entries).length === 0) {
        await rm(options.credentialsPath, { force: true });
      } else {
        await persist();
      }
      return buildSummary();
    },
  };
}
