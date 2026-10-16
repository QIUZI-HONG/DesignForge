/**
 * 违规夹具⑥（guard-vocab）：内联字面量数组（`.includes([...])` 链）——不是 const 声明，
 * 但同样是「层内再写一份词表」，全部元素落在同一登记词表（长度 ≥2）时必须 exit 1。
 */
export function isKnownKind(value: string): boolean {
  return ['skill', 'plugin', 'design-system', 'template'].includes(value);
}
