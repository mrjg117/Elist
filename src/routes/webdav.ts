import type { Context } from 'hono';
import type { Env, Mount, Entry } from '../types';
import { dispatch } from '../lib/dispatch';
import { buildPropfind } from '../lib/xml';
import { checkPathPassword, MARKER_FILES } from '../lib/acl';
import { getMounts, findMount } from '../config';
import { normalize } from '../config';
import * as xlsxConfig from '../lib/xlsx-config';
import { loadXlsxConfig } from './fs';
import { extractAdminPassword } from '../lib/auth';
import { constantTimeCompare } from '../lib/acl';

/**
 * WebDAV handler（挂载在 /dav/*）。
 * 支持：OPTIONS / PROPFIND / GET / HEAD / PUT / MKCOL / DELETE / MOVE。
 * GET/HEAD 直接 302 到驱动直链（浏览器/客户端原生 Range 多线程）。
 *
 * 权限模型（与网页端 /api/file/*、/api/list、/api/raw 一致）：
 *  - 读（OPTIONS/GET/HEAD/PROPFIND）：走目录密码门禁 checkPathPassword（级联 + 子层重新鉴权）。
 *  - 写（PUT/MKCOL/DELETE/MOVE）：只绑管理员登录（X-Admin-Password 头或 Basic Auth），
 *    不再叠加目录密码 —— WebDAV 客户端只发 Basic 凭证，不会发 X-Folder-Password。
 *
 * 目录密码经 X-Folder-Password 请求头传递（可重复多个，与网页端同一套）；
 * WebDAV 客户端的 Basic 用户名/密码位也会作为候选目录密码（见 collectPws）。
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
  const storagePath = normalize(decodeURIComponent(url.pathname.replace(/^\/dav/, '')) || '/');
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

  // 确保配置已加载（防止冷启动绕过门禁）
  await loadXlsxConfig(c, false);

  const { driver, rest, mount } = await dispatch(c.env, storagePath);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 权限模型（与网页端 /api/file/* 一致）：
  //  - 读（GET/HEAD/PROPFIND）：走目录密码门禁，级联 + 子层重新鉴权。
  //  - 写（PUT/MKCOL/DELETE/MOVE）：只绑管理员登录（下方 Basic admin 校验），
  //    不再叠加目录密码——WebDAV 客户端只发 Basic 凭证，不发 X-Folder-Password，
  //    否则加密目录下无法上传/删除。
  const WRITE_METHODS = ['PUT', 'MKCOL', 'DELETE', 'MOVE'];
  if (!WRITE_METHODS.includes(method)) {
    // 对文件/目录都沿完整路径逐级校验（文件的门禁在其所在目录）
    const gate = await checkPathPassword(storagePath, collectPws(c), readText);
    if (!gate.ok) {
      return c.body(null, 403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'WWW-Authenticate': 'Basic realm="Elist"',
      });
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    const url2 = await driver.link(rest);
    return c.redirect(url2, 302);
  }

  if (method === 'PROPFIND') {
    const depth = c.req.header('Depth') || '1';
    
    // 尝试列出目录内容
    let entries: Entry[] = [];
    let isDir = false;
    
    try {
      entries = await driver.list(rest);
      isDir = true;
    } catch {
      // 如果不是目录，检查是否是文件
      try {
        const link = await driver.link(rest);
        // 是文件，返回文件信息
        entries = [{
          name: storagePath.split('/').pop() || '',
          path: storagePath,
          isDir: false,
        }];
      } catch {
        return c.body(null, 404);
      }
    }
    
    // 过滤隐藏条目和标记文件
    const visible = entries.filter(e => !MARKER_FILES.has(e.name));

    // Depth: 0 时目录只返回自身不列子项；文件始终返回自身（RFC 4918）。
    // buildPropfind 参数：(baseUrl, selfPath, entries, includeSelf, selfIsDir)
    // 文件场景 includeSelf=false，文件本身已放入 entries；目录场景 includeSelf=true。
    const children = isDir && depth === '0' ? [] : visible;
    const xml = buildPropfind(baseUrl, storagePath, children, isDir, isDir);
    return c.body(xml, 207, {
      'Content-Type': 'application/xml; charset=utf-8',
    });
  }

  // 写操作需要管理员密码
  const adminPassword = extractAdminPassword(c);
  const expectedPassword = xlsxConfig.getConfig('admin_password');
  
  if (!adminPassword || !expectedPassword || !constantTimeCompare(adminPassword, expectedPassword)) {
    return c.body(null, 401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="Elist Admin"',
    });
  }

  if (method === 'PUT') {
    if (!driver.writeText) {
      return c.body(null, 501, { 'Content-Type': 'text/plain' });
    }
    const body = await c.req.text();
    await driver.writeText(rest, body);
    return c.body(null, 201);
  }

  if (method === 'MKCOL') {
    if (!driver.mkdir) {
      return c.body(null, 501, { 'Content-Type': 'text/plain' });
    }
    await driver.mkdir(rest);
    return c.body(null, 201);
  }

  if (method === 'DELETE') {
    if (!driver.delete) {
      return c.body(null, 501, { 'Content-Type': 'text/plain' });
    }
    await driver.delete(rest);
    return c.body(null, 204);
  }

  if (method === 'MOVE') {
    if (!driver.move) {
      return c.body(null, 501, { 'Content-Type': 'text/plain' });
    }
    const destination = c.req.header('Destination') || '';
    if (!destination) {
      return c.body(null, 400, { 'Content-Type': 'text/plain' });
    }
    
    // 解析 Destination URL
    const destUrl = new URL(destination);
    const destPath = normalize(decodeURIComponent(destUrl.pathname.replace(/^\/dav/, '')) || '/');
    
    // 检查目标路径是否在同一挂载点
    const destMount = findMount(getMounts(c.env), destPath);
    if (!destMount || destMount.mount.mount !== mount.mount) {
      return c.body(null, 502, { 'Content-Type': 'text/plain' });
    }
    
    const targetRest = toRest(destPath, destMount.mount);
    await driver.move(rest, targetRest);
    return c.body(null, 201);
  }

  return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, MOVE' });
}
