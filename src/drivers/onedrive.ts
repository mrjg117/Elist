import type { Driver, Entry, Mount, Env } from '../types';
import { BaseDriver } from './base';
import { importRsaPrivateKey, signRs256, uuid, b64urlFromString, certX5t } from '../lib/crypto';

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
 * OneDrive 驱动（组织租户证书 app-only，全球版）。
 * - Azure 证书凭据 client_credentials（RS256 JWT 自签 client_assertion），无 refresh_token、无 2 年失效。
 * - 下载：取 Graph 原生 `@microsoft.graph.downloadUrl` -> 302 直出（浏览器原生 Range 多线程）。
 * - 凭据（含证书私钥）随账号 JSON 经 secret 注入，不再用全局 env。
 */
export class OneDriveDriver extends BaseDriver implements Driver {
  private tenantId = '';
  private clientId = '';
  private thumbprint = '';     // 可显式给（旧配置兼容）；不给则从 cert_pem 自动算
  private certPem = '';        // 公钥证书 PEM（上传到 Azure 的那张），用于自动算 x5t 指纹
  private certKeyPem = '';     // 组织租户证书私钥 PEM（来自账号 JSON，非全局 env）
  private userId = '';         // 要挂载的用户 UPN / objectId（app-only 无 /me，必须指定）
  private certKey: CryptoKey | null = null;
  private key = '';            // 缓存键（挂载 path+root）

  init(mount: Mount, _env: Env): void {
    super.init(mount);
    const a = mount.addition;
    this.tenantId = a.tenant_id || '';
    this.clientId = a.client_id || '';
    this.thumbprint = a.cert_thumbprint || '';
    this.certPem = a.cert_pem || '';
    this.certKeyPem = a.cert_key || '';
    this.userId = a.user_id || '';
    if (!this.userId) throw new Error('onedrive app-only requires user_id (UPN or objectId)');
    this.key = mount.mount + (mount.root || '');
  }

  private async getToken(): Promise<string> {
    const cached = tokenCache.get(this.key);
    if (cached && Date.now() < cached.expireAt - 60_000) return cached.accessToken;

    const { token, expires_in } = await this.tokenByCert();
    tokenCache.set(this.key, { accessToken: token, expireAt: Date.now() + expires_in * 1000 });
    return token;
  }

  /**
   * 计算 JWT x5t 头：优先用变量显式给的 cert_thumbprint（兼容旧配置），
   * 否则从公钥证书 cert_pem 自动算 SHA-1 指纹并转 base64url，结果缓存到 this.thumbprint。
   * 这样用户不用关心 Azure 门户显示的 hex 指纹格式。
   */
  private async thumbprintValue(): Promise<string> {
    if (this.thumbprint) return this.thumbprint;
    if (!this.certPem) {
      throw new Error('onedrive requires cert_pem (public cert PEM) or explicit cert_thumbprint');
    }
    this.thumbprint = await certX5t(this.certPem);
    return this.thumbprint;
  }

  private async tokenByCert(): Promise<{ token: string; expires_in: number }> {
    const privPem = this.certKeyPem;
    if (!privPem) throw new Error('cert_key not set for onedrive mount');
    if (!this.certKey) this.certKey = await importRsaPrivateKey(privPem);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', x5t: await this.thumbprintValue() };
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
    if (!r.ok) throw new Error(`OD token failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as any;
    return { token: j.access_token, expires_in: j.expires_in };
  }

  /** 账号内绝对路径 -> Graph 列表地址（app-only 必须指定用户）。 */
  private addr(accountPath: string): string {
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/users/${encodeURIComponent(this.userId)}/drive/root/children`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/users/${encodeURIComponent(this.userId)}/drive/root:/${seg}:/children`;
  }

  private itemAddr(accountPath: string): string {
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/users/${encodeURIComponent(this.userId)}/drive/root`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/users/${encodeURIComponent(this.userId)}/drive/root:/${seg}:`;
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

  async readBinary(rest: string): Promise<ArrayBuffer | null> {
    const token = await this.getToken();
    const r = await fetch(this.itemAddr(this.toAccountPath(rest)) + '/content', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.arrayBuffer();
  }

  async writeBinary(rest: string, content: ArrayBuffer): Promise<void> {
    const token = await this.getToken();
    const r = await fetch(this.itemAddr(this.toAccountPath(rest)) + '/content', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
    if (!r.ok) throw new Error(`OneDrive write failed: ${r.status}`);
  }

  async writeText(rest: string, content: string): Promise<void> {
    const token = await this.getToken();
    const r = await fetch(this.itemAddr(this.toAccountPath(rest)) + '/content', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: content,
    });
    if (!r.ok) throw new Error(`OneDrive writeText failed: ${r.status}`);
  }

  async move(sourceRest: string, targetRest: string): Promise<void> {
    const token = await this.getToken();
    const sourceAp = this.toAccountPath(sourceRest);
    const targetAp = this.toAccountPath(targetRest);
    
    // 提取目标路径的父目录和新名称
    const lastSlash = targetAp.lastIndexOf('/');
    const parentAp = lastSlash > 0 ? targetAp.substring(0, lastSlash) : '/';
    const newName = targetAp.substring(lastSlash + 1);
    
    // 获取父目录的 driveItem ID
    const parentItem = await this.graphGet(this.itemAddr(parentAp), 'id');
    
    // 移动/重命名
    const r = await fetch(this.itemAddr(sourceAp), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parentReference: {
          driveId: parentItem.parentReference?.driveId,
          id: parentItem.id,
        },
        name: newName,
      }),
    });
    if (!r.ok) throw new Error(`OneDrive move failed: ${r.status}`);
  }

  async delete(rest: string): Promise<void> {
    const token = await this.getToken();
    const r = await fetch(this.itemAddr(this.toAccountPath(rest)), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`OneDrive delete failed: ${r.status}`);
  }

  async mkdir(rest: string): Promise<void> {
    const token = await this.getToken();
    const ap = this.toAccountPath(rest);
    
    // 提取父目录和新目录名
    const lastSlash = ap.lastIndexOf('/');
    const parentAp = lastSlash > 0 ? ap.substring(0, lastSlash) : '/';
    const dirName = ap.substring(lastSlash + 1);
    
    // 在父目录下创建子目录
    const r = await fetch(this.addr(parentAp), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: dirName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });
    if (!r.ok) throw new Error(`OneDrive mkdir failed: ${r.status}`);
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
