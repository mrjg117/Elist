import type { Context } from 'hono';
import type { Env } from '../types';
import { dispatch } from '../lib/dispatch';
import { checkFolderPassword, filterHidden } from '../lib/acl';
import { getListing, setListing, getIndex, setIndex } from '../lib/cache';

/** 取父目录路径（用于文件下载时校验所在目录密码）。 */
function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/**
 * GET /api/list?path=/s3/photos
 * 列表 + 文件夹密码 + 隐藏过滤 + 内存列表缓存。
 */
export async function handleList(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path') || '/';
  const pw = c.req.header('X-Folder-Password') || '';
  const { driver, rest, mountPath } = await dispatch(c.env, path);
  const readText = (p: string) => driver.readText(p);

  if (!(await checkFolderPassword(path, pw || undefined, readText))) {
    return c.json({ error: 'password_required' }, 403);
  }

  const cacheKey = mountPath + rest;
  let entries = getListing(cacheKey);
  if (!entries) {
    entries = await driver.list(rest);
    setListing(cacheKey, entries);
  }
  const visible = await filterHidden(path, entries, readText);
  return c.json(visible);
}

/**
 * GET /api/download?path=/s3/photos/a.jpg  -> 302 直链
 */
export async function handleDownload(c: Context<{ Bindings: Env }>) {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path required' }, 400);
  const pw = c.req.header('X-Folder-Password') || '';
  const { driver, rest } = await dispatch(c.env, path);
  const readText = (p: string) => driver.readText(p);

  // 文件所在目录需满足密码（若有）
  if (!(await checkFolderPassword(parentDir(path), pw || undefined, readText))) {
    return c.json({ error: 'password_required' }, 403);
  }
  const url = await driver.link(rest);
  const cc = c.env.CACHE_CONTROL || 'public, max-age=300';
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': cc },
  });
}

/**
 * GET /api/search?q=foo&path=/s3
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
