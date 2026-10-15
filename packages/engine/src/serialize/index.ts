/**
 * 序列化层公开面：Design IR ⇄ JSON（稳定键序、信封版本、结构校验、幂等往返）。
 */

export type { DesignIrEnvelope, ParsedDocument } from './serialize';
export {
  cloneDocument,
  DESIGN_IR_FORMAT,
  DESIGN_IR_VERSION,
  documentEnvelope,
  documentStats,
  parseDocument,
  roundTripDocument,
  serializeDocument,
  serializePage,
  sortKeysDeep,
  stableStringify,
} from './serialize';
