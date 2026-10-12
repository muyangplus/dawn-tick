/**
 * 预设快照的哈希口径（全仓唯一实现）。
 *
 * 为什么放在 core：需要这个口径的地方有三个——
 *   1. Web 端 `apps/web/src/preset-update.ts` 的下载校验（浏览器里同步判定，不能等异步）；
 *   2. 内置快照的自检 `verifyBuiltinPresetSnapshot()`（Node / 三端同判）；
 *   3. 同步脚本 `tools/presets/sync-snapshot.mjs` 的复算校验。
 * 三处必须是同一份实现：不同实现会让「同一个快照在两端得到不同结论」这类问题难以定位。
 * 实现放在这里，Web 端与同步脚本只做转出/直接 import，不各存一份。
 *
 * 为什么是**纯 TS**、不用 `node:crypto`：同一份代码要跑在浏览器里。
 * Vite 会把 `node:crypto` 标记为「为浏览器外部化」，产出的 `createHash` 只是空壳，调用即抛错
 * （轻则页面启动时报错，重则预设校验静默失效）。实现自己写的 SHA-256，
 * 不用任何平台 API，Node 24（同步脚本、单测）与浏览器得到完全相同的哈希。
 *
 * 口径与预设仓库 `dawn-tick-presets` 的 `scripts/snapshot.mjs` 完全一致：
 *   哈希 = sha256( canonicalJson(去掉 hash 字段后的快照对象) )，写作 `sha256:<hex>`。
 * 其中 canonicalJson 对对象键排序、数组保序、无多余空白，同一份数据在任何机器上同哈希。
 */

/** SHA-256 轮常量。 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 初始状态。 */
const SHA256_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** Uint32Array 取值：本仓库开了 noUncheckedIndexedAccess，越界时按 0 处理（调用点不会越界）。 */
function at(values: Uint32Array, index: number): number {
  return values[index] ?? 0;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** 状态字按大端写成 hex：不能直接读 buffer 的字节，那样会带上平台字节序。 */
function toHex(state: Uint32Array): string {
  let hex = '';
  for (let index = 0; index < 8; index += 1) hex += at(state, index).toString(16).padStart(8, '0');
  return hex;
}

/**
 * 纯 TS 的 SHA-256（同步），输入按 UTF-8 处理，输出小写 hex。
 * 与 `createHash('sha256').update(text, 'utf8')` 逐字节等价（单测里用标准向量与长文本对拍）。
 */
export function sha256HexSync(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  // 补位：0x80 + 若干 0，末尾 8 字节写原始比特长度，整体是 64 字节的整数倍
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const state = new Uint32Array(SHA256_H);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = at(words, index - 15);
      const y = at(words, index - 2);
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      words[index] = (at(words, index - 16) + s0 + at(words, index - 7) + s1) >>> 0;
    }

    let a = at(state, 0);
    let b = at(state, 1);
    let c = at(state, 2);
    let d = at(state, 3);
    let e = at(state, 4);
    let f = at(state, 5);
    let g = at(state, 6);
    let h = at(state, 7);

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + at(SHA256_K, index) + at(words, index)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (at(state, 0) + a) >>> 0;
    state[1] = (at(state, 1) + b) >>> 0;
    state[2] = (at(state, 2) + c) >>> 0;
    state[3] = (at(state, 3) + d) >>> 0;
    state[4] = (at(state, 4) + e) >>> 0;
    state[5] = (at(state, 5) + f) >>> 0;
    state[6] = (at(state, 6) + g) >>> 0;
    state[7] = (at(state, 7) + h) >>> 0;
  }

  return toHex(state);
}

/**
 * 规范化 JSON 序列化：对象键排序、数组保序、无多余空白。
 * 产物只用于求哈希，不用于落盘展示。
 */
export function canonicalPresetJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalPresetJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalPresetJson(record[key])}`).join(',')}}`;
}
