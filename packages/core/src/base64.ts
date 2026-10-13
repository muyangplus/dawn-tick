const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 文本按 UTF-8 编成标准 Base64（带 padding，不使用 URL 安全字符）。 */
export function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] as number;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2 & 63];
  }
  return out;
}

/**
 * 标准 Base64 还原成 UTF-8 文本。
 * 容忍换行与空格，也接受 URL 安全形式（`-` `_`）；长度或字符不合法时抛错。
 */
export function fromBase64Utf8(text: string): string {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean === '') return '';
  if (clean.length % 4 !== 0) throw new Error('Base64 长度不合法');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('Base64 含不合法字符');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    const value = (position: number): number => {
      const char = chunk[position];
      if (char === undefined || char === '=') return 0;
      const found = ALPHABET.indexOf(char);
      if (found < 0) throw new Error('Base64 含不合法字符');
      return found;
    };
    const v0 = value(0);
    const v1 = value(1);
    const v2 = value(2);
    const v3 = value(3);
    bytes.push(((v0 << 2) | (v1 >> 4)) & 0xff);
    if (chunk[2] !== '=') bytes.push(((v1 << 4) | (v2 >> 2)) & 0xff);
    if (chunk[3] !== '=') bytes.push(((v2 << 6) | v3) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
