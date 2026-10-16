// @vitest-environment jsdom
/**
 * 装载确认测试（接缝：`LoadConfirmDialog` 的三段式可观测行为 + `CapabilityList` 词表口径）。
 *
 * 断言装载边界的三条硬行为（票面 §4）：① 能力清单逐项可见（词表外按需授权、subprocess 红标）；
 * ② license 档位与署名要求如实展示；③ **一次性 token**：批准后才可写入，重复写入/超时写入都被拒。
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAsset, makeLoadPlan } from '../__fixtures__/market';
import type { LoadRecord } from '../load-token';
import { CapabilityList } from './CapabilityList';
import { LoadConfirmDialog } from './LoadConfirmDialog';

afterEach(() => {
  cleanup();
});

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
  function setup(options: { ttlMs?: number; ownedBefore?: boolean; clock?: { now: number } } = {}) {
    const clock = options.clock ?? { now: 1_000_000 };
    const onLoaded = vi.fn<(record: LoadRecord) => void>();
    const onOpenChange = vi.fn();
    const view = render(
      <LoadConfirmDialog
        open
        asset={makeAsset({ capabilities: ['prompt:inject', 'subprocess'] })}
        plan={makeLoadPlan()}
        ownedBefore={options.ownedBefore ?? false}
        onOpenChange={onOpenChange}
        onLoaded={onLoaded}
        now={() => clock.now}
        {...(options.ttlMs === undefined ? {} : { tokenTtlMs: options.ttlMs })}
      />,
    );
    return { onLoaded, onOpenChange, clock, container: view.container };
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
});
