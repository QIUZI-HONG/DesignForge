import { describe, expect, it } from 'vitest';

import { ENGINE_PACKAGE } from './index';

describe('@dforge/engine 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(ENGINE_PACKAGE).toBe('@dforge/engine');
  });
});
