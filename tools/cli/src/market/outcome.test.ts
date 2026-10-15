/**
 * outcome 自测：出口形状的唯一真源 + 两个构造器的不变量。
 *
 * 不测实现细节（函数怎么写的），只测约定：ok 恒 0 且无阻塞原因；blocked 恒 2 且原因非空。
 */
import { describe, expect, it } from 'vitest';

import { blocked, ok } from './outcome.ts';

describe('market 子命令出口', () => {
  it('ok：exitCode=0、blockedReason=null、摘要原样带出', () => {
    const result = ok({ dataRoot: 'data', count: 3 });
    expect(result.exitCode).toBe(0);
    expect(result.blockedReason).toBeNull();
    expect(result.summary).toEqual({ dataRoot: 'data', count: 3 });
  });

  it('blocked：exitCode=2 且原因非空（阻塞不得匿名）', () => {
    const result = blocked({ dataRoot: 'data' }, 'ADS 产物缺失');
    expect(result.exitCode).toBe(2);
    expect(result.blockedReason).toBe('ADS 产物缺失');
    expect(result.blockedReason?.length ?? 0).toBeGreaterThan(0);
  });
});
