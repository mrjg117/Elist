import type { Entry } from '../types';

/**
 * 只读 WebDAV 的 PROPFIND 响应 XML 构造。
 * 仅返回 dav: 1 必需属性：displayname / resourcetype / getcontentlength / getlastmodified。
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function propstat(entry: Entry, href: string): string {
  const isDir = entry.isDir;
  const resType = isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
  const len = isDir ? '' : `<D:getcontentlength>${entry.size ?? 0}</D:getcontentlength>`;
  const mod = entry.modified
    ? `<D:getlastmodified>${new Date(entry.modified).toUTCString()}</D:getlastmodified>`
    : '';
  return `    <D:response>
      <D:href>${escapeXml(href)}</D:href>
      <D:propstat>
        <D:prop>
          <D:displayname>${escapeXml(entry.name)}</D:displayname>
          ${resType}
          ${len}
          ${mod}
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
}

/** 构造多条目 PROPFIND 响应体。entries 不含根自身时 includeSelf 控制是否追加当前路径。 */
export function buildPropfind(
  baseUrl: string,
  selfPath: string,
  entries: Entry[],
  includeSelf = true,
  selfIsDir = true,
  selfEntryOverride?: Entry | null
): string {
  const selfHref = baseUrl + (selfPath === '/' ? '/' : selfPath);
  const selfEntry: Entry = selfEntryOverride || {
    name: selfPath === '/' ? '/' : selfPath.split('/').pop() || '/',
    path: selfPath,
    isDir: selfIsDir,
  };
  const parts: string[] = [];
  if (includeSelf) parts.push(propstat(selfEntry, selfHref));
  for (const e of entries) {
    const href = baseUrl + e.path;
    parts.push(propstat(e, href));
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${parts.join('\n')}
</D:multistatus>`;
}
