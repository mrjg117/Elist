/**
 * 密码学工具：全部基于 Web Crypto（crypto.subtle），零外部依赖、最快。
 * - SHA-256（AWS SigV4 等签名）
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
