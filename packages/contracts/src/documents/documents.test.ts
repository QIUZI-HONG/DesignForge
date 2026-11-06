import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_NAME,
  DFG_MANIFEST_SCHEMA,
  describeDocumentNameIssue,
  documentIdFromName,
  formatRevisionHeader,
  isDfgManifest,
  isPageFileId,
  isValidDocumentName,
  pageFileId,
  parseRevisionHeader,
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

  it('分因：空 / 超长（≤64）/ 非法字符 各归其因，合规为 null（UX-11 文案真源）', () => {
    expect(describeDocumentNameIssue('我的设计')).toBeNull();
    expect(describeDocumentNameIssue('a'.repeat(64))).toBeNull();
    expect(describeDocumentNameIssue('')).toBe('empty');
    expect(describeDocumentNameIssue('   ')).toBe('empty');
    expect(describeDocumentNameIssue('a'.repeat(65))).toBe('too_long');
    expect(describeDocumentNameIssue('a/b')).toBe('invalid');
    expect(describeDocumentNameIssue('.hidden')).toBe('invalid');
    expect(describeDocumentNameIssue('a\u0001b')).toBe('invalid');
    expect(describeDocumentNameIssue(42)).toBe('invalid');
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

describe('documents · 页文件 id 与默认页（单一真源）', () => {
  it('pageFileId 由 0 起的页面序号派生 page-{N}', () => {
    expect(pageFileId(0)).toBe('page-1');
    expect(pageFileId(1)).toBe('page-2');
    expect(pageFileId(41)).toBe('page-42');
  });

  it('默认页身份 = page-1 / 页面 1（新建文档的占位页）', () => {
    expect(DEFAULT_PAGE_ID).toBe('page-1');
    expect(DEFAULT_PAGE_ID).toBe(pageFileId(0));
    expect(DEFAULT_PAGE_NAME).toBe('页面 1');
  });

  it('isPageFileId 与 daemon 页 id 白名单同口径（合法/非法各档）', () => {
    expect(isPageFileId('page-1')).toBe(true);
    // 引擎历史缺省 id 仍落在白名单内（可作 daemon 页文件 id）
    expect(isPageFileId('page_1')).toBe(true);
    expect(isPageFileId('page-editor')).toBe(true);
    expect(isPageFileId('')).toBe(false);
    expect(isPageFileId('.')).toBe(false);
    expect(isPageFileId('..')).toBe(false);
    expect(isPageFileId('a/b')).toBe(false);
    expect(isPageFileId('a b')).toBe(false);
    expect(isPageFileId('页-1')).toBe(false);
    expect(isPageFileId('a'.repeat(65))).toBe(false);
    expect(isPageFileId(42)).toBe(false);
  });
});

describe('documents · 保存冲突检测的条件头（audit-d06 · D-05）', () => {
  it('formatRevisionHeader：非负整数 → 十进制串；其余拒绝', () => {
    expect(formatRevisionHeader(0)).toBe('0');
    expect(formatRevisionHeader(41)).toBe('41');
    expect(() => formatRevisionHeader(-1)).toThrow();
    expect(() => formatRevisionHeader(1.5)).toThrow();
    expect(() => formatRevisionHeader(Number.NaN)).toThrow();
  });

  it('parseRevisionHeader：裸数字与带引号实体标签都接受；`*`/空串/小数/负数拒绝', () => {
    expect(parseRevisionHeader('7')).toBe(7);
    expect(parseRevisionHeader('"7"')).toBe(7);
    expect(parseRevisionHeader(' 42 ')).toBe(42);
    expect(parseRevisionHeader('0')).toBe(0);
    expect(parseRevisionHeader('*')).toBeNull();
    expect(parseRevisionHeader('')).toBeNull();
    expect(parseRevisionHeader('""')).toBeNull();
    expect(parseRevisionHeader('1.5')).toBeNull();
    expect(parseRevisionHeader('-3')).toBeNull();
    expect(parseRevisionHeader('abc')).toBeNull();
    expect(parseRevisionHeader('W/"7"')).toBeNull(); // 弱实体标签不属于 revision 形态
  });

  it('format → parse 往返恒等（两端单一判据的往返钉）', () => {
    for (const revision of [0, 1, 9, 41, 4096]) {
      expect(parseRevisionHeader(formatRevisionHeader(revision))).toBe(revision);
    }
  });
});
