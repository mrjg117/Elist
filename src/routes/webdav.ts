import type { Context } from 'hono';
import type { Env, Mount } from '../types';
import { dispatch } from '../lib/dispatch';
import { buildPropfind } from '../lib/xml';
import { checkPathPassword, MARKER_FILES } from '../lib/acl';

/**
 * 只读 WebDAV handler（挂载在 /dav/*）。
 * 支持：OPTIONS / PROPFIND / GET / HEAD。
 * 拒绝所有写方法：PUT / MKCOL / DELETE / MOVE / COPY / LOCK / UNLOCK -> 405/403。
 * GET/HEAD 直接 302 到驱动直链（浏览器/客户端原生 Range 多线程）。
 *
 * 门禁：与网页端完全相同的 checkPathPassword 逻辑（级联 + 子层重新鉴权）。
 * 密码经 X-Folder-Password 请求头传递（可重复多个，与网页端同一套）。
 */
function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}
function toRest(fullPath: string, mount: Mount): string {
  if (mount.mount === '/') return fullPath;
  if (fullPath === mount.mount) return '/';
  if (fullPath.startsWith(mount.mount + '/')) return fullPath.slice(mount.mount.length);
  return fullPath;
}
function collectPws(c: Context<{ Bindings: Env }>): string[] {
  const out: string[] = [];
  c.req.raw.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'x-folder-password') out.push(value);
  });
  return out;
}

export async function webdavHandler(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const storagePath = decodeURIComponent(url.pathname.replace(/^\/dav/, '')) || '/';
  const method = c.req.method.toUpperCase();

  const baseUrl = `${url.protocol}//${url.host}/dav`;

  // 写方法一律拒绝
  if (['PUT', 'MKCOL', 'DELETE', 'MOVE', 'COPY', 'LOCK', 'UNLOCK', 'PROPPATCH'].includes(method)) {
    return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
  }

  if (method === 'OPTIONS') {
    return c.body(null, 200, {
      Allow: 'OPTIONS, GET, HEAD, PROPFIND',
      DAV: '1, 2',
      'MS-Author-Via': 'DAV',
    });
  }

  const { driver, rest, mount } = await dispatch(c.env, storagePath);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 门禁：与网页端同样逻辑（级联 + 子层重新鉴权）。
  // 对文件/目录都沿完整路径逐级校验（文件的门禁在其所在目录）。
  const gate = await checkPathPassword(storagePath, collectPws(c), readText);
  if (!gate.ok) {
    return c.body(null, 403, {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="Elist"',
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    const url2 = await driver.link(rest);
    return c.redirect(url2, 302);
  }

  if (method === 'PROPFIND') {
    const depth = c.req.header('Depth') || '1';
    const entries = (await driver.list(rest)).filter((e) => !MARKER_FILES.has(e.name));
    const includeSelf = depth !== '0';
    const xml = buildPropfind(baseUrl, storagePath, entries, includeSelf);
    return new Response(xml, {
      status: 207,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        DAV: '1, 2',
      },
    });
  }

  return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
}
