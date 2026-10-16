/**
 * 违规夹具③（guard-vocab）：词表从**本地模块**import（伪真源）——根不在
 * @dforge/contracts，必须 exit 1。
 */
import { LAYER_KINDS } from './local-vocab.ts';

export const ASSET_KINDS: readonly string[] = LAYER_KINDS;
