import { describe, expect, it } from 'vitest';

import { UI_PACKAGE } from './index';

describe('@dforge/ui 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(UI_PACKAGE).toBe('@dforge/ui');
  });
});
