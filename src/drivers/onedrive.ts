import type { Driver, Entry, Mount, Env } from '../types';
import { BaseDriver } from './base';
import { importRsaPrivateKey, signRs256, uuid, b64urlFromString } from '../lib/crypto';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

interface TokenCache {
  accessToken: string;
  expireAt: number; // ms
}
// 模块内存缓存（零 KV）：按挂载路径区分；多 isolate 各自缓存，略冗余但功能无碍。
const tokenCache = new Map<string, TokenCache>();

/**
 * OneDrive 驱动。
 * - E5 / 组织租户：Azure **证书凭据** client_credentials（RS256 JWT 自签 client_assertion），无 refresh_token、无 2 年失效。
 * - 个人版：delegated refresh_token（仍会过期，技术限制）。
 * - 下载：取 Graph 原生 `@microsoft.graph.downloadUrl` -> 302 直出（浏览器原生 Range 多线程）。
 * - 凭据（含证书私钥）随账号 JSON 经 secret 注入，不再用全局 env。
 */
export class OneDriveDriver extends BaseDriver implements Driver {
  private type: 'e5' | 'personal' = 'personal';
  private tenantId = '';
  private clientId = '';
  private thumbprint = '';
  private certKeyPem = '';     // E5 证书私钥 PEM（来自账号 JSON，非全局 env）
  private refreshToken = '';
  private clientSecret = '';
  private certKey: CryptoKey | null = null;
  private key = '';            // 缓存键（挂载 path+root）

  init(mount: Mount, _env: Env): void {
    super.init(mount);
    const a = mount.addition;
    this.type = a.type === 'onedrive-e5' ? 'e5' : 'personal';
    this.tenantId = a.tenant_id || '';
    this.clientId = a.client_id || '';
    this.thumbprint = a.cert_thumbprint || '';
    this.certKeyPem = a.cert_key || '';
    this.refreshToken = a.refresh_token || '';
    this.clientSecret = a.client_secret || '';
    this.key = mount.mount + (mount.root || '');
  }

  private async getToken(): Promise<string> {
    const cached = tokenCache.get(this.key);
    if (cached && Date.now() < cached.expireAt - 60_000) return cached.accessToken;

    let token: string;
    let expiresIn: number;
    if (this.type === 'e5') {
      const { token: t, expires_in } = await this.tokenByCert();
      token = t;
      expiresIn = expires_in;
    } else {
      const { token: t, expires_in } = await this.tokenByRefresh();
      token = t;
      expiresIn = expires_in;
    }
    tokenCache.set(this.key, { accessToken: token, expireAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  private async tokenByCert(): Promise<{ token: string; expires_in: number }> {
    const privPem = this.certKeyPem;
    if (!privPem) throw new Error('cert_key not set for E5 mount');
    if (!this.certKey) this.certKey = await importRsaPrivateKey(privPem);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', x5t: this.thumbprint };
    const payload = {
      aud: TOKEN_URL(this.tenantId),
      iss: this.clientId,
      sub: this.clientId,
      jti: uuid(),
      nbf: now - 30,
      exp: now + 600,
      iat: now,
    };
    const input = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(
      JSON.stringify(payload)
    )}`;
    const sig = await signRs256(this.certKey, input);
    const jwt = `${input}.${sig}`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: jwt,
      scope: 'https://graph.microsoft.com/.default',
    });
    const r = await fetch(TOKEN_URL(this.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`OD E5 token failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as any;
    return { token: j.access_token, expires_in: j.expires_in };
  }

  private async tokenByRefresh(): Promise<{ token: string; expires_in: number }> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: this.refreshToken,
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const r = await fetch(TOKEN_URL(this.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`OD refresh failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as any;
    // 个人版 refresh 可能返回新的 refresh_token，更新缓存以便下次使用
    if (j.refresh_token) this.refreshToken = j.refresh_token;
    return { token: j.access_token, expires_in: j.expires_in };
  }

  /** 账号内绝对路径 -> Graph 列表地址。 */
  private addr(accountPath: string): string {
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/me/drive/root/children`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/me/drive/root:/${seg}:/children`;
  }

  private itemAddr(accountPath: string): string {
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/me/drive/root`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/me/drive/root:/${seg}:`;
  }

  private async graphGet(url: string, select = ''): Promise<any> {
    const token = await this.getToken();
    const u = select ? `${url}?$select=${select}` : url;
    return backoffFetch(u, { headers: { Authorization: `Bearer ${token}` } });
  }

  async list(rest: string): Promise<Entry[]> {
    const ap = this.toAccountPath(rest);
    const data = await this.graphGet(this.addr(ap));
    return (data.value || []).map((it: any) => this.toEntry(ap, it));
  }

  async link(rest: string): Promise<string> {
    const item = await this.graphGet(
      this.itemAddr(this.toAccountPath(rest)),
      '@microsoft.graph.downloadUrl'
    );
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('No downloadUrl from Graph');
    return url;
  }

  async readText(rest: string): Promise<string | null> {
    const token = await this.getToken();
    const r = await fetch(this.itemAddr(this.toAccountPath(rest)) + '/content', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.text();
  }

  /** 递归索引（搜索用）：逐层 children + @odata.nextLink 翻页；节流+退避。 */
  async walk(rest: string): Promise<Entry[]> {
    const out: Entry[] = [];
    const stack: string[] = [this.toAccountPath(rest)];
    while (stack.length) {
      const cur = stack.pop()!;
      let url: string | null = this.addr(cur);
      while (url) {
        const data = await this.graphGet(url);
        for (const it of data.value || []) {
          const e = this.toEntry(cur, it);
          out.push(e);
          if (e.isDir) stack.push(cur === '/' ? '/' + it.name : cur + '/' + it.name);
        }
        url = data['@odata.nextLink'] || null;
      }
    }
    return out;
  }

  private toEntry(parentAccountPath: string, it: any): Entry {
    const isDir = !!it.folder;
    const name = it.name;
    const ap = (parentAccountPath === '/' ? '' : parentAccountPath) + '/' + name;
    return {
      name,
      path: this.toPath(ap),
      isDir,
      size: it.size,
      modified: it.lastModifiedDateTime,
      mime: it.file?.mimeType,
    };
  }
}

/** 带 429 退避的 fetch（OneDrive 限流阈值低，必须节流）。 */
async function backoffFetch(url: string, init: RequestInit, attempt = 0): Promise<any> {
  const r = await fetch(url, init);
  if (r.status === 429 || r.status === 503) {
    if (attempt > 4) throw new Error(`OD throttled: ${r.status}`);
    const wait = Math.min(2 ** attempt * 500, 8000);
    await new Promise((res) => setTimeout(res, wait));
    return backoffFetch(url, init, attempt + 1);
  }
  if (!r.ok) throw new Error(`Graph error: ${r.status} ${await r.text()}`);
  return r.json();
}
