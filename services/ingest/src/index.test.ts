import { describe, expect, it } from 'vitest';

import { INGEST_LAYERS, INGEST_PACKAGE } from './index';

describe('@dforge/ingest 骨架冒烟', () => {
  it('包标识可用', () => {
    expect(INGEST_PACKAGE).toBe('@dforge/ingest');
  });

  it('四层仓库齐备', () => {
    expect(INGEST_LAYERS).toEqual(['ods', 'dwd', 'dws', 'ads']);
  });
});
