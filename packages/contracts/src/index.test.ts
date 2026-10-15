import { describe, expect, it } from 'vitest';

import { CONTRACTS_PACKAGE } from './index';

describe('@dforge/contracts 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(CONTRACTS_PACKAGE).toBe('@dforge/contracts');
  });
});
