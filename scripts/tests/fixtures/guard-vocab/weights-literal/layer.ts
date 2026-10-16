/**
 * 违规夹具⑤（guard-vocab）：五维权重表写死对象字面量——评分与索引自洽校验一旦各抄
 * 一份就会互相打架，必须 exit 1 且点名 QUALITY_WEIGHTS。
 */
export const QUALITY_WEIGHTS = {
  spec: 0.25,
  maintenance: 0.2,
  docs: 0.2,
  security: 0.2,
  ecosystem: 0.15,
};
