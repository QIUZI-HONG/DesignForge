import { describe, expect, it } from 'vitest';

import { DESKTOP_PACKAGE, ELECTRON_SECURITY_BASELINE } from './index';

describe('@dforge/desktop 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(DESKTOP_PACKAGE).toBe('@dforge/desktop');
  });

  it('安全基线开关名齐四顶', () => {
    expect(ELECTRON_SECURITY_BASELINE).toHaveLength(4);
  });
});
