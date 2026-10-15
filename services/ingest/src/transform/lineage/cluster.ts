/**
 * 同源聚合与近重复（规格 §2.6）。
 *
 * 三条判据（全部确定性、与输入顺序无关）：
 *   1. **精确重复**：正文规范化（去 BOM/空白/许可头）后 sha256 相同 → 合并；
 *   2. **近重复**：正文 >5KB 用 Shingle(5-gram)+MinHash(128)+LSH(b=16,r=8)，阈值 ≈0.85；
 *      ≤5KB 用 SimHash(64) 汉明距离（阈值 8/64 ≈ 87.5% 相似）；
 *   3. **结构同源**：`upstream` 相同 → 必进同簇；目录指纹 Jaccard ≥0.9 自动合并、
 *      0.7–0.9 进人工队列（不自动合并）。
 *
 * 簇 id = `cl-<sha256(排序成员资产 id 拼串) 前 16 hex>`：与发现顺序无关，可离线复现。
 */

import { createHash } from 'node:crypto';

import type { AssetKind } from '../types.ts';
import { bodyFingerprint } from './digest.ts';

/** 近重复阈值与参数（规格 §2.6.2 草案，落成常量便于复核）。 */
export const NEAR_DUP_MINHASH_SIZE = 128;
export const NEAR_DUP_BANDS = 16;
export const NEAR_DUP_ROWS = 8;
export const NEAR_DUP_THRESHOLD = 0.85;
export const SIMHASH_BITS = 64;
export const SIMHASH_MAX_DISTANCE = 8;
export const LARGE_BODY_BYTES = 5 * 1024;
export const FINGERPRINT_MERGE = 0.9;
export const FINGERPRINT_REVIEW = 0.7;

export interface ClusterAssetInput {
  assetId: string;
  kind: AssetKind;
  /** 资产根相对路径（空串 = 仓根）。 */
  root: string;
  /** 资产根下全部相对路径（目录指纹）。 */
  filePaths: string[];
  /** 可取回时的正文（近重复判据）；不可得为 null。 */
  bodyText: string | null;
  /** 同源上游（`owner/repo` 或 URL），未声明为 null。 */
  upstream: string | null;
}

export type ClusterReason =
  | 'exact-dup'
  | 'near-dup'
  | 'fingerprint'
  | 'upstream'
  | 'manual-review'
  | 'singleton';

export interface ClusterAssignment {
  assetId: string;
  clusterId: string;
  clusterSize: number;
  reason: ClusterReason;
  /** 与簇内「代表成员」的相似度（0–1）；单例为 null。 */
  similarity: number | null;
  /** 0.7–0.9 指纹相似：进人工队列，不自动合并。 */
  reviewQueue: boolean;
  /** 人工队列中的对手资产 id（稳定排序）。 */
  reviewWith: string[];
}

export interface ClusterResult {
  assignments: Map<string, ClusterAssignment>;
  /** 簇 id → 成员资产 id（稳定排序）。 */
  members: Map<string, string[]>;
  /** 近重复/合并判定留痕（供证据 JSON 与人工复核）。 */
  pairReports: { a: string; b: string; reason: ClusterReason; similarity: number }[];
}

/** 正文规范化与内容指纹由 digest.ts 提供（与哈希同源）。 */
export { bodyFingerprint, normalizeBody } from './digest.ts';

/** Jaccard 相似度（集合语义，空集对空集记为 1）。 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 字符 5-gram（shingle；规格 §2.6.2）。 */
export function shingles(text: string, size = 5): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= size) return normalized === '' ? [] : [normalized];
  const out: string[] = [];
  for (let index = 0; index + size <= normalized.length; index += 1) {
    out.push(normalized.slice(index, index + size));
  }
  return out;
}

/** 最小哈希签名（128 维）：h_i(x) = (h1 + i·h2) mod p 的全域哈希族。 */
export function minhashSignature(text: string, size = NEAR_DUP_MINHASH_SIZE): Uint32Array {
  const values = shingles(text);
  const signature = new Uint32Array(size).fill(0xffffffff);
  const MOD = 4294967291; // 2^32 - 5（素数）
  for (const shingle of values) {
    const digest = createHash('sha256').update(shingle, 'utf8').digest();
    const h1 = digest.readUInt32BE(0) % MOD;
    const h2 = 1 + (digest.readUInt32BE(4) % (MOD - 1));
    for (let index = 0; index < size; index += 1) {
      // `>>> 0` 把 Math.imul 的有符号结果拉回无符号域，否则负值会污染 min 签名
      const hash = (h1 + (Math.imul(index, h2) >>> 0)) % MOD;
      if (hash < (signature[index] ?? 0xffffffff)) signature[index] = hash;
    }
  }
  return signature;
}

/** 由签名估计 Jaccard（相等的签名位占比）。 */
export function signatureSimilarity(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let equal = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] === b[index]) equal += 1;
  return equal / a.length;
}

/** SimHash(64)：词 bigram 的词频哈希按位加权（≤5KB 正文用，规格 §2.6.2）。 */
export function simhash64(text: string): bigint {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
  const grams: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;
    grams.push(word);
    const next = words[index + 1];
    if (next !== undefined) grams.push(`${word} ${next}`);
  }
  const weights = new Array<number>(SIMHASH_BITS).fill(0);
  for (const gram of grams) {
    const digest = createHash('sha256').update(gram, 'utf8').digest();
    for (let bit = 0; bit < SIMHASH_BITS; bit += 1) {
      const byte = digest[bit >> 3] ?? 0;
      const isSet = (byte & (1 << (bit % 8))) !== 0;
      weights[bit] = (weights[bit] ?? 0) + (isSet ? 1 : -1);
    }
  }
  let hash = 0n;
  for (let bit = 0; bit < SIMHASH_BITS; bit += 1) {
    if ((weights[bit] ?? 0) > 0) hash |= 1n << BigInt(bit);
  }
  return hash;
}

/** 汉明距离（SimHash 判据）。 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    if ((xor & 1n) === 1n) count += 1;
    xor >>= 1n;
  }
  return count;
}

/** LSH 分桶键（b 段 × r 行；用于 >5KB 正文的候选筛选）。 */
function lshBandKeys(signature: Uint32Array): string[] {
  const keys: string[] = [];
  for (let band = 0; band < NEAR_DUP_BANDS; band += 1) {
    const start = band * NEAR_DUP_ROWS;
    keys.push(signature.slice(start, start + NEAR_DUP_ROWS).join(','));
  }
  return keys;
}

interface UnionFind {
  find(key: string): string;
  union(a: string, b: string): void;
}

function createUnionFind(): UnionFind {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key);
    if (current === undefined || current === key) {
      parent.set(key, key);
      return key;
    }
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  return {
    find,
    union(a, b) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootA < rootB ? rootB : rootA, rootA < rootB ? rootA : rootB);
    },
  };
}

/** 簇 id：成员 id 排序拼串后取 sha256 前 16 hex（与发现顺序无关）。 */
export function clusterIdOf(memberIds: readonly string[]): string {
  const sorted = [...memberIds].sort();
  const digest = createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
  return `cl-${digest.slice(0, 16)}`;
}

/** 同源聚合与近重复归一（规格 §2.6；返回分配结果 + 判定留痕）。 */
export function assignClusters(assets: ClusterAssetInput[]): ClusterResult {
  const sorted = [...assets].sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
  const union = createUnionFind();
  const pairReports: ClusterResult['pairReports'] = [];
  const reviewPairs: { a: string; b: string; similarity: number }[] = [];

  const connect = (
    a: ClusterAssetInput,
    b: ClusterAssetInput,
    reason: ClusterReason,
    similarity: number,
  ) => {
    union.union(a.assetId, b.assetId);
    pairReports.push({ a: a.assetId, b: b.assetId, reason, similarity });
  };

  // 1) 精确重复（规范化正文同 hash）
  const byFingerprint = new Map<string, ClusterAssetInput>();
  for (const asset of sorted) {
    if (asset.bodyText === null) continue;
    const fingerprint = bodyFingerprint(asset.bodyText);
    const existing = byFingerprint.get(fingerprint);
    if (existing === undefined) byFingerprint.set(fingerprint, asset);
    else connect(existing, asset, 'exact-dup', 1);
  }

  // 2) 结构同源：upstream 相同必进同簇
  const byUpstream = new Map<string, ClusterAssetInput>();
  for (const asset of sorted) {
    if (asset.upstream === null) continue;
    const key = asset.upstream.toLowerCase();
    const existing = byUpstream.get(key);
    if (existing === undefined) byUpstream.set(key, asset);
    else connect(existing, asset, 'upstream', 1);
  }

  // 3) 目录指纹：≥0.9 合并，0.7–0.9 人工队列（两侧文件列表均非空才判定——
  //    「都没有文件」不构成同源证据，不得据此合并）
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b === undefined) continue;
      if (a.kind !== b.kind) continue;
      if (a.filePaths.length === 0 || b.filePaths.length === 0) continue;
      const similarity = jaccard(a.filePaths, b.filePaths);
      if (similarity >= FINGERPRINT_MERGE) connect(a, b, 'fingerprint', similarity);
      else if (similarity >= FINGERPRINT_REVIEW) {
        reviewPairs.push({ a: a.assetId, b: b.assetId, similarity });
      }
    }
  }

  // 4) 近重复：>5KB 走 MinHash+LSH，≤5KB 走 SimHash
  const withBody = sorted.filter((asset) => asset.bodyText !== null);
  const bands = new Map<string, number[]>();
  for (let index = 0; index < withBody.length; index += 1) {
    const asset = withBody[index];
    if (asset?.bodyText === null || asset?.bodyText === undefined) continue;
    if (Buffer.byteLength(asset.bodyText, 'utf8') <= LARGE_BODY_BYTES) continue;
    const signature = minhashSignature(asset.bodyText);
    lshBandKeys(signature).forEach((key, band) => {
      const bucketKey = `${band}:${key}`;
      const bucket = bands.get(bucketKey);
      if (bucket === undefined) bands.set(bucketKey, [index]);
      else bucket.push(index);
    });
  }
  const candidatePairs = new Set<string>();
  for (const bucket of bands.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left === undefined || right === undefined) continue;
        const a = Math.min(left, right);
        const b = Math.max(left, right);
        candidatePairs.add(`${a}:${b}`);
      }
    }
  }
  const signatureCache = new Map<number, Uint32Array>();
  for (const pair of [...candidatePairs].sort()) {
    const [left, right] = pair.split(':').map((value) => Number(value));
    if (left === undefined || right === undefined) continue;
    const a = withBody[left];
    const b = withBody[right];
    if (a?.bodyText == null || b?.bodyText == null) continue;
    const sigA = signatureCache.get(left) ?? minhashSignature(a.bodyText);
    signatureCache.set(left, sigA);
    const sigB = signatureCache.get(right) ?? minhashSignature(b.bodyText);
    signatureCache.set(right, sigB);
    const similarity = signatureSimilarity(sigA, sigB);
    if (similarity >= NEAR_DUP_THRESHOLD) connect(a, b, 'near-dup', similarity);
  }
  const simhashCache = new Map<string, bigint>();
  for (let i = 0; i < withBody.length; i += 1) {
    const a = withBody[i];
    if (a?.bodyText == null || Buffer.byteLength(a.bodyText, 'utf8') > LARGE_BODY_BYTES) continue;
    const hashA = simhashCache.get(a.assetId) ?? simhash64(a.bodyText);
    simhashCache.set(a.assetId, hashA);
    for (let j = i + 1; j < withBody.length; j += 1) {
      const b = withBody[j];
      if (b?.bodyText == null || Buffer.byteLength(b.bodyText, 'utf8') > LARGE_BODY_BYTES) continue;
      const hashB = simhashCache.get(b.assetId) ?? simhash64(b.bodyText);
      simhashCache.set(b.assetId, hashB);
      const distance = hammingDistance(hashA, hashB);
      if (distance <= SIMHASH_MAX_DISTANCE) {
        connect(a, b, 'near-dup', Math.round((1 - distance / SIMHASH_BITS) * 100) / 100);
      }
    }
  }

  const members = new Map<string, string[]>();
  for (const asset of sorted) {
    const root = union.find(asset.assetId);
    const list = members.get(root);
    if (list === undefined) members.set(root, [asset.assetId]);
    else list.push(asset.assetId);
  }

  const reviewWith = new Map<string, Set<string>>();
  for (const pair of reviewPairs) {
    const record = pairReports;
    record.push({ a: pair.a, b: pair.b, reason: 'manual-review', similarity: pair.similarity });
    for (const [self, other] of [
      [pair.a, pair.b],
      [pair.b, pair.a],
    ] as const) {
      const set = reviewWith.get(self) ?? new Set<string>();
      set.add(other);
      reviewWith.set(self, set);
    }
  }

  // 归属依据按证据强度取优先级：精确重复 > upstream > 近重复 > 目录指纹
  const REASON_PRIORITY: ClusterReason[] = ['exact-dup', 'upstream', 'near-dup', 'fingerprint'];
  const bestByAsset = new Map<string, { reason: ClusterReason; similarity: number }>();
  for (const report of pairReports) {
    if (report.reason === 'manual-review') continue;
    for (const assetId of [report.a, report.b]) {
      const current = bestByAsset.get(assetId);
      const rank = REASON_PRIORITY.indexOf(report.reason);
      const currentRank =
        current === undefined ? Number.POSITIVE_INFINITY : REASON_PRIORITY.indexOf(current.reason);
      if (
        current === undefined ||
        rank < currentRank ||
        (rank === currentRank && report.similarity > current.similarity)
      ) {
        bestByAsset.set(assetId, { reason: report.reason, similarity: report.similarity });
      }
    }
  }

  const assignments = new Map<string, ClusterAssignment>();
  for (const asset of sorted) {
    const root = union.find(asset.assetId);
    const clusterMembers = members.get(root) ?? [asset.assetId];
    const best = clusterMembers.length > 1 ? bestByAsset.get(asset.assetId) : undefined;
    const review = [...(reviewWith.get(asset.assetId) ?? [])].sort();
    assignments.set(asset.assetId, {
      assetId: asset.assetId,
      clusterId: clusterIdOf(clusterMembers),
      clusterSize: clusterMembers.length,
      reason: best?.reason ?? 'singleton',
      similarity: best === undefined ? null : Math.round(best.similarity * 100) / 100,
      reviewQueue: review.length > 0,
      reviewWith: review,
    });
  }

  pairReports.sort((a, b) => (a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : 1));
  return { assignments, members, pairReports };
}
