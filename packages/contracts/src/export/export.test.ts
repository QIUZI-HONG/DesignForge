import { describe, expect, it } from 'vitest';

import { EXPORT_FORMATS, EXPORT_MIME_TYPES, isExportFormat } from './index.ts';

describe('export · 格式契约', () => {
  it('起步三格式（PNG/SVG/PDF）齐全', () => {
    expect([...EXPORT_FORMATS]).toEqual(['png', 'svg', 'pdf']);
  });

  it('每格式都有 MIME 映射', () => {
    for (const format of EXPORT_FORMATS) {
      expect(EXPORT_MIME_TYPES[format], format).toMatch(/^image\/|^application\//);
    }
  });

  it('isExportFormat 只认白名单', () => {
    expect(isExportFormat('png')).toBe(true);
    expect(isExportFormat('jpg')).toBe(false);
    expect(isExportFormat(1)).toBe(false);
  });
});
