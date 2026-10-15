/**
 * 装载确认门与一次性 token（D4；《技能市场规格 v1》§7.3 与 v1.1 §4.5.4 同构）。
 *
 * 纪律（本模块是装载边界的**唯一状态机**，UI 只发事件不自己拼状态）：
 * 1. **提案 → 确认 → 单事务写入 → 审计**：`preview` 阶段不带 token，用户显式批准才签发；
 * 2. **一次性**：token 消费后立即失效（重复确认/重复消费是显式错误态，不是静默成功）；
 * 3. **短时效**：超时未批准/未消费 → `expired`（与 MCP ack TTL 同族，取 `MCP_ACK_TTL_MS`）；
 * 4. 审计字段（规格 §7.3.3）：资产 id、`source.ref`、`digest`、能力授权清单、批准时刻与调用方。
 *
 * 为什么 token 由前端签发而不是 daemon：v1 的真实写入走 MCP 确认桩（P5 收敛网关）；
 * 本段前端负责**把三支柱中的「用户确认」跑通并可断言**，桩调用点收敛在 `consumeLoadSession`。
 */

import type { MarketLoadPlan } from '@dforge/contracts';
import { MCP_ACK_TTL_MS } from '@dforge/contracts';

/** 装载会话状态。 */
export type LoadSessionStatus =
  /** 未开始（无提案）。 */
  | 'idle'
  /** 已出提案（dryRun 预览），尚未批准。 */
  | 'preview'
  /** 已批准：token 已签发、待消费。 */
  | 'approved'
  /** 已消费：写入记录已生成（单事务写入点）。 */
  | 'consumed'
  /** token 过期（超时未消费）。 */
  | 'expired'
  /** 用户拒绝（不签发 token）。 */
  | 'rejected';

/** 一次性 token（短时效；绑定本次操作）。 */
export interface LoadToken {
  tokenId: string;
  assetId: string;
  digest: string;
  ref: string;
  /** 授权清单（`installGate.ackRequired` + 词表判定的需授权项）。 */
  capabilities: string[];
  issuedAtMs: number;
  expiresAtMs: number;
}

/** 装载审计记录（写入本地装载记录，字段对齐规格 §7.3.3）。 */
export interface LoadRecord {
  assetId: string;
  name: string;
  kind: string;
  digest: string;
  ref: string;
  targetPath: string | null;
  capabilities: string[];
  approvedAt: string;
  /** 调用方：本段只有用户确认这一条路径（AI/MCP 代装归后续票）。 */
  caller: 'user';
}

/** 资产溯源元数据（token 与审计记录的对齐键；来自索引卡片）。 */
export interface LoadAssetMeta {
  name: string;
  kind: string;
  /** 资产内容哈希（§1.6；装载校验与更新判定的对齐键）。 */
  digest: string;
  /** 采集时点 commit（装载记录以此对齐，规格 §1.3）。 */
  ref: string;
}

/** 装载会话（不可变；每次事件返回新会话）。 */
export interface LoadSession {
  status: LoadSessionStatus;
  plan: MarketLoadPlan | null;
  /** 提案绑定的资产元数据（批准后写进 token 与审计记录）。 */
  meta: LoadAssetMeta | null;
  token: LoadToken | null;
  record: LoadRecord | null;
  /** 最近一次的拒绝/失败原因码（用于 UI 提示，如 `load_token_expired`）。 */
  errorCode: LoadErrorCode | null;
}

/** 显式错误码（拒绝即显式，不静默）。 */
export type LoadErrorCode =
  | 'load_not_loadable'
  | 'load_not_approved'
  | 'load_token_used'
  | 'load_token_expired'
  | 'load_already_approved';

/** 会话事件结果：成功带新会话，（可选）记录；失败带原因码。 */
export type LoadEventResult =
  | { ok: true; session: LoadSession; record?: LoadRecord }
  | { ok: false; session: LoadSession; code: LoadErrorCode };

/** token 时效（与 MCP ack 同族：2 分钟）。 */
export const LOAD_TOKEN_TTL_MS = MCP_ACK_TTL_MS;

/** 空会话。 */
export const EMPTY_LOAD_SESSION: LoadSession = {
  status: 'idle',
  plan: null,
  meta: null,
  token: null,
  record: null,
  errorCode: null,
};

/** 生成 token id（浏览器与 Node 都有 WebCrypto；测试注入固定值）。 */
function createTokenId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 打开装载提案（`preview`）：dryRun 预览已就绪，等待用户判断。
 * 不可装载（`view-only`/`blocked`）直接拒绝——按钮层已禁用，这里是**第二道闸**（防绕过）。
 */
export function openLoadSession(plan: MarketLoadPlan, meta: LoadAssetMeta): LoadEventResult {
  if (!plan.loadable) {
    return {
      ok: false,
      session: {
        status: 'rejected',
        plan,
        meta,
        token: null,
        record: null,
        errorCode: 'load_not_loadable',
      },
      code: 'load_not_loadable',
    };
  }
  return {
    ok: true,
    session: { status: 'preview', plan, meta, token: null, record: null, errorCode: null },
  };
}

/** 批准并签发一次性 token（重复批准 = 显式错误态）。 */
export function approveLoadSession(
  session: LoadSession,
  nowMs: number,
  options: { ttlMs?: number; tokenId?: string } = {},
): LoadEventResult {
  if (session.plan === null || session.meta === null) {
    return { ok: false, session, code: 'load_not_approved' };
  }
  if (session.status === 'approved' || session.status === 'consumed') {
    return {
      ok: false,
      session: { ...session, errorCode: 'load_already_approved' },
      code: 'load_already_approved',
    };
  }
  if (session.status === 'rejected' || !session.plan.loadable) {
    return {
      ok: false,
      session: { ...session, errorCode: 'load_not_loadable' },
      code: 'load_not_loadable',
    };
  }
  const ttlMs = options.ttlMs ?? LOAD_TOKEN_TTL_MS;
  const token: LoadToken = {
    tokenId: options.tokenId ?? createTokenId(),
    assetId: session.plan.assetId,
    digest: session.meta.digest,
    ref: session.meta.ref,
    capabilities: [...session.plan.ackRequired],
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  return {
    ok: true,
    session: {
      status: 'approved',
      plan: session.plan,
      meta: session.meta,
      token,
      record: null,
      errorCode: null,
    },
  };
}

/** 用户拒绝（不签发 token；`preview` 之外的状态不改变）。 */
export function rejectLoadSession(session: LoadSession): LoadSession {
  if (session.status !== 'preview') return session;
  return { ...session, status: 'rejected', token: null, errorCode: null };
}

/**
 * 消费 token（**单事务写入点**）：一次性 + 短时效，重复/超时都是显式错误。
 * 成功时产出审计记录（`LoadRecord`）。
 */
export function consumeLoadSession(session: LoadSession, nowMs: number): LoadEventResult {
  if (session.status === 'consumed') {
    return {
      ok: false,
      session: { ...session, errorCode: 'load_token_used' },
      code: 'load_token_used',
    };
  }
  if (session.token === null || session.plan === null || session.meta === null) {
    return {
      ok: false,
      session: { ...session, errorCode: 'load_not_approved' },
      code: 'load_not_approved',
    };
  }
  if (nowMs > session.token.expiresAtMs) {
    return {
      ok: false,
      session: { ...session, status: 'expired', errorCode: 'load_token_expired' },
      code: 'load_token_expired',
    };
  }
  const record: LoadRecord = {
    assetId: session.plan.assetId,
    name: session.meta.name,
    kind: session.meta.kind,
    digest: session.meta.digest,
    ref: session.meta.ref,
    targetPath: session.plan.targetPathHint,
    capabilities: [...session.token.capabilities],
    approvedAt: new Date(session.token.issuedAtMs).toISOString(),
    caller: 'user',
  };
  return {
    ok: true,
    session: {
      status: 'consumed',
      plan: session.plan,
      meta: session.meta,
      token: null,
      record,
      errorCode: null,
    },
    record,
  };
}

/** token 剩余有效毫秒（UI 倒计时；已过期/无 token 为 0）。 */
export function remainingTokenMs(session: LoadSession, nowMs: number): number {
  if (session.token === null) return 0;
  return Math.max(0, session.token.expiresAtMs - nowMs);
}

/** 会话是否处于「等待用户批准」（决定确认条文案与按钮）。 */
export function awaitingApproval(session: LoadSession): boolean {
  return session.status === 'preview' || session.status === 'approved';
}
