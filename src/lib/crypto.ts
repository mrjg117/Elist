/**
 * 密码学工具：全部基于 Web Crypto（crypto.subtle），零外部依赖、最快。
 * - SHA-256 文件/密码哈希（.passwd 用）
 * - HMAC-SHA256（AWS SigV4 签名）
 * - RSASSA-PKCS1-v1_5 / SHA-256（OneDrive E5 证书 JWT 签名、管理端请求验签）
 */

export function bufToHex(b: ArrayBuffer): string {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlFromString(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bufToHex(digest);
}

/** HMAC-SHA256，返回 hex。key 可为字符串或原始字节。 */
export async function hmacHex(key: string | ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacRaw(key, data);
  return bufToHex(sig);
}

/** HMAC-SHA256，返回原始字节（用于 AWS SigV4 密钥链派生）。 */
export async function hmacRaw(
  key: string | ArrayBuffer,
  data: string
): Promise<ArrayBuffer> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

/** 从 PEM 文本提取 DER（私钥/公钥），用于 Web Crypto importKey。 */
export function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-V1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-V1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/** RSA 签名后做 base64url（用于 JWT 片段）。 */
export async function signRs256(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-V1_5',
    key,
    new TextEncoder().encode(data)
  );
  return b64url(sig);
}

/** 验签（管理端请求鉴权用）。 */
export async function verifyRs256(
  key: CryptoKey,
  data: string,
  sigB64url: string
): Promise<boolean> {
  // sigB64url -> 还原为标准 base64 的 ArrayBuffer
  const b64 = sigB64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-V1_5',
      key,
      bytes,
      new TextEncoder().encode(data)
    );
  } catch {
    return false;
  }
}

/** 随机 UUID（分享 id 等用）。 */
export function uuid(): string {
  // @ts-ignore crypto.randomUUID 在 Workers 可用
  return crypto.randomUUID();
}

// ---- TOTP（访问门禁用，非密钥）----
// 仅用于校验用户提交的 6 位动态码，配合固定密码做二因素；单靠 TOTP 不当密钥。

/** RFC 4648 base32 解码（TOTP 密钥常见格式）。 */
export function base32Decode(s: string): Uint8Array<ArrayBuffer> {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alpha.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** 计算某时刻的 TOTP 6 位码（步长 30s）。 */
export async function totpAt(secretB32: string, timeSec: number): Promise<string> {
  const key = base32Decode(secretB32);
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, Math.floor(timeSec / 30)); // 高 32 位为 0，低 32 位为时间计数器
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, buf));
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

/** 校验 TOTP 码（容许 ±1 个时间窗以兼容时钟漂移）。 */
export async function verifyTotp(secretB32: string, code: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (const w of [-1, 0, 1]) {
    if ((await totpAt(secretB32, now + w * 30)) === code) return true;
  }
  return false;
}
