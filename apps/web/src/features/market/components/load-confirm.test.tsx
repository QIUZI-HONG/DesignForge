// @vitest-environment jsdom
/**
 * 装载确认测试（接缝：`LoadConfirmDialog` 的三段式可观测行为 + `CapabilityList` 词表口径）。
 *
 * 断言装载边界的三条硬行为（票面 §4）：① 能力清单逐项可见（词表外按需授权、subprocess 红标）；
 * ② license 档位与署名要求如实展示；③ **一次性 token**：批准后才可写入，重复写入/超时写入都被拒。
 */

import type { MarketLoadPlan } from '@dforge/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

import { makeAsset, makeLoadPlan } from '../__fixtures__/market';
import type { LoadRecord, MarketInstallClient, MarketInstallOutcome } from '../load-token';
import { CapabilityList } from './CapabilityList';
import { LoadConfirmDialog } from './LoadConfirmDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 装载客户端桩：缺省成功（真值形态与 daemon 安装响应一致），可注入失败/记录调用。 */
function makeInstallStub(options: { fail?: { code: string; message: string } } = {}): {
  install: MarketInstallClient;
  calls: { assetId: string; ackToken: string }[];
} {
  const calls: { assetId: string; ackToken: string }[] = [];
  const install: MarketInstallClient = async (input) => {
    calls.push(input);
    if (options.fail !== undefined) {
      return { ok: false as const, code: options.fail.code, message: options.fail.message };
    }
    return {
      ok: true as const,
      digest: makeAsset().digest,
      loadedAt: '2026-11-08T00:00:00.000Z',
      targetPath: '.dfg/market/skill/pdf-export/',
      files: ['SKILL.md'],
    };
  };
  return { install, calls };
}

describe('CapabilityList · 能力清单（D4 门禁输入）', () => {
  it('逐项列标签与授予口径；subprocess 红标「默认拒绝 + 需显式授权」', () => {
    const { container } = render(
      <CapabilityList capabilities={['prompt:inject', 'subprocess', 'browser:automate']} />,
    );
    expect(screen.getByText('注入提示词')).toBeTruthy();
    expect(screen.getByText('执行子进程')).toBeTruthy();
    expect(screen.getByText('默认拒绝')).toBeTruthy();
    // 词表外能力：显示原始 id，按「未知能力」处理且要授权
    expect(screen.getByText('browser:automate')).toBeTruthy();
    expect(screen.getByText('未知能力')).toBeTruthy();
    expect(container.querySelectorAll('[data-df-market="capability-ack"]').length).toBe(2);
    expect(screen.getByText(/确认条需逐项授权：browser:automate、subprocess/)).toBeTruthy();
  });

  it('无能力时如实说明（索引按缺省处理）', () => {
    render(<CapabilityList capabilities={[]} />);
    expect(screen.getByText(/未声明任何能力/)).toBeTruthy();
  });
});

describe('LoadConfirmDialog · 三段式装载（D4）', () => {
  function setup(
    options: {
      ttlMs?: number;
      ownedBefore?: boolean;
      clock?: { now: number };
      install?: MarketInstallClient;
      installFail?: { code: string; message: string };
    } = {},
  ) {
    const clock = options.clock ?? { now: 1_000_000 };
    const onLoaded = vi.fn<(record: LoadRecord) => void>();
    const onOpenChange = vi.fn();
    const stub = makeInstallStub(
      options.installFail === undefined ? {} : { fail: options.installFail },
    );
    const view = render(
      <LoadConfirmDialog
        open
        asset={makeAsset({ capabilities: ['prompt:inject', 'subprocess'] })}
        plan={makeLoadPlan()}
        ownedBefore={options.ownedBefore ?? false}
        onOpenChange={onOpenChange}
        onLoaded={onLoaded}
        now={() => clock.now}
        install={options.install ?? stub.install}
        {...(options.ttlMs === undefined ? {} : { tokenTtlMs: options.ttlMs })}
      />,
    );
    return { onLoaded, onOpenChange, clock, container: view.container, stub };
  }

  it('第一步（dryRun 预览）：位置 / 许可档 + 署名 / 能力清单 / 需授权清单全部可见，且尚无 token', () => {
    const { container } = setup();
    expect(screen.getByText('装载位置')).toBeTruthy();
    expect(screen.getByText('.dfg/market/skill/pdf-export/')).toBeTruthy();
    expect(screen.getByText(/可装载 · SPDX MIT/)).toBeTruthy();
    expect(screen.getByText(/随包携带许可原文与上游署名/)).toBeTruthy();
    expect(screen.getByText('能力清单')).toBeTruthy();
    expect(screen.getByText('执行子进程')).toBeTruthy();
    expect(screen.getByText(/确认条需逐项授权：subprocess/)).toBeTruthy();
    expect(screen.getByText('dryRun 预览（尚无任何写入）')).toBeTruthy();
    expect(screen.getByText(/审计字段/)).toBeTruthy();
    expect(container.querySelector('[data-df-market="load-token"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
  });

  it('第二步（批准）：签发一次性 token 并显示剩余秒数', async () => {
    const user = userEvent.setup();
    setup({ ttlMs: 120_000 });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    expect(screen.getByText(/一次性 token 已签发：/)).toBeTruthy();
    expect(screen.getByText(/120 秒内有效/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认写入' })).toBeTruthy();
  });

  it('第三步（写入）：成功产出审计记录（assetId/digest/ref/能力授权/落点/调用方）', async () => {
    const user = userEvent.setup();
    const { onLoaded } = setup();
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    const record = onLoaded.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      assetId: 'gh:acme/skills#skills/pdf-export',
      name: 'pdf-export',
      kind: 'skill',
      digest: makeAsset().digest,
      ref: makeAsset().source.ref,
      targetPath: '.dfg/market/skill/pdf-export/',
      capabilities: ['subprocess'],
      caller: 'user',
    });
  });

  it('写入成功后进入完成态：不再有第二次写入路径（一次性；重复确认在状态机层被拒）', async () => {
    const user = userEvent.setup();
    const { onLoaded, onOpenChange } = setup();
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/写入记录与审计已生成/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('超时写入被拒（短时效）：未批准就过期时给出失效提示', async () => {
    const user = userEvent.setup();
    const clock = { now: 1_000_000 };
    const { onLoaded } = setup({ ttlMs: 5_000, clock });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    clock.now += 5_001;
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(onLoaded).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('已失效');
  });

  it('已有本地记录时给覆盖/更新提示（§7.4 不静默覆盖）', () => {
    setup({ ownedBefore: true });
    expect(screen.getByText(/本地已有该资产的装载记录/)).toBeTruthy();
  });

  it('取消不签发 token 并关闭对话框', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onLoaded } = setup();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /** 抽取打到 /telemetry/events 的调用体。 */
  function telemetryCalls(): Array<{ name: string; payload: Record<string, unknown> }> {
    return fetchMock.mock.calls
      .filter((call) => String(call[0]).includes('/telemetry/events'))
      .map(
        (call) =>
          JSON.parse(String((call[1] as { body: string }).body)) as {
            name: string;
            payload: Record<string, unknown>;
          },
      );
  }

  it('确认写入成功 → 发 market.load-attempt（result=success，含 assetId）', async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { stored: true, id: 'evt_1', reason: null } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const user = userEvent.setup();
    setup({ ttlMs: 120_000 });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(screen.getByText('已装载：写入记录与审计已生成。')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const attempts = telemetryCalls().filter((call) => call.name === 'market.load-attempt');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.payload).toMatchObject({
      assetId: 'gh:acme/skills#skills/pdf-export',
      result: 'success',
    });
  });

  it('超时写入被拒 → 发 market.load-attempt（result=failed，code=load_token_expired）', async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { stored: true, id: 'evt_2', reason: null } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const user = userEvent.setup();
    const clock = { now: 1_000_000 };
    setup({ ttlMs: 5_000, clock });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    clock.now += 5_001;
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const attempts = telemetryCalls().filter((call) => call.name === 'market.load-attempt');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.payload).toMatchObject({
      assetId: 'gh:acme/skills#skills/pdf-export',
      result: 'failed',
      code: 'load_token_expired',
    });
  });

  it('取消（拒绝）不发装载尝试事件', async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(telemetryCalls().some((call) => call.name === 'market.load-attempt')).toBe(false);
  });
});

describe('LoadConfirmDialog · daemon 真写接线（装载中/失败；票③）', () => {
  function setupWithPlan(
    planOverride: Partial<MarketLoadPlan>,
    options: { install: MarketInstallClient },
  ) {
    const onLoaded = vi.fn<(record: LoadRecord) => void>();
    const onOpenChange = vi.fn();
    const view = render(
      <LoadConfirmDialog
        open
        asset={makeAsset()}
        plan={makeLoadPlan(planOverride)}
        ownedBefore={false}
        onOpenChange={onOpenChange}
        onLoaded={onLoaded}
        now={() => 1_000_000}
        install={options.install}
      />,
    );
    return { onLoaded, onOpenChange, container: view.container };
  }

  it('提交装载时把提案的 ackToken 透传给装载客户端（服务端一次性闸的钥匙）', async () => {
    const user = userEvent.setup();
    const calls: { assetId: string; ackToken: string }[] = [];
    const install: MarketInstallClient = async (input) => {
      calls.push(input);
      return {
        ok: true,
        digest: makeAsset().digest,
        loadedAt: '2026-11-08T00:00:00.000Z',
        targetPath: '.dfg/market/skill/pdf-export/',
        files: ['SKILL.md'],
      };
    };
    const { onLoaded } = setupWithPlan(
      { ackToken: 'daemon-token-1', ackExpiresAt: '2026-11-08T00:02:00.000Z' },
      { install },
    );
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(calls).toEqual([
      { assetId: 'gh:acme/skills#skills/pdf-export', ackToken: 'daemon-token-1' },
    ]);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0]?.[0].loadedAt).toBe('2026-11-08T00:00:00.000Z');
  });

  it('装载中呈现：写入期间显示「装载中」提示，完成后回到完成态', async () => {
    const user = userEvent.setup();
    let resolveInstall: ((value: MarketInstallOutcome) => void) | null = null;
    const deferred = new Promise<MarketInstallOutcome>((resolve) => {
      resolveInstall = resolve;
    });
    setupWithPlan({}, { install: () => deferred });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    // 装载中：提示可见，写入按钮消失（防二次点击）；Modal 走 portal，查询用 document
    const installing = document.querySelector('[data-df-market="load-installing"]');
    expect(installing).not.toBeNull();
    expect(installing?.getAttribute('data-df-loading')).toBe('load-install');
    expect(installing?.textContent).toContain('装载中');
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
    await act(async () => {
      resolveInstall?.({
        ok: true,
        digest: makeAsset().digest,
        loadedAt: '2026-11-08T00:00:00.000Z',
        targetPath: '.dfg/market/skill/pdf-export/',
        files: ['SKILL.md'],
      });
      await deferred;
    });
    expect(document.querySelector('[data-df-market="load-installing"]')).toBeNull();
    expect(screen.getByText(/已装载：写入记录与审计已生成/)).toBeTruthy();
  });

  it('装载中禁关（F6）：Esc/点遮罩都不关闭，取消按钮隐藏；完成后出口恢复', async () => {
    const user = userEvent.setup();
    let resolveInstall: ((value: MarketInstallOutcome) => void) | null = null;
    const deferred = new Promise<MarketInstallOutcome>((resolve) => {
      resolveInstall = resolve;
    });
    const { onOpenChange } = setupWithPlan({}, { install: () => deferred });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    // 装载中：取消按钮隐藏，关闭（X）按钮不存在
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(screen.queryByRole('button', { name: /关闭装载确认/ })).toBeNull();
    // Esc 不关
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-df-market="load-installing"]')).not.toBeNull();
    // 点遮罩不关
    const dialog = document.querySelector('[role="dialog"]');
    await user.click(dialog?.parentElement as HTMLElement);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-df-market="load-installing"]')).not.toBeNull();
    // 真写完成 → 出口恢复（关闭按钮可点，onOpenChange(false)）
    await act(async () => {
      resolveInstall?.({
        ok: true,
        digest: makeAsset().digest,
        loadedAt: '2026-11-08T00:00:00.000Z',
        targetPath: '.dfg/market/skill/pdf-export/',
        files: ['SKILL.md'],
      });
      await deferred;
    });
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('装载失败呈现：显式 alert + 错误码可引用（诊断）+ 关闭出口，不再有写入按钮', async () => {
    const user = userEvent.setup();
    const failInstall: MarketInstallClient = async () => ({
      ok: false,
      code: 'market_install_source_unavailable',
      message: '缺少 GitHub 凭据',
    });
    const { onLoaded, onOpenChange } = setupWithPlan({}, { install: failInstall });
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(onLoaded).not.toHaveBeenCalled();
    // Modal 走 portal：错误面与错误码挂点用 document 查询
    const alert = document.querySelector('[data-df-market="load-error"]');
    expect(alert?.getAttribute('data-df-error-code')).toBe('market_install_source_unavailable');
    expect(alert?.textContent).toContain('源不可用');
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('批准前 ackExpiresAt 已过（F1）：批准即显式失效态，不发起装载——重开由页面重取新提案', async () => {
    const user = userEvent.setup();
    const install = vi.fn<MarketInstallClient>();
    const view = render(
      <LoadConfirmDialog
        open
        asset={makeAsset()}
        plan={makeLoadPlan({
          ackToken: 'daemon-token-stale',
          ackExpiresAt: '2026-11-08T00:02:00.000Z',
        })}
        ownedBefore={false}
        onOpenChange={() => {}}
        onLoaded={() => {}}
        // 注入时钟停在 ackExpiresAt（2026-11-08T00:02:00Z）之后 1s：提案的 daemon token 已失效
        now={() => Date.parse('2026-11-08T00:02:01.000Z')}
        install={install}
      />,
    );
    await user.click(screen.getByRole('button', { name: '批准并签发一次性 token' }));
    // 批准即失效：alert 显式（load_token_expired），且绝不向 daemon 发必被拒的装载请求
    const alert = document.querySelector('[data-df-market="load-error"]');
    expect(alert?.getAttribute('data-df-error-code')).toBe('load_token_expired');
    expect(alert?.textContent).toContain('已失效');
    expect(install).not.toHaveBeenCalled();
    // 再点写入同样被状态机闸拒绝（expired 态显式失效提示），装载客户端零调用
    await user.click(screen.getByRole('button', { name: '确认写入' }));
    expect(install).not.toHaveBeenCalled();
    view.unmount();
  });
});
