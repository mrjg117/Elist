import type { Context } from 'hono';
import type { Env, Entry } from '../types';
import { dispatch } from '../lib/dispatch';
import {
  checkFolderPassword,
  filterHidden,
  verifyPassword,
  MARKER_FILES,
} from '../lib/acl';
import { getListing, setListing, getIndex, setIndex } from '../lib/cache';
import { getRoots } from '../config';

/** 取父目录路径（用于文件下载时校验所在目录密码）。 */
function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
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
 * GET /api/list?path=/s3/photos[&pw=xxx][&sort=time_desc]
 * 根目录(/)返回盘列表；其余返回目录列表 + 门禁 + 隐藏过滤 + 排序 + 内存缓存。
 */
export async function handleList(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path') || '/';
  const pw = c.req.query('pw') || c.req.header('X-Folder-Password') || '';

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
  const readText = (p: string) => driver.readText(p);

  // 门禁：挂载级 passwd 与文件夹级 .passwd 都满足才放行（可叠加）
  const gateOk =
    (await verifyPassword(mount.passwd, pw)) &&
    (await checkFolderPassword(path, pw || undefined, readText));
  if (!gateOk) return c.json({ error: 'password_required' }, 403);

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
 * GET /api/download?path=/s3/photos/a.jpg[&pw=xxx]  -> 302 直链
 */
export async function handleDownload(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path required' }, 400);
  const pw = c.req.query('pw') || c.req.header('X-Folder-Password') || '';
  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (p: string) => driver.readText(p);

  // 文件所在目录需满足门禁（若有）
  const gateOk =
    (await verifyPassword(mount.passwd, pw)) &&
    (await checkFolderPassword(parentDir(path), pw || undefined, readText));
  if (!gateOk) return c.json({ error: 'password_required' }, 403);

  const url = await driver.link(rest);
  const cc = mount.cache || c.env.CACHE_CONTROL || 'public, max-age=300';
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': cc },
  });
}

/**
 * GET /api/search?q=foo&path=/s3[&pw=xxx]
 * 现搜 + 内存索引（S3 flat 扫描 / OneDrive 递归）；零 KV/D1/SQL。
 */
export async function handleSearch(c: Context<{ Bindings: Env }>) {
  const q = (c.req.query('q') || '').toLowerCase();
  const path = c.req.query('path') || '/';
  if (!q) return c.json([], 200);
  const { driver, rest, mountPath } = await dispatch(c.env, path);

  const idxKey = mountPath + rest;
  let all = getIndex(idxKey);
  if (!all) {
    all = await driver.walk(rest); // 访问即预热索引（fire-and-forget 可后续加）
    setIndex(idxKey, all);
  }
  const results = all
    .filter((e) => e.name.toLowerCase().includes(q))
    .slice(0, 200);
  return c.json(results);
}
