import { describe, expect, it } from 'vitest';

import { COMFY_PACKAGE } from './index';

describe('@dforge/comfy 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(COMFY_PACKAGE).toBe('@dforge/comfy');
  });
});
