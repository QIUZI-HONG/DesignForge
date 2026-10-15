import { describe, expect, it } from 'vitest';

import { DAEMON_PACKAGE, DAEMON_SURFACES } from './index';

describe('@dforge/daemon 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(DAEMON_PACKAGE).toBe('@dforge/daemon');
  });

  it('服务面清单非空', () => {
    expect(DAEMON_SURFACES.length).toBeGreaterThan(0);
  });
});
