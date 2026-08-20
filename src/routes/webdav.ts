import type { Context } from 'hono';
import type { Env, Mount } from '../types';
import { dispatch } from '../lib/dispatch';
import { buildPropfind } from '../lib/xml';
import { checkPathPassword, MARKER_FILES } from '../lib/acl';
import { getMounts } from '../config';
import * as xlsxConfig from '../lib/xlsx-config';

/**
 * WebDAV handler（挂载在 /dav/*）。
 * 支持：OPTIONS / PROPFIND / GET / HEAD / PUT / MKCOL / DELETE / MOVE。
 * GET/HEAD 直接 302 到驱动直链（浏览器/客户端原生 Range 多线程）。
 * 写操作需要管理员密码（X-Admin-Password 头或 Basic Auth 用户名）。
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
    if (key.toLowerCase() === 'x-folder-password') {
      // 支持逗号分隔的多个密码
      out.push(...value.split(',').map(p => p.trim()).filter(Boolean));
    }
  });
  // WebDAV 客户端（rclone / RaiDrive / Windows 资源管理器等）不会发 X-Folder-Password，
  // 只会发 HTTP Basic Auth。把 Basic 的「用户名 + 密码」都作为候选密码：
  //   - 只设密码位：可解锁所有配置了该密码的层级；
  //   - 两层密码不同：用户名=P1、密码=P2，两个候选各满足一层。
  const auth = c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim());
      const i = decoded.indexOf(':');
      if (i >= 0) {
        const user = decoded.slice(0, i);
        const pass = decoded.slice(i + 1);
        if (user) out.push(user);
        if (pass) out.push(pass);
      }
    } catch {
      // base64 非法则忽略，按无密码处理
    }
  }
  return out;
}

export async function webdavHandler(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const storagePath = decodeURIComponent(url.pathname.replace(/^\/dav/, '')) || '/';
  const method = c.req.method.toUpperCase();

  const baseUrl = `${url.protocol}//${url.host}/dav`;

  // 不支持的方法拒绝
  if (['COPY', 'LOCK', 'UNLOCK', 'PROPPATCH'].includes(method)) {
    return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, MOVE' });
  }

  if (method === 'OPTIONS') {
    return c.body(null, 200, {
      Allow: 'OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, MOVE',
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

  // 写操作需要管理员验证（从 xlsx 配置读取密码）
  const adminPassword = c.req.header('X-Admin-Password') || extractAdminPassword(c);
  const expectedPassword = xlsxConfig.getConfig('admin_password');
  if (!adminPassword || !expectedPassword || expectedPassword !== adminPassword) {
    return c.body(null, 401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="Elist Admin"',
    });
  }

  // PUT: 上传文件
  if (method === 'PUT') {
    if (!driver.writeText && !driver.writeBinary) {
      return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
    }
    const body = await c.req.arrayBuffer();
    const contentType = c.req.header('Content-Type') || 'application/octet-stream';
    if (contentType.startsWith('text/') && driver.writeText) {
      const text = new TextDecoder().decode(body);
      await driver.writeText(rest, text);
    } else if (driver.writeBinary) {
      await driver.writeBinary(rest, body);
    } else {
      return c.body(null, 501);
    }
    return c.body(null, 201);
  }

  // MKCOL: 创建目录
  if (method === 'MKCOL') {
    if (!driver.mkdir) {
      return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
    }
    await driver.mkdir(rest);
    return c.body(null, 201);
  }

  // DELETE: 删除文件/目录
  if (method === 'DELETE') {
    if (!driver.delete) {
      return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
    }
    await driver.delete(rest);
    return c.body(null, 204);
  }

  // MOVE: 移动/重命名
  if (method === 'MOVE') {
    if (!driver.move) {
      return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
    }
    const destination = c.req.header('Destination');
    if (!destination) {
      return c.body(null, 400);
    }
    const destUrl = new URL(destination);
    const destPath = decodeURIComponent(destUrl.pathname.replace(/^\/dav/, '')) || '/';
    const destMount = getMounts(c.env).find(m => destPath === m.mount || destPath.startsWith(m.mount + '/'));
    if (!destMount || destMount.mount !== mount.mount) {
      return c.body(null, 400); // 不支持跨挂载点移动
    }
    const destRest = destPath.slice(mount.mount.length) || '/';
    await driver.move(rest, destRest);
    return c.body(null, 201);
  }

  return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, MOVE' });
}

/** 从 Basic Auth 提取管理员密码（用户名为 admin） */
function extractAdminPassword(c: Context<{ Bindings: Env }>): string | null {
  const auth = c.req.header('Authorization') || '';
  if (!auth.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = atob(auth.slice(6).trim());
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (user === 'admin') return pass;
  } catch {}
  return null;
}
