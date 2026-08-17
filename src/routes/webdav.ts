import type { Context } from 'hono';
import type { Env } from '../types';
import { dispatch } from '../lib/dispatch';
import { buildPropfind } from '../lib/xml';

/**
 * 只读 WebDAV handler（挂载在 /dav/*）。
 * 支持：OPTIONS / PROPFIND / GET / HEAD。
 * 拒绝所有写方法：PUT / MKCOL / DELETE / MOVE / COPY / LOCK / UNLOCK -> 405/403。
 * GET/HEAD 直接 302 到驱动直链（浏览器/客户端原生 Range 多线程）。
 *
 * 只读下 Windows 只读网络位置通常不需要 LOCK；如卡住，可在前端加"假 LOCK passthrough"。
 */
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

  const { driver, rest } = await dispatch(c.env, storagePath);

  if (method === 'GET' || method === 'HEAD') {
    const url2 = await driver.link(rest);
    return c.redirect(url2, 302);
  }

  if (method === 'PROPFIND') {
    const depth = c.req.header('Depth') || '1';
    const entries = await driver.list(rest);
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
