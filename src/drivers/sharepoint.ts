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

// 默认文档库 id（懒解析，模块级单值缓存）
let resolvedDriveId = '';

/**
 * SharePoint 驱动（证书 app-only，只挂根站点 + 默认文档库）。
 * 鉴权同 OneDrive；地址用 drives/{driveId}。需 Sites.ReadWrite.All。
 */
export class SharePointDriver extends BaseDriver implements Driver {
  private tenantId = '';
  private clientId = '';
  private thumbprint = '';     // x5t（base64url 指纹），配置直接给
  private certKeyPem = '';     // 证书私钥 PEM
  private certKey: CryptoKey | null = null;
  private key = '';            // 缓存键（挂载 path+root）

  init(mount: Mount, _env: Env): void {
    super.init(mount);
    const a = mount.addition;
    this.tenantId = a.tenant_id || '';
    this.clientId = a.client_id || '';
    this.thumbprint = a.cert_thumbprint || '';
    this.certKeyPem = a.cert_key || '';
    this.key = mount.mount + (mount.root || '');
  }

  private async getToken(): Promise<string> {
    const cached = tokenCache.get(this.key);
    if (cached && Date.now() < cached.expireAt - 60_000) return cached.accessToken;

    const { token, expires_in } = await this.tokenByCert();
    tokenCache.set(this.key, { accessToken: token, expireAt: Date.now() + expires_in * 1000 });
    return token;
  }

  private async tokenByCert(): Promise<{ token: string; expires_in: number }> {
    const privPem = this.certKeyPem;
    if (!this.certKeyPem) throw new Error('cert_key not set for sharepoint mount');
    if (!this.thumbprint) throw new Error('cert_thumbprint (base64url x5t) not set for sharepoint mount');
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
    if (!r.ok) throw new Error(`SP token failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as any;
    return { token: j.access_token, expires_in: j.expires_in };
  }

  /** 根站点 id → 默认文档库 id（懒解析，模块级单值缓存）。 */
  private async ensureResolved(): Promise<void> {
    if (resolvedDriveId) return;
    const site = await this.graphGet(`${GRAPH}/sites/root`);
    if (!site.id) throw new Error('SP resolve root site failed');
    const drive = await this.graphGet(`${GRAPH}/sites/${encodeURIComponent(site.id)}/drive`);
    if (!drive.id) throw new Error('SP resolve default drive failed');
    resolvedDriveId = drive.id;
  }

  /** 账号内绝对路径 -> Graph 列表地址（sharepoint drive）。 */
  private async addr(accountPath: string): Promise<string> {
    await this.ensureResolved();
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/drives/${resolvedDriveId}/root/children`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/drives/${resolvedDriveId}/items/root:/${seg}:/children`;
  }

  private async itemAddr(accountPath: string): Promise<string> {
    await this.ensureResolved();
    const ap = accountPath.replace(/^\//, '');
    if (!ap) return `${GRAPH}/drives/${resolvedDriveId}/root`;
    const seg = ap.split('/').map(encodeURIComponent).join('/');
    return `${GRAPH}/drives/${resolvedDriveId}/items/root:/${seg}:`;
  }

  private async graphGet(url: string, select = ''): Promise<any> {
    const token = await this.getToken();
    const u = select ? `${url}?$select=${select}` : url;
    return backoffFetch(u, { headers: { Authorization: `Bearer ${token}` } });
  }

  async list(rest: string): Promise<Entry[]> {
    const ap = this.toAccountPath(rest);
    const allEntries: Entry[] = [];
    let url: string | null = await this.addr(ap);

    while (url) {
      const data = await this.graphGet(url);
      const entries = (data.value || []).map((it: any) => this.toEntry(ap, it));
      allEntries.push(...entries);
      url = data['@odata.nextLink'] || null;
    }
    return allEntries;
  }

  async link(rest: string): Promise<string> {
    const item = await this.graphGet(
      await this.itemAddr(this.toAccountPath(rest)),
      '@microsoft.graph.downloadUrl'
    );
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('No downloadUrl from Graph');
    return url;
  }

  async readText(rest: string): Promise<string | null> {
    const token = await this.getToken();
    const r = await backoffFetchRaw((await this.itemAddr(this.toAccountPath(rest))) + '/content', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.text();
  }

  async readBinary(rest: string): Promise<ArrayBuffer | null> {
    const token = await this.getToken();
    const r = await backoffFetchRaw((await this.itemAddr(this.toAccountPath(rest))) + '/content', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.arrayBuffer();
  }

  async writeBinary(rest: string, content: ArrayBuffer): Promise<void> {
    const token = await this.getToken();
    const r = await backoffFetchRaw((await this.itemAddr(this.toAccountPath(rest))) + '/content', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
    if (!r.ok) throw new Error(`SharePoint write failed: ${r.status}`);
  }

  async writeText(rest: string, content: string): Promise<void> {
    const token = await this.getToken();
    const r = await backoffFetchRaw((await this.itemAddr(this.toAccountPath(rest))) + '/content', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: content,
    });
    if (!r.ok) throw new Error(`SharePoint writeText failed: ${r.status}`);
  }

  async move(sourceRest: string, targetRest: string): Promise<void> {
    const token = await this.getToken();
    const sourceAp = this.toAccountPath(sourceRest);
    const targetAp = this.toAccountPath(targetRest);

    const lastSlash = targetAp.lastIndexOf('/');
    const parentAp = lastSlash > 0 ? targetAp.substring(0, lastSlash) : '/';
    const newName = targetAp.substring(lastSlash + 1);

    const parentItem = await this.graphGet(await this.itemAddr(parentAp), 'id,parentReference');

    const r = await fetch(await this.itemAddr(sourceAp), {
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
    if (!r.ok) throw new Error(`SharePoint move failed: ${r.status}`);
  }

  async delete(rest: string): Promise<void> {
    const token = await this.getToken();
    const r = await fetch(await this.itemAddr(this.toAccountPath(rest)), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`SharePoint delete failed: ${r.status}`);
  }

  async mkdir(rest: string): Promise<void> {
    const token = await this.getToken();
    const ap = this.toAccountPath(rest);

    const lastSlash = ap.lastIndexOf('/');
    const parentAp = lastSlash > 0 ? ap.substring(0, lastSlash) : '/';
    const dirName = ap.substring(lastSlash + 1);

    const r = await fetch(await this.addr(parentAp), {
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
    if (!r.ok) throw new Error(`SharePoint mkdir failed: ${r.status}`);
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

/** 带退避的 fetch（SharePoint 同 OneDrive 限流，必须节流；5xx 服务端错误也重试）。 */
async function backoffFetch(url: string, init: RequestInit, attempt = 0): Promise<any> {
  const r = await fetch(url, init);
  if (r.status === 429 || r.status === 503 || (r.status >= 500 && r.status < 600)) {
    if (attempt > 4) throw new Error(`SP error: ${r.status}`);
    const wait = Math.min(2 ** attempt * 500, 8000);
    await new Promise((res) => setTimeout(res, wait));
    return backoffFetch(url, init, attempt + 1);
  }
  if (!r.ok) throw new Error(`Graph error: ${r.status} ${await r.text()}`);
  return r.json();
}

/** 带退避的 fetch，返回原始 Response（用于写操作）。 */
async function backoffFetchRaw(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const r = await fetch(url, init);
  if (r.status === 429 || r.status === 503 || (r.status >= 500 && r.status < 600)) {
    if (attempt > 4) throw new Error(`SP error: ${r.status}`);
    const wait = Math.min(2 ** attempt * 500, 8000);
    await new Promise((res) => setTimeout(res, wait));
    return backoffFetchRaw(url, init, attempt + 1);
  }
  return r;
}
