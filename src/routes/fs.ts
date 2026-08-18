import type { Context } from 'hono';
import type { Env, Entry, Mount } from '../types';
import { dispatch } from '../lib/dispatch';
import {
  checkPathPassword,
  filterHidden,
  MARKER_FILES,
} from '../lib/acl';
import { getListing, setListing, getIndex, setIndex } from '../lib/cache';
import { getRoots } from '../config';

/** 取父目录路径（用于文件下载时校验所在目录密码）。 */
function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** 完整展示路径 -> 盘内相对路径(rest)，交给驱动 readText。 */
function toRest(fullPath: string, mount: Mount): string {
  if (mount.mount === '/') return fullPath;
  if (fullPath === mount.mount) return '/';
  if (fullPath.startsWith(mount.mount + '/')) return fullPath.slice(mount.mount.length);
  return fullPath;
}

/** 收集请求中所有 X-Folder-Password 头（可重复多个），作为客户端已知密码集合。 */
function collectPws(c: Context<{ Bindings: Env }>): string[] {
  const out: string[] = [];
  c.req.raw.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'x-folder-password') out.push(value);
  });
  return out;
}

type SortKey = 'name' | 'time' | 'size' | 'type';
function parseSort(spec?: string): { key: SortKey; desc: boolean } {
  if (!spec) return { key: 'name', desc: false };
  const [k, d] = spec.split('_');
  const key = (['name', 'time', 'size', 'type'].includes(k) ? k : 'name') as SortKey;
  return { key, desc: d === 'desc' };
}
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}
/** 文件夹永远排前，组内按 spec 排序。 */
function sortEntries<T extends Entry>(entries: T[], spec?: string): T[] {
  const { key, desc } = parseSort(spec);
  const dirs = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);
  const cmp = (a: T, b: T): number => {
    let r = 0;
    if (key === 'name') r = a.name.localeCompare(b.name);
    else if (key === 'time') r = (Date.parse(a.modified || '') || 0) - (Date.parse(b.modified || '') || 0);
    else if (key === 'size') r = (a.size || 0) - (b.size || 0);
    else if (key === 'type') r = extOf(a.name).localeCompare(extOf(b.name)) || a.name.localeCompare(b.name);
    return desc ? -r : r;
  };
  dirs.sort(cmp);
  files.sort(cmp);
  return [...dirs, ...files];
}

/**
 * GET /api/list?path=/s3/photos[&sort=time_desc]
 * 根目录(/)返回盘列表；其余返回目录列表 + 级联门禁 + 隐藏过滤 + 排序 + 内存缓存。
 * 密码经 X-Folder-Password 请求头传递（可多个），不进 URL。
 */
export async function handleList(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path') || '/';
  const pws = collectPws(c);

  // 根目录：展示盘列表（hide 的盘已剔除）
  if (path === '/' || path === '') {
    const roots = getRoots(c.env).map((r) => ({
      name: r.title || r.path,
      path: r.path,
      isDir: true,
    }));
    return c.json(roots);
  }

  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 门禁：自身 + 所有祖先目录的 .passwd 都满足才放行（级联；子层需各自密码=重新鉴权）
  const gate = await checkPathPassword(path, pws, readText);
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt }, 403);

  const cacheKey = mount.mount + rest;
  let entries = getListing(cacheKey);
  if (!entries) {
    entries = await driver.list(rest);
    setListing(cacheKey, entries);
  }
  let visible = await filterHidden(path, entries, readText);
  visible = visible.filter((e) => !MARKER_FILES.has(e.name));
  const spec = c.req.query('sort') || mount.sort || c.env.SORT || 'name_asc';
  const sorted = sortEntries(visible, spec);
  return c.json(sorted);
}

/**
 * GET /api/link?path=/s3/photos/a.jpg
 * 校验通过后返回直链 JSON { url, cacheControl }。前端拿它做预览/下载，
 * 密码不进任何 URL（302 目标签名的存储直链同样无密码）。
 */
export async function handleLink(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path required' }, 400);
  const pws = collectPws(c);
  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  const gate = await checkPathPassword(parentDir(path), pws, readText);
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt }, 403);

  const url = await driver.link(rest);
  const cc = mount.cache || c.env.CACHE_CONTROL || 'public, max-age=300';
  return c.json({ url, cacheControl: cc });
}

/**
 * GET /api/download?path=/s3/photos/a.jpg  -> 302 直链（兼容无头/脚本场景）
 * 密码经 X-Folder-Password 头（不再支持 ?pw=）。
 */
export async function handleDownload(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path required' }, 400);
  const pws = collectPws(c);
  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  const gate = await checkPathPassword(parentDir(path), pws, readText);
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt }, 403);

  const url = await driver.link(rest);
  const cc = mount.cache || c.env.CACHE_CONTROL || 'public, max-age=300';
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': cc },
  });
}

/**
 * GET /api/search?q=foo&path=/s3
 * 现搜 + 内存索引（S3 flat 扫描 / OneDrive 递归）；零 KV/D1/SQL。
 * 结果按门禁过滤（受保护路径不出现在结果里）。
 */
export async function handleSearch(c: Context<{ Bindings: Env }>) {
  const q = (c.req.query('q') || '').toLowerCase();
  const path = c.req.query('path') || '/';
  if (!q) return c.json([], 200);
  const pws = collectPws(c);
  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  const idxKey = mount.mount + rest;
  let all = getIndex(idxKey);
  if (!all) {
    all = await driver.walk(rest); // 访问即预热索引（fire-and-forget 可后续加）
    setIndex(idxKey, all);
  }
  const matched = all
    .filter((e) => e.name.toLowerCase().includes(q))
    .slice(0, 200);
  const allowed: Entry[] = [];
  for (const e of matched) {
    const g = await checkPathPassword(e.path, pws, readText);
    if (g.ok) allowed.push(e);
  }
  return c.json(allowed);
}
