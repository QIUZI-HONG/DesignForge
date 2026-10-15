import { describe, expect, it } from 'vitest';

import {
  DFG_MANIFEST_SCHEMA,
  documentIdFromName,
  isDfgManifest,
  isValidDocumentName,
} from './index.ts';

describe('documents · 名称规则', () => {
  it('接受中文/英文/数字/空格名', () => {
    expect(isValidDocumentName('我的第一个设计')).toBe(true);
    expect(isValidDocumentName('Landing Page 2')).toBe(true);
  });

  it('拒绝空串、纯空白、超长、路径分隔符、前导点', () => {
    expect(isValidDocumentName('')).toBe(false);
    expect(isValidDocumentName('   ')).toBe(false);
    expect(isValidDocumentName('a'.repeat(65))).toBe(false);
    expect(isValidDocumentName('a/b')).toBe(false);
    expect(isValidDocumentName('a\\b')).toBe(false);
    expect(isValidDocumentName('a:b')).toBe(false);
    expect(isValidDocumentName('.hidden')).toBe(false);
    expect(isValidDocumentName(42)).toBe(false);
  });

  it('文档名 → 目录 id：空白压成 -，中文保留', () => {
    expect(documentIdFromName('我的  项目')).toBe('我的-项目');
    expect(documentIdFromName('  Landing Page  ')).toBe('Landing-Page');
  });
});

describe('documents · manifest 校验', () => {
  const manifest = {
    schema: DFG_MANIFEST_SCHEMA,
    id: 'demo',
    name: '演示文档',
    version: 1,
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    pages: [{ id: 'page-1', name: '页面 1', updatedAt: '2026-10-15T12:00:00.000Z' }],
  };

  it('接受合法 manifest', () => {
    expect(isDfgManifest(manifest)).toBe(true);
  });

  it('拒绝错 schema / 缺 pages / 页面元数据不全 / 非整数 version', () => {
    expect(isDfgManifest({ ...manifest, schema: 'df.dfg.manifest/v2' })).toBe(false);
    expect(isDfgManifest({ ...manifest, pages: undefined })).toBe(false);
    expect(isDfgManifest({ ...manifest, pages: [{ id: 'p1' }] })).toBe(false);
    expect(isDfgManifest({ ...manifest, version: 1.5 })).toBe(false);
  });
});
