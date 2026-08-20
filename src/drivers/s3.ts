import type { Driver, Entry, Mount, Env } from '../types';
import { BaseDriver } from './base';
import { sha256Hex, hmacRaw, hmacHex, bufToHex } from '../lib/crypto';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** RFC3986 编码（空格→%20），用于 S3 URL 路径和 query。 */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** 编码 S3 key：每个 segment 单独编码，保留 / 分隔符。 */
function encodeS3Key(key: string): string {
  return key.split('/').map(rfc3986).join('/');
}

/** 构建 RFC3986 编码的 query string（空格→%20，非 +）。 */
function buildCanonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&');
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
    // 使用统一的 RFC3986 编码（空格→%20）
    const canonicalQuery = buildCanonicalQuery(query);
    // AWS SigV4 要求所有 x-amz-* 头都必须纳入签名，按字母序排列
    const canonicalHeaders = `host:${u.host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzdate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
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
    // S3 要求路径中每个 segment 单独 URI 编码（保留 / 作为路径分隔符）
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const canonicalRequest = [
      'GET',
      `/${this.bucket}/${encodedKey}`,
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
    return `${this.endpoint}/${this.bucket}/${encodedKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  // ---- 公开接口 ----
  async list(rest: string): Promise<Entry[]> {
    const prefix = this.toAccountPath(rest).replace(/^\//, '');
    const allEntries: Entry[] = [];
    let continuationToken: string | undefined;

    // 分页获取所有结果
    do {
      const q = new URLSearchParams({
        'list-type': '2',
        prefix,
        delimiter: '/',
      });
      if (continuationToken) {
        q.set('continuation-token', continuationToken);
      }
      const url = `${this.endpoint}/${this.bucket}?${q.toString()}`;
      const headers = await this.signHeaders('GET', url, paramsToObj(q), EMPTY_SHA256);
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`S3 list failed: ${r.status}`);
      const xml = await r.text();
      const entries = this.parseList(xml, rest);
      allEntries.push(...entries);

      // 检查是否有更多结果
      const truncatedMatch = xml.match(/<IsTruncated>([\s\S]*?)<\/IsTruncated>/);
      const isTruncated = truncatedMatch && truncatedMatch[1].toLowerCase() === 'true';
      const tokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      continuationToken = tokenMatch ? tokenMatch[1] : undefined;

      // 如果没有更多结果或没有获取到 token，退出循环
      if (!isTruncated || !continuationToken) break;
    } while (true);

    return allEntries;
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
    const encodedKey = encodeS3Key(key);
    const url = `${this.endpoint}/${this.bucket}/${encodedKey}`;
    const bodyHash = await sha256Hex(content);
    const headers = await this.signHeaders('PUT', url, {}, bodyHash);
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: content,
    });
    if (!r.ok) throw new Error(`S3 write failed: ${r.status}`);
  }

  async writeText(rest: string, content: string): Promise<void> {
    const key = this.toAccountPath(rest).replace(/^\//, '');
    const encodedKey = encodeS3Key(key);
    const url = `${this.endpoint}/${this.bucket}/${encodedKey}`;
    const encoder = new TextEncoder();
    const body = encoder.encode(content).buffer;
    const bodyHash = await sha256Hex(body);
    const headers = await this.signHeaders('PUT', url, {}, bodyHash);
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      body,
    });
    if (!r.ok) throw new Error(`S3 writeText failed: ${r.status}`);
  }

  async move(sourceRest: string, targetRest: string): Promise<void> {
    // S3 没有原生的 move/rename，需要 copy + delete
    // 如果是目录，需要递归处理所有子对象
    const sourceKey = this.toAccountPath(sourceRest).replace(/^\//, '');
    const targetKey = this.toAccountPath(targetRest).replace(/^\//, '');

    // 先尝试作为单个对象移动
    const copyUrl = `${this.endpoint}/${this.bucket}/${encodeS3Key(targetKey)}`;
    const copyHeaders = await this.signHeaders('PUT', copyUrl, {}, EMPTY_SHA256);
    copyHeaders['x-amz-copy-source'] = `/${this.bucket}/${encodeS3Key(sourceKey)}`;
    const copyResp = await fetch(copyUrl, {
      method: 'PUT',
      headers: copyHeaders,
    });

    if (copyResp.ok) {
      // 单个对象移动成功，删除源
      const deleteUrl = `${this.endpoint}/${this.bucket}/${encodeS3Key(sourceKey)}`;
      const deleteHeaders = await this.signHeaders('DELETE', deleteUrl, {}, EMPTY_SHA256);
      const deleteResp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: deleteHeaders,
      });
      if (!deleteResp.ok) throw new Error(`S3 delete source failed: ${deleteResp.status}`);
    } else if (copyResp.status === 404) {
      // 可能是目录，需要递归处理
      const sourcePrefix = sourceKey.endsWith('/') ? sourceKey : sourceKey + '/';
      const targetPrefix = targetKey.endsWith('/') ? targetKey : targetKey + '/';

      // 分页列出所有以 sourcePrefix 开头的对象
      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const q = new URLSearchParams({
          'list-type': '2',
          prefix: sourcePrefix,
        });
        if (continuationToken) {
          q.set('continuation-token', continuationToken);
        }
        const listUrl = `${this.endpoint}/${this.bucket}?${q.toString()}`;
        const listHeaders = await this.signHeaders('GET', listUrl, paramsToObj(q), EMPTY_SHA256);
        const listResp = await fetch(listUrl, { headers: listHeaders });
        if (!listResp.ok) throw new Error(`S3 list failed: ${listResp.status}`);

        const xml = await listResp.text();
        const keyRe = /<Key>([\s\S]*?)<\/Key>/g;
        let m: RegExpExecArray | null;
        while ((m = keyRe.exec(xml))) {
          keys.push(decode(m[1]));
        }

        // 检查是否有更多结果
        const truncatedMatch = xml.match(/<IsTruncated>([\s\S]*?)<\/IsTruncated>/);
        const isTruncated = truncatedMatch && truncatedMatch[1].toLowerCase() === 'true';
        const tokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
        continuationToken = tokenMatch ? tokenMatch[1] : undefined;

        if (!isTruncated || !continuationToken) break;
      } while (true);

      if (keys.length === 0) {
        throw new Error(`S3 move failed: source not found`);
      }

      // 递归复制和删除
      for (const key of keys) {
        const newKey = targetPrefix + key.slice(sourcePrefix.length);
        const newCopyUrl = `${this.endpoint}/${this.bucket}/${encodeS3Key(newKey)}`;
        const newCopyHeaders = await this.signHeaders('PUT', newCopyUrl, {}, EMPTY_SHA256);
        newCopyHeaders['x-amz-copy-source'] = `/${this.bucket}/${encodeS3Key(key)}`;
        const newCopyResp = await fetch(newCopyUrl, {
          method: 'PUT',
          headers: newCopyHeaders,
        });
        if (!newCopyResp.ok) throw new Error(`S3 copy failed: ${newCopyResp.status}`);

        const newDeleteUrl = `${this.endpoint}/${this.bucket}/${encodeS3Key(key)}`;
        const newDeleteHeaders = await this.signHeaders('DELETE', newDeleteUrl, {}, EMPTY_SHA256);
        const newDeleteResp = await fetch(newDeleteUrl, {
          method: 'DELETE',
          headers: newDeleteHeaders,
        });
        if (!newDeleteResp.ok) throw new Error(`S3 delete source failed: ${newDeleteResp.status}`);
      }
    } else {
      throw new Error(`S3 copy failed: ${copyResp.status}`);
    }
  }

  async delete(rest: string): Promise<void> {
    const key = this.toAccountPath(rest).replace(/^\//, '');
    const url = `${this.endpoint}/${this.bucket}/${encodeS3Key(key)}`;
    const headers = await this.signHeaders('DELETE', url, {}, EMPTY_SHA256);
    const r = await fetch(url, {
      method: 'DELETE',
      headers,
    });
    if (!r.ok) throw new Error(`S3 delete failed: ${r.status}`);
  }

  async mkdir(rest: string): Promise<void> {
    // S3 没有真正的目录，创建空对象作为目录标记
    const key = this.toAccountPath(rest).replace(/^\//, '');
    const dirKey = key.endsWith('/') ? key : key + '/';
    const url = `${this.endpoint}/${this.bucket}/${encodeS3Key(dirKey)}`;
    const headers = await this.signHeaders('PUT', url, {}, EMPTY_SHA256);
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/x-directory' },
      body: new ArrayBuffer(0),
    });
    if (!r.ok) throw new Error(`S3 mkdir failed: ${r.status}`);
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
      const keyRaw = (b.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
      if (!keyRaw || keyRaw.endsWith('/')) continue;
      const key = decode(keyRaw);
      if (acctPrefix && key === acctPrefix) continue; // 跳过目录自身占位
      const size = +(b.match(/<Size>(\d+)<\/Size>/) || [])[1] || 0;
      const lm = (b.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1];
      const name = key.split('/').pop() || '';
      entries.push({ name, path: this.toPath('/' + key), isDir: false, size, modified: lm });
    }
    return entries;
  }
}

/** 反转义 XML 实体（S3 Key 是原始 UTF-8，不是 URL 编码，不做 decodeURIComponent）。 */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
