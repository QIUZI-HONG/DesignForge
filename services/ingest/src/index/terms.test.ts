import { describe, expect, it } from 'vitest';

import {
  classOf,
  expandEquivalents,
  indexText,
  TERM_EQUIVALENCE_CLASSES,
  TERM_TABLE_VERSION,
  tokenizeText,
} from './terms.ts';

describe('tokenizeText · 分词基线', () => {
  it('拉丁词小写化 + 复数归并', () => {
    expect(tokenizeText('PPT Decks SLIDES')).toEqual(['ppt', 'deck', 'slide']);
  });

  it('中文按重叠二元组切分（无词典依赖）', () => {
    expect(tokenizeText('幻灯片')).toEqual(['幻灯', '灯片']);
    expect(tokenizeText('幻灯片模板')).toEqual(['幻灯', '灯片', '片模', '模板']);
  });

  it('中文长 run 按二元组、单字 run 保留单字', () => {
    expect(tokenizeText('配色与图标')).toEqual(['配色', '色与', '与图', '图标']);
    expect(tokenizeText('配 色')).toEqual(['配', '色']);
  });

  it('中英混排与标点/数字分离', () => {
    expect(tokenizeText('HTML 幻灯片：16:9 模板（v2）')).toEqual([
      'html',
      '幻灯',
      '灯片',
      '16',
      '9',
      '模板',
      'v2',
    ]);
  });

  it('空串与纯标点 → 空数组', () => {
    expect(tokenizeText('')).toEqual([]);
    expect(tokenizeText('—— ··· ！？')).toEqual([]);
  });
});

describe('术语等价类 · 中英映射（"PPT/幻灯片/deck" 起步表）', () => {
  it('查询「幻灯片」命中 deck 等价类', () => {
    expect(expandEquivalents(tokenizeText('幻灯片'))).toContain('ppt');
  });

  it('查询「PPT」命中中文资产（canonical 反向可达）', () => {
    expect(expandEquivalents(tokenizeText('PPT'))).toContain('ppt');
  });

  it('多词短语「design system」命中 设计系统 等价类', () => {
    const expanded = expandEquivalents(tokenizeText('design system'));
    expect(expanded).toContain('设计系统');
  });

  it('连字符写法「design-system」同样归一（连字符按分隔符处理）', () => {
    expect(expandEquivalents(tokenizeText('design-system'))).toContain('设计系统');
  });

  it('中文「设计系统」自身即 canonical（索引侧与查询侧对称）', () => {
    expect(expandEquivalents(tokenizeText('设计系统'))).toContain('设计系统');
  });

  it('等价扩展不越界：无关查询不引入无关 canonical', () => {
    const expanded = expandEquivalents(tokenizeText('导出'));
    expect(expanded).not.toContain('ppt');
    expect(expanded).not.toContain('设计系统');
    // canonical 即成员自身（类首 = 中文）时不产生多余 token
    expect(expanded).toEqual(tokenizeText('导出'));
  });

  it('术语表版本号存在且为正整数（进检索索引产物溯源）', () => {
    expect(TERM_TABLE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('覆盖起步表 + 设计域词族（≥10 类；每类含中英两侧）', () => {
    expect(TERM_EQUIVALENCE_CLASSES.length).toBeGreaterThanOrEqual(10);
    for (const members of TERM_EQUIVALENCE_CLASSES) {
      const hasCjk = members.some((member) => /[\u4E00-\u9FFF]/.test(member));
      const hasLatin = members.some((member) => /[a-z]/.test(member));
      expect(hasCjk, `类 ${members[0]} 应含中文成员`).toBe(true);
      expect(hasLatin, `类 ${members[0]} 应含英文成员`).toBe(true);
    }
  });

  it('classOf 可解释（返回成员表，供命中原因展示）', () => {
    expect(classOf('deck')).toContain('幻灯片');
    expect(classOf('幻灯片')).toContain('deck');
    expect(classOf('不存在的词')).toBeNull();
  });
});

describe('indexText · 索引侧与查询侧同一入口', () => {
  it('文档侧：中文资产可被英文等价词命中（canonical 入库）', () => {
    const tokens = indexText('用网页技术制作 PPT 演示文稿');
    expect(tokens).toContain('ppt');
    // 中文长词以二元组形态入库（同一 word 拆成相邻二词组）
    expect(tokens).toEqual(expect.arrayContaining(['演示', '示文', '文稿']));
  });

  it('文档侧：多词短语在索引时展开', () => {
    const tokens = indexText('DTCG tokens with light and dark themes, a design system starter');
    expect(tokens).toContain('设计系统');
    expect(tokens).toContain('token');
  });

  it('保持原 token 顺序在前（tf 与可解释性依赖原始词序）', () => {
    const tokens = indexText('幻灯片模板');
    expect(tokens.slice(0, 4)).toEqual(['幻灯', '灯片', '片模', '模板']);
  });
});
