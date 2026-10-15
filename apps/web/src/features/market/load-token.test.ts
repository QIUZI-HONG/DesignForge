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
  consumeLoadSession,
  EMPTY_LOAD_SESSION,
  LOAD_TOKEN_TTL_MS,
  openLoadSession,
  rejectLoadSession,
  remainingTokenMs,
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
