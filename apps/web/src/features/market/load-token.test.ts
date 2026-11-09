/**
 * 装载确认门与一次性 token 测试（接缝：`@/features/market/load-token`）。
 *
 * 这是本票的**装载边界核心**：断言一次性（重复消费拒绝）、短时效（超时是显式错误态）、
 * 不可装载者的第二道闸（防绕过 UI 直接批准），以及审计字段齐全。
 */

import { describe, expect, it } from 'vitest';

import { makeLoadPlan } from './__fixtures__/market';
import {
  approveLoadSession,
  awaitingApproval,
  completeLoadInstall,
  consumeLoadSession,
  EMPTY_LOAD_SESSION,
  type LoadErrorCode,
  LOAD_TOKEN_TTL_MS,
  loadErrorCopyKey,
  mapInstallErrorCode,
  openLoadSession,
  rejectLoadSession,
  remainingTokenMs,
  stageLoadForInstall,
} from './load-token';

const META = {
  name: 'pdf-export',
  kind: 'skill',
  digest: 'sha256:9f2c',
  ref: 'a1b2c3d4',
};

describe('load-token · 提案与批准', () => {
  it('可装载提案 → preview（尚无 token，未批准不得写入）', () => {
    const opened = openLoadSession(makeLoadPlan(), META);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.status).toBe('preview');
    expect(opened.session.token).toBeNull();
    expect(consumeLoadSession(opened.session, 0).ok).toBe(false);
  });

  it('仅看/禁 → 直接拒绝（第二道闸：绕过按钮也走不通过）', () => {
    const opened = openLoadSession(
      makeLoadPlan({ mode: 'view-only', loadable: false, targetPathHint: null }),
      META,
    );
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe('load_not_loadable');
    expect(opened.session.status).toBe('rejected');
  });

  it('批准签发一次性 token（绑定资产 digest/ref 与授权清单）', () => {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const approved = approveLoadSession(opened.session, 1_000, { tokenId: 'tok-1' });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.session.status).toBe('approved');
    expect(approved.session.token).toMatchObject({
      tokenId: 'tok-1',
      assetId: 'gh:acme/skills#skills/pdf-export',
      digest: 'sha256:9f2c',
      ref: 'a1b2c3d4',
      capabilities: ['subprocess'],
      issuedAtMs: 1_000,
      expiresAtMs: 1_000 + LOAD_TOKEN_TTL_MS,
    });
    expect(awaitingApproval(approved.session)).toBe(true);
  });

  it('重复批准 = 显式错误（不静默重发 token）', () => {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const first = approveLoadSession(opened.session, 1_000, { tokenId: 'tok-1' });
    if (!first.ok) throw new Error('首次批准应成功');
    const second = approveLoadSession(first.session, 2_000, { tokenId: 'tok-2' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('load_already_approved');
    expect(second.session.token?.tokenId).toBe('tok-1');
  });

  it('拒绝后不再签发 token', () => {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const rejected = rejectLoadSession(opened.session);
    expect(rejected.status).toBe('rejected');
    expect(approveLoadSession(rejected, 3_000).ok).toBe(false);
  });

  it('提案带 ackExpiresAt 时：批准的到期时刻锚定 daemon 签发值（批准不续期）', () => {
    // daemon 在 T0 签发、T0+120s 到期；批准发生在 T0+30s——剩余有效期只剩 90s，
    // 而不是批准时刻再续一整轮 TTL（倒计时与 daemon ackToken 同源同命）。
    const issuedAtMs = Date.parse('2026-11-08T00:00:00.000Z');
    const daemonExpiryMs = Date.parse('2026-11-08T00:02:00.000Z');
    const opened = openLoadSession(
      makeLoadPlan({ ackToken: 'daemon-token-1', ackExpiresAt: '2026-11-08T00:02:00.000Z' }),
      META,
    );
    if (!opened.ok) throw new Error('提案应可装载');
    const approved = approveLoadSession(opened.session, issuedAtMs + 30_000, { tokenId: 'tok-1' });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.session.token?.issuedAtMs).toBe(issuedAtMs + 30_000);
    expect(approved.session.token?.expiresAtMs).toBe(daemonExpiryMs);
    expect(remainingTokenMs(approved.session, issuedAtMs + 30_000)).toBe(90_000);
  });

  it('批准前 ackExpiresAt 已过 → 批准即显式失效态（ack_expired 族），不签发必死的 token', () => {
    const opened = openLoadSession(
      makeLoadPlan({ ackToken: 'daemon-token-1', ackExpiresAt: '2026-11-08T00:02:00.000Z' }),
      META,
    );
    if (!opened.ok) throw new Error('提案应可装载');
    // 批准动作晚于 daemon 到期时刻 1ms：token 在 daemon 侧已失效
    const late = approveLoadSession(opened.session, Date.parse('2026-11-08T00:02:00.001Z'), {
      tokenId: 'tok-late',
    });
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.code).toBe('load_token_expired');
    expect(late.session.status).toBe('expired');
    expect(late.session.token).toBeNull();
    // 失效态不能靠再次批准补救：须重开对话框重取新提案
    expect(approveLoadSession(late.session, Date.parse('2026-11-08T00:03:00.000Z')).ok).toBe(false);
  });

  it('提案未带 ackExpiresAt（旧索引/夹具形态）→ 回退本地 TTL（向后兼容）', () => {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const approved = approveLoadSession(opened.session, 5_000, { tokenId: 'tok-1' });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.session.token?.expiresAtMs).toBe(5_000 + LOAD_TOKEN_TTL_MS);
  });
});

describe('load-token · 消费（单事务写入点）', () => {
  function approvedSession(nowMs = 1_000) {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const approved = approveLoadSession(opened.session, nowMs, { tokenId: 'tok-1' });
    if (!approved.ok) throw new Error('批准应成功');
    return approved.session;
  }

  it('消费成功产出审计记录（id/digest/ref/能力授权/落点/批准时刻）', () => {
    const consumed = consumeLoadSession(approvedSession(), 1_500);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.record).toEqual({
      assetId: 'gh:acme/skills#skills/pdf-export',
      name: 'pdf-export',
      kind: 'skill',
      digest: 'sha256:9f2c',
      ref: 'a1b2c3d4',
      targetPath: '.dfg/market/skill/pdf-export/',
      capabilities: ['subprocess'],
      approvedAt: new Date(1_000).toISOString(),
      caller: 'user',
    });
    expect(consumed.session.status).toBe('consumed');
    expect(consumed.session.token).toBeNull();
  });

  it('重复消费 = 拒绝（一次性）', () => {
    const first = consumeLoadSession(approvedSession(), 1_500);
    if (!first.ok) throw new Error('首次消费应成功');
    const second = consumeLoadSession(first.session, 1_600);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('load_token_used');
  });

  it('超时（超过 TTL）→ 失效态，且不能补救消费', () => {
    const session = approvedSession(1_000);
    const expired = consumeLoadSession(session, 1_000 + LOAD_TOKEN_TTL_MS + 1);
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.code).toBe('load_token_expired');
    expect(expired.session.status).toBe('expired');
    expect(consumeLoadSession(expired.session, 1_000 + LOAD_TOKEN_TTL_MS + 2).ok).toBe(false);
  });

  it('TTL 边界：恰好到期仍可用，超过一毫秒即失效', () => {
    expect(consumeLoadSession(approvedSession(0), LOAD_TOKEN_TTL_MS).ok).toBe(true);
    expect(consumeLoadSession(approvedSession(0), LOAD_TOKEN_TTL_MS + 1).ok).toBe(false);
  });

  it('空会话消费 → load_not_approved（没提案就没有授权）', () => {
    const result = consumeLoadSession(EMPTY_LOAD_SESSION, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('load_not_approved');
  });

  it('剩余有效时间随时刻递减，过期归零', () => {
    const session = approvedSession(1_000);
    expect(remainingTokenMs(session, 1_000)).toBe(LOAD_TOKEN_TTL_MS);
    expect(remainingTokenMs(session, 1_000 + LOAD_TOKEN_TTL_MS / 2)).toBe(LOAD_TOKEN_TTL_MS / 2);
    expect(remainingTokenMs(session, 1_000 + LOAD_TOKEN_TTL_MS + 10)).toBe(0);
    expect(remainingTokenMs(EMPTY_LOAD_SESSION, 0)).toBe(0);
  });
});

describe('load-token · daemon 真写接线（装载中/失败；票③）', () => {
  function approvedSession(nowMs = 1_000) {
    const opened = openLoadSession(makeLoadPlan(), META);
    if (!opened.ok) throw new Error('提案应可装载');
    const approved = approveLoadSession(opened.session, nowMs, { tokenId: 'tok-1' });
    if (!approved.ok) throw new Error('批准应成功');
    return approved.session;
  }

  it('装载发起：approved → loading（真写进行中；重复发起=一次性显式拒绝）', () => {
    const staged = stageLoadForInstall(approvedSession(), 1_500);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.session.status).toBe('loading');
    expect(staged.session.errorCode).toBeNull();
    // 装载中再点：token 已在途（服务端一次性），显式拒绝
    const again = stageLoadForInstall(staged.session, 1_600);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('load_token_used');
  });

  it('装载发起的时效闸与消费闸同款（超时/未批准都是显式错误态）', () => {
    const expired = stageLoadForInstall(approvedSession(1_000), 1_000 + LOAD_TOKEN_TTL_MS + 1);
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.code).toBe('load_token_expired');
    expect(expired.session.status).toBe('expired');

    const empty = stageLoadForInstall(EMPTY_LOAD_SESSION, 0);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.code).toBe('load_not_approved');
  });

  it('装载完成（成功）：consumed + LoadRecord 记 daemon 真值（digest/loadedAt/targetPath）', () => {
    const staged = stageLoadForInstall(approvedSession(), 1_500);
    if (!staged.ok) throw new Error('装载发起应成功');
    const done = completeLoadInstall(staged.session, {
      ok: true,
      digest: 'sha256:real',
      loadedAt: '2026-11-08T00:00:00.000Z',
      targetPath: '.dfg/market/skill/pdf-export/',
      files: ['SKILL.md'],
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.session.status).toBe('consumed');
    expect(done.session.token).toBeNull();
    expect(done.record).toMatchObject({
      assetId: 'gh:acme/skills#skills/pdf-export',
      name: 'pdf-export',
      kind: 'skill',
      digest: 'sha256:real',
      ref: 'a1b2c3d4',
      targetPath: '.dfg/market/skill/pdf-export/',
      loadedAt: '2026-11-08T00:00:00.000Z',
      caller: 'user',
    });
  });

  it('装载完成（失败）：failed + daemon 错误码映射进装载词表 + 原码留诊断', () => {
    const staged = stageLoadForInstall(approvedSession(), 1_500);
    if (!staged.ok) throw new Error('装载发起应成功');
    const done = completeLoadInstall(staged.session, {
      ok: false,
      code: 'market_install_digest_mismatch',
      message: '源内容 digest 与索引不符',
    });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.session.status).toBe('failed');
    expect(done.session.errorCode).toBe('load_install_digest_mismatch');
    expect(done.session.installErrorCode).toBe('market_install_digest_mismatch');
    expect(done.session.token).toBeNull();
    // 失败态不可再发起（服务端 token 已一次性消费；重装须重新出提案）
    const retry = stageLoadForInstall(done.session, 2_000);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.code).toBe('load_token_used');
  });

  it('装载完成仅接受 loading 态（其他状态一律 load_not_approved）', () => {
    const done = completeLoadInstall(approvedSession(), {
      ok: true,
      digest: 'd',
      loadedAt: 'x',
      targetPath: 't',
      files: [],
    });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.code).toBe('load_not_approved');
  });

  it('daemon 错误码映射表（market_install_* → load_install_*；未知码归 load_install_failed）', () => {
    expect(mapInstallErrorCode('market_install_asset_not_found')).toBe(
      'load_install_asset_not_found',
    );
    expect(mapInstallErrorCode('market_install_ack_invalid')).toBe('load_install_ack_invalid');
    expect(mapInstallErrorCode('market_install_ack_expired')).toBe('load_install_ack_expired');
    expect(mapInstallErrorCode('market_install_digest_mismatch')).toBe(
      'load_install_digest_mismatch',
    );
    expect(mapInstallErrorCode('market_install_source_unavailable')).toBe(
      'load_install_source_unavailable',
    );
    expect(mapInstallErrorCode('market_install_target_invalid')).toBe(
      'load_install_target_invalid',
    );
    expect(mapInstallErrorCode('market_install_gate_blocked')).toBe('load_install_gate_blocked');
    expect(mapInstallErrorCode('daemon_unreachable')).toBe('load_install_unreachable');
    expect(mapInstallErrorCode('daemon_bad_response')).toBe('load_install_bad_response');
    expect(mapInstallErrorCode('weird_unknown')).toBe('load_install_failed');
  });
});

/**
 * 装载错误词表契约（D-18 #3 · 单一映射表）：daemon 原码、前端错误码与 i18n 文案键收敛一张表，
 * 不再有两把需人工同步的 switch。期望值是独立真源——历史双 switch 的字面量（与 i18n 目录同源），
 * 合并前后行为零变化：copy key 与既有 i18n 键零变化，daemon 原码映射逐条不变。
 */
describe('load-token · 装载错误词表（单一映射表 · D-18 #3）', () => {
  /** 历史 `loadErrorCopyKey`（LoadConfirmDialog 内联 switch）的全部字面量（独立真源）。 */
  const HISTORIC_COPY_KEYS: Record<LoadErrorCode, string> = {
    load_not_loadable: 'market.load.notLoadable',
    load_not_approved: 'market.load.installFailed', // 历史走 switch default
    load_token_used: 'market.load.tokenUsed',
    load_token_expired: 'market.load.tokenExpired',
    load_already_approved: 'market.load.alreadyApproved',
    load_install_asset_not_found: 'market.load.installAssetNotFound',
    load_install_ack_invalid: 'market.load.installAckInvalid',
    load_install_ack_expired: 'market.load.installAckExpired',
    load_install_digest_mismatch: 'market.load.installDigestMismatch',
    load_install_source_unavailable: 'market.load.installSourceUnavailable',
    load_install_target_invalid: 'market.load.installTargetInvalid',
    load_install_gate_blocked: 'market.load.installGateBlocked',
    load_install_unreachable: 'market.load.installUnreachable',
    load_install_bad_response: 'market.load.installBadResponse',
    load_install_failed: 'market.load.installFailed',
  };

  it('loadErrorCopyKey：全部错误码的文案键与既有 i18n 键一致（copy key 零变化）', () => {
    for (const [code, key] of Object.entries(HISTORIC_COPY_KEYS)) {
      expect(loadErrorCopyKey(code as LoadErrorCode)).toBe(key);
    }
  });

  it('daemon 原码 → 错误码 → 文案键 成对收敛（两把 switch 不再各自漂移）', () => {
    const daemonPairs: Array<[string, string]> = [
      ['market_install_asset_not_found', 'market.load.installAssetNotFound'],
      ['market_install_ack_invalid', 'market.load.installAckInvalid'],
      ['market_install_ack_expired', 'market.load.installAckExpired'],
      ['market_install_digest_mismatch', 'market.load.installDigestMismatch'],
      ['market_install_source_unavailable', 'market.load.installSourceUnavailable'],
      ['market_install_target_invalid', 'market.load.installTargetInvalid'],
      ['market_install_gate_blocked', 'market.load.installGateBlocked'],
      ['daemon_unreachable', 'market.load.installUnreachable'],
      ['daemon_bad_response', 'market.load.installBadResponse'],
    ];
    for (const [daemonCode, expectedKey] of daemonPairs) {
      const code = mapInstallErrorCode(daemonCode);
      expect(loadErrorCopyKey(code)).toBe(expectedKey);
    }
    // 未知原码兜底链不变：load_install_failed → market.load.installFailed
    expect(loadErrorCopyKey(mapInstallErrorCode('weird_unknown'))).toBe(
      'market.load.installFailed',
    );
  });
});
