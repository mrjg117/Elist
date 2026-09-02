import type { Context } from 'hono';
import type { Env, Mount, Entry } from '../types';
import { dispatch } from '../lib/dispatch';
import { buildPropfind } from '../lib/xml';
import { checkPathPassword, MARKER_FILES, filterHidden, isHidden } from '../lib/acl';
import { getMounts, findMount, getRoots } from '../config';
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
 *  - 读（OPTIONS/GET/HEAD/PROPFIND）：走目录密码门禁 checkPathPassword（级联 + 子层重新鉴权）；
 *    管理员身份（X-Admin-Password 头或 Basic 用户名 admin）bypass 所有目录密码门禁与隐藏过滤。
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

/** 读 cookie（Workers 无内存态，管理身份用 elist_admin cookie 跨请求保持）。 */
function getCookie(c: Context<{ Bindings: Env }>, name: string): string | null {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/** 浏览器 HTML 导航（非 WebDAV 客户端）：用于决定是否渲染网页登录框而非发 Basic 挑战。 */
function isBrowserHtml(c: Context<{ Bindings: Env }>): boolean {
  const accept = c.req.header('Accept') || '';
  return accept.includes('text/html') && !c.req.header('Authorization');
}

/** WebDAV 根聚合与管理视图用的管理员判定：X-Admin-Password 头、Basic 用户名 admin、或 elist_admin cookie（网页端登录后）。 */
async function isWebdavAdmin(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const headerPw = c.req.header('X-Admin-Password');
  const basicPw = extractAdminPassword(c) ?? undefined;
  const cookiePw = getCookie(c, 'elist_admin') ?? undefined;
  const pw = headerPw || basicPw || cookiePw;
  if (!pw) return false;
  const expected = xlsxConfig.getConfig('admin_password');
  return !!expected && constantTimeCompare(pw, expected);
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

  // 根聚合：/dav 与 /dav/ 返回所有挂载点列表（与网页端 /api/list 根一致）。
  // 否则 dispatch 会因没有挂载点注册在 "/" 而 404 mount not found，浏览器/客户端连根就报 404。
  if (storagePath === '/') {
    await loadXlsxConfig(c, false);
    const admin = await isWebdavAdmin(c);
    // 根本身若有目录密码则先过读门禁（与子目录一致）
    if (!admin) {
      const gate = await checkPathPassword('/', collectPws(c));
      if (!gate.ok) {
        if (isBrowserHtml(c)) {
          return c.html(renderAuthPage('/dav/'), 401);
        }
        return c.body(null, 401, {
          'Content-Type': 'text/plain; charset=utf-8',
          'WWW-Authenticate': 'Basic realm="Elist"',
        });
      }
    }
    const roots = getRoots(c.env);
    const entries: Entry[] = [];
    for (const r of roots) {
      const hidden = await isHidden(normalize(r.path), undefined, false);
      if (!admin && hidden) continue;
      const locked = !!(await xlsxConfig.getPassword(normalize(r.path)));
      entries.push({
        name: r.title || r.path,
        path: r.path,
        isDir: true,
        ...(admin ? { hidden, locked } : { locked }),
      } as Entry);
    }
    if (method === 'PROPFIND') {
      const xml = buildPropfind(baseUrl, '/', entries, true, true);
      return c.body(xml, 207, { 'Content-Type': 'application/xml; charset=utf-8' });
    }
    if (method === 'GET' || method === 'HEAD') {
      if (method === 'HEAD') {
        return c.body(null, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return c.html(renderDirIndex(baseUrl, '/', entries, admin), 200);
    }
    // 根不接受写方法（没有挂载点落在 "/"）
    return c.body(null, 405, { Allow: 'OPTIONS, GET, HEAD, PROPFIND' });
  }

  // 确保配置已加载（防止冷启动绕过门禁）
  await loadXlsxConfig(c, false);

  // 管理员身份（X-Admin-Password 头或 Basic 用户名 admin）：bypass 所有目录密码门禁与隐藏过滤。
  // 与网页端 /api/* 的 isAdminRequest 同一套判定，实现「管理密码一用即全局管理身份」。
  const admin = await isWebdavAdmin(c);

  const { driver, rest, mount } = await dispatch(c.env, storagePath);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 权限模型（与网页端 /api/file/* 一致）：
  //  - 读（GET/HEAD/PROPFIND）：走目录密码门禁，级联 + 子层重新鉴权；管理员身份 bypass。
  //  - 写（PUT/MKCOL/DELETE/MOVE）：只绑管理员登录（下方 Basic admin 校验），
  //    不再叠加目录密码——WebDAV 客户端只发 Basic 凭证，不发 X-Folder-Password，
  //    否则加密目录下无法上传/删除。
  const WRITE_METHODS = ['PUT', 'MKCOL', 'DELETE', 'MOVE'];
  if (!WRITE_METHODS.includes(method)) {
    if (!admin) {
      // 对文件/目录都沿完整路径逐级校验（文件的门禁在其所在目录）
      const gate = await checkPathPassword(storagePath, collectPws(c), readText);
      if (!gate.ok) {
        // 浏览器 HTML 导航：渲染网页登录框（输入管理员密码即全局解锁），不发 Basic 挑战以免弹原生框。
        // WebDAV 客户端（PROPFIND/GET 带 */* 等 Accept、无登录框需求）：仍回 401 + Basic 挑战。
        if (isBrowserHtml(c)) {
          return c.html(renderAuthPage('/dav' + encodeURI(storagePath)), 401);
        }
        return c.body(null, 401, {
          'Content-Type': 'text/plain; charset=utf-8',
          'WWW-Authenticate': 'Basic realm="Elist"',
        });
      }
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    // 先判断是否为目录：目录不能走 driver.link()（文件夹无下载直链，OneDrive 等驱动会抛错 -> 500）。
    // 是目录 -> 渲染 HTML 索引；是文件 -> 302 到驱动直链（浏览器原生 Range 多线程，不落 Worker）。
    let entries: Entry[] = [];
    let isDir = false;
    try {
      entries = await driver.list(rest);
      isDir = true;
    } catch {
      // 不是目录（或列目录失败），落到下方文件分支
    }

    if (isDir) {
      const readText = (full: string) => driver.readText(toRest(full, mount));
      const visible = await filterHidden(
        storagePath,
        entries.filter((e) => !MARKER_FILES.has(e.name)),
        readText,
        false,
        admin,
      );
      // 给目录条目补 locked / hidden 标记（浏览器视图显示 🔒/👁 图标）；管理员可见隐藏项并显示 👁。
      // 文件无目录密码概念，保持不动。纯浏览器 HTML 展示，不影响 PROPFIND/客户端协议。
      const enriched = await Promise.all(
        visible.map(async (e) => {
          if (!e.isDir) return e;
          const o: Entry = { ...e, locked: !!xlsxConfig.getPassword(normalize(e.path)) };
          if (admin) o.hidden = await isHidden(normalize(e.path), undefined, false);
          return o;
        }),
      );
      if (method === 'HEAD') {
        return c.body(null, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return c.html(renderDirIndex(baseUrl, storagePath, enriched, admin), 200);
    }

    // 文件：302 到驱动直链。driver.link 失败时降级 404，避免裸抛 -> 500 internal_error。
    try {
      const url2 = await driver.link(rest);
      if (method === 'HEAD') {
        return c.body(null, 200, { 'Content-Type': 'application/octet-stream' });
      }
      return c.redirect(url2, 302);
    } catch {
      return c.body(null, 404);
    }
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

    // 过滤标记文件；隐藏条目对非管理员过滤（与浏览器 GET 目录页一致，管理员可见全部）。
    const allVisible = entries.filter(e => !MARKER_FILES.has(e.name));
    const visible = admin ? allVisible : await filterHidden(storagePath, allVisible, readText, false);

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

/**
 * 渲染目录的 HTML 索引页（浏览器直接访问 WebDAV 文件夹时展示，而非 500 或裸 JSON）。
 * 条目链接指向同挂载下的子路径（baseUrl 已含 /dav 前缀）。
 */
function renderDirIndex(baseUrl: string, path: string, entries: Entry[], admin: boolean): string {
  const title = path === '/' ? 'WebDAV' : path.split('/').filter(Boolean).pop() || path;

  // 管理员登录条：未登录显示登录框（POST 到 /api/admin/login 并带 next 回跳），已登录显示退出。
  // 仅浏览器 HTML 视图；与 X-Admin-Password 头 / Basic 是同一套管理身份，客户端协议层无感。
  // next 用同站相对路径（/dav/...）：handler 端 sanitizeNext 拒绝绝对 URL，避免开放重定向，
  // 也避免退出后落在绝对 URL 上被当成跨站而失败。
  const curUrl = '/dav' + encodeURI(path);
  let admBar: string;
  if (admin) {
    admBar =
      `      <p class="adm">✓ 管理员已登录 · ` +
      `<a href="/api/admin/logout?next=${escapeHtml(curUrl)}">退出</a></p>\n`;
  } else {
    admBar =
      `      <form class="adm" method="post" action="/api/admin/login">` +
      `<input type="hidden" name="next" value="${escapeHtml(curUrl)}">` +
      `<input type="password" name="password" placeholder="管理员密码" size="14">` +
      `<button type="submit">登录</button></form>\n`;
  }

  // 导航：返回上级（根目录不显示）+ 面包屑路径（与 WebDAV 客户端无关，纯浏览器视图）
  let nav = '';
  if (path !== '/') {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    const upHref = baseUrl + encodeURI(parent);
    nav += `      <p class="up"><a href="${upHref}">↩ 返回上级</a></p>\n`;
  }
  const segs = path.split('/').filter(Boolean);
  if (segs.length > 0) {
    let acc = '';
    const parts = segs.map((seg, i) => {
      acc += '/' + seg;
      const href = baseUrl + encodeURI(acc);
      // 当前目录（最后一段）不链接，其余是可点祖先
      return i < segs.length - 1 ? `<a href="${href}">${escapeHtml(seg)}</a>` : escapeHtml(seg);
    });
    nav += `      <p class="crumb"><a href="${baseUrl + '/'}">根</a> / ${parts.join(' / ')}</p>\n`;
  }

  const items = entries
    .map((e) => {
      const href = baseUrl + encodeURI(e.path);
      let icon = e.isDir ? '📁' : '📄';
      if (e.isDir && e.hidden) icon = '👁';
      else if (e.isDir && e.locked) icon = '🔒';
      return `      <li><a href="${href}">${icon} ${escapeHtml(e.name)}</a></li>`;
    })
    .join('\n');
  return (
    '<!doctype html>\n' +
    '<html lang="zh-CN">\n' +
    '<head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    '</title>\n' +
    '<style>body{font-family:system-ui,-apple-system,sans-serif;margin:2rem;color:#222}' +
    'a{text-decoration:none;color:#1565c0}a:hover{text-decoration:underline}' +
    '.adm{background:#f4f6fb;border:1px solid #d8e0f0;border-radius:8px;padding:.5rem .8rem;' +
    'margin:0 0 1rem;display:flex;gap:.5rem;align-items:center;font-size:.9rem;width:max-content}' +
    '.adm input[type=password]{padding:.25rem .4rem;border:1px solid #c4ccda;border-radius:4px}' +
    '.adm button{padding:.25rem .8rem;border:0;border-radius:4px;background:#1565c0;color:#fff;cursor:pointer}' +
    '.up{margin:0 0 .5rem}.up a{font-weight:600}' +
    '.crumb{color:#666;font-size:.9rem;margin:0 0 1rem}.crumb a{color:#1565c0}</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<h1>' +
    escapeHtml(title) +
    '</h1>\n' +
    admBar +
    nav +
    '<ul>\n' +
    items +
    '\n</ul>\n' +
    '</body>\n' +
    '</html>'
  );
}

/** 加密/隐藏目录被拦截时，给浏览器导航渲染的登录页（输入管理员密码即全局解锁）。 */
function renderAuthPage(nextUrl: string): string {
  return (
    '<!doctype html>\n' +
    '<html lang="zh-CN">\n' +
    '<head><meta charset="utf-8"><title>需要管理员密码</title>\n' +
    '<style>body{font-family:system-ui,-apple-system,sans-serif;margin:2rem;color:#222}' +
    '.box{background:#f4f6fb;border:1px solid #d8e0f0;border-radius:8px;padding:1rem;width:max-content}' +
    'input[type=password]{padding:.3rem .5rem;border:1px solid #c4ccda;border-radius:4px;margin-right:.5rem}' +
    'button{padding:.3rem 1rem;border:0;border-radius:4px;background:#1565c0;color:#fff;cursor:pointer}' +
    'a{color:#1565c0}</style></head>\n' +
    '<body>\n' +
    '<h1>需要管理员密码</h1>\n' +
    '<div class="box"><form method="post" action="/api/admin/login">' +
    `<input type="hidden" name="next" value="${escapeHtml(nextUrl)}">` +
    '<input type="password" name="password" placeholder="管理员密码" required>' +
    '<button type="submit">登录</button></form></div>\n' +
    '<p>输入管理员密码后，本目录及全部隐藏 / 加密目录将解锁。</p>\n' +
    '<p><a href="/dav/">← 返回根目录</a></p>\n' +
    '</body>\n</html>'
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}
