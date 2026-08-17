import type { Context } from 'hono';
import type { Env } from '../types';
import { importRsaPublicKey, verifyRs256 } from '../lib/crypto';

/**
 * 管理端长效期鉴权（应用层，非传输层 mTLS）：
 * 客户端用私钥对 (method + path + timestamp + body-hash) 签名，
 * 服务端用 env.ADMIN_PUBKEY 验签；签名含时间戳防重放（默认 5 分钟窗口）。
 *
 * 用法：请求头
 *   X-Sign-Time: <unix ms>
 *   X-Sign:      <base64url 签名>
 * 签名原文 = `${method}\n${path}\n${time}\n${sha256(body)}`
 */
export async function verifyAdminRequest(
  c: Context<{ Bindings: Env }>,
  bodyHash: string
): Promise<boolean> {
  const pubPem = c.env.ADMIN_PUBKEY;
  if (!pubPem) return false; // 未配置公钥 = 关闭管理鉴权
  const time = c.req.header('X-Sign-Time');
  const sig = c.req.header('X-Sign');
  if (!time || !sig) return false;

  const now = Date.now();
  const t = Number(time);
  if (!Number.isFinite(t) || Math.abs(now - t) > 5 * 60 * 1000) return false; // 5 分钟重放窗口

  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const data = `${method}\n${path}\n${time}\n${bodyHash}`;

  const key = await importRsaPublicKey(pubPem);
  return verifyRs256(key, data, sig);
}
