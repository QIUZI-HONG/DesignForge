/**
 * 首页 → 编辑器跳转路径测试（FE-02）。
 *
 * 为什么单独一个模块：`/editor` 路由归 FE-03；首页只负责产出**正确的跳转地址**
 * （id 需 URL 编码），两边对地址形状的口径收敛在这里一处，避免各组件各拼一份。
 */
import { describe, expect, it } from 'vitest';

import { editorHref } from './routes';

describe('editorHref', () => {
  it('带上 documentId 查询参数', () => {
    expect(editorHref('海报-A')).toBe('/editor?documentId=%E6%B5%B7%E6%8A%A5-A');
  });

  it('含特殊字符的 id 被编码（不截断路径）', () => {
    expect(editorHref('a/b?c=d')).toBe('/editor?documentId=a%2Fb%3Fc%3Dd');
  });
});
