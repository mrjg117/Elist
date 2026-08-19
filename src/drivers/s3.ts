import type { Driver, Entry, Mount, Env } from '../types';
import { BaseDriver } from './base';
import { sha256Hex, hmacRaw, hmacHex, bufToHex } from '../lib/crypto';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** URLSearchParams -> 普通对象（兼容该 TS lib 不认 URLSearchParams 可迭代）。 */
function paramsToObj(q: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  q.forEach((v, k) => (o[k] = v));
  return o;
}

/**
 * S3 / R2 / MinIO / OSS / COS 通用驱动。
 * - 列表：SigV4 **头签名** 调 ListObjectsV2（delimiter 取一层）。
 * - 下载：SigV4 **预签名 URL**（query 鉴权）-> 302 直出，浏览器原生 Range 多线程。
 * - 索引：list-type=2 无 delimiter 全量翻页（flat 扫描，ceil(N/1000) 次，极便宜）。
 * 不引 aws-sdk，包更小、冷启更快。
 */
export class S3Driver extends BaseDriver implements Driver {
  private endpoint = '';
  private host = '';
  private region = 'auto';
  private bucket = '';
  private ak = '';
  private sk = '';
  private linkTtl = 3600;      // S3 下载直链有效期（秒），可由 S3_LINK_TTL 覆盖

  init(mount: Mount, _env: Env): void {
    super.init(mount);
    const a = mount.addition;
    this.endpoint = (a.endpoint || '').replace(/\/$/, '');
    this.host = new URL(this.endpoint).host;
    this.region = a.region || 'auto';
    this.bucket = a.bucket;
    this.ak = a.access_key_id;
    this.sk = a.secret_access_key;
    const ttl = Number(_env?.S3_LINK_TTL);
    this.linkTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
  }

  // ---- SigV4 ----
  private async signHeaders(
    method: string,
    urlStr: string,
    query: Record<string, string>,
    bodyHash: string
  ): Promise<Record<string, string>> {
    const u = new URL(urlStr);
    const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const datestamp = amzdate.slice(0, 8);
    const scope = `${datestamp}/${this.region}/s3/aws4_request`;
    const qEntries = Object.entries(query).sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = qEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalHeaders = `host:${u.host}\n`;
    const signedHeaders = 'host';
    const canonicalRequest = [
      method,
      u.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzdate,
      scope,
      await sha256Hex(canonicalRequest),
    ].join('\n');
    const kDate = await hmacRaw('AWS4' + this.sk, datestamp);
    const kRegion = await hmacRaw(kDate, this.region);
    const kService = await hmacRaw(kRegion, 's3');
    const kSigning = await hmacRaw(kService, 'aws4_request');
    const signature = await hmacHex(kSigning, stringToSign);
    return {
      'x-amz-date': amzdate,
      'x-amz-content-sha256': bodyHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  /** 预签名 GET URL（query 鉴权），用于 302 直出与读取标记文件。 */
  private async presignGet(key: string, expires = 3600): Promise<string> {
    const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const datestamp = amzdate.slice(0, 8);
    const scope = `${datestamp}/${this.region}/s3/aws4_request`;
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.ak}/${scope}`,
      'X-Amz-Date': amzdate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'host',
    };
    const qEntries = Object.entries(query).sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = qEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalRequest = [
      'GET',
      `/${this.bucket}/${key}`,
      canonicalQuery,
      `host:${this.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzdate,
      scope,
      await sha256Hex(canonicalRequest),
    ].join('\n');
    const kDate = await hmacRaw('AWS4' + this.sk, datestamp);
    const kRegion = await hmacRaw(kDate, this.region);
    const kService = await hmacRaw(kRegion, 's3');
    const kSigning = await hmacRaw(kService, 'aws4_request');
    const signature = bufToHex(await hmacRaw(kSigning, stringToSign));
    return `${this.endpoint}/${this.bucket}/${key}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  // ---- 公开接口 ----
  async list(rest: string): Promise<Entry[]> {
    const prefix = this.toAccountPath(rest).replace(/^\//, '');
    const q = new URLSearchParams({
      'list-type': '2',
      prefix,
      delimiter: '/',
    });
    const url = `${this.endpoint}/${this.bucket}?${q.toString()}`;
    const headers = await this.signHeaders('GET', url, paramsToObj(q), EMPTY_SHA256);
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`S3 list failed: ${r.status}`);
    return this.parseList(await r.text(), rest);
  }

  async link(rest: string): Promise<string> {
    return this.presignGet(this.toAccountPath(rest).replace(/^\//, ''), this.linkTtl);
  }

  async readText(rest: string): Promise<string | null> {
    const url = await this.presignGet(this.toAccountPath(rest).replace(/^\//, ''), 60);
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.text();
  }

  async readBinary(rest: string): Promise<ArrayBuffer | null> {
    const url = await this.presignGet(this.toAccountPath(rest).replace(/^\//, ''), 60);
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return r.arrayBuffer();
  }

  async writeBinary(rest: string, content: ArrayBuffer): Promise<void> {
    const key = this.toAccountPath(rest).replace(/^\//, '');
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const bodyHash = await sha256Hex(content);
    const headers = await this.signHeaders('PUT', url, {}, bodyHash);
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: content,
    });
    if (!r.ok) throw new Error(`S3 write failed: ${r.status}`);
  }

  /** 全量索引（搜索用）：无 delimiter 翻页扫描。 */
  private parseList(xml: string, baseRest: string): Entry[] {
    const entries: Entry[] = [];
    const acctPrefix = this.toAccountPath(baseRest).replace(/^\//, '');

    // 目录（CommonPrefixes）
    const dirRe = /<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g;
    let m: RegExpExecArray | null;
    while ((m = dirRe.exec(xml))) {
      const p = decode(m[1]).replace(/\/$/, '');
      const name = p.split('/').pop() || '';
      entries.push({ name, path: this.toPath('/' + p), isDir: true });
    }

    // 文件（Contents）
    const re = /<Contents>([\s\S]*?)<\/Contents>/g;
    while ((m = re.exec(xml))) {
      const b = m[1];
      const key = (b.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
      if (!key || key.endsWith('/')) continue;
      if (acctPrefix && key === acctPrefix) continue; // 跳过目录自身占位
      const size = +(b.match(/<Size>(\d+)<\/Size>/) || [])[1] || 0;
      const lm = (b.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1];
      const name = key.split('/').pop() || '';
      entries.push({ name, path: this.toPath('/' + key), isDir: false, size, modified: lm });
    }
    return entries;
  }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}
