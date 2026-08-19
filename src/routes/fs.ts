import type { Context } from 'hono';
import type { Env, Entry, Mount } from '../types';
import { dispatch } from '../lib/dispatch';
import {
  checkPathPassword,
  filterHidden,
  isHidden,
  MARKER_FILES,
} from '../lib/acl';
import { getListing, setListing, searchListings } from '../lib/cache';
import { getRoots, getMounts } from '../config';
import * as xlsxConfig from '../lib/xlsx-config';

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

/** 收集请求中所有 X-Folder-Password 头，作为客户端已知密码集合。
 *  注意：Fetch 规范的 Headers.forEach 会把同名重复头合并成逗号分隔的单个值，
 *  因此需要按逗号拆分，以支持前端 append 多个密码的场景。
 */
function collectPws(c: Context<{ Bindings: Env }>): string[] {
  const out: string[] = [];
  c.req.raw.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'x-folder-password') {
      for (const v of value.split(',')) {
        const t = v.trim();
        if (t) out.push(t);
      }
    }
  });
  return out;
}

/** 是否强制回源（绕过 listing/ACL 缓存）：?fresh=1 或 X-Fresh: 1 头。供前端"刷新"按钮触发。 */
function isFresh(c: Context<{ Bindings: Env }>): boolean {
  if (c.req.query('fresh') === '1') return true;
  const h = c.req.header('x-fresh');
  return h === '1' || h === 'true';
}

/** 获取所有存储账号（从 AUTH_* 环境变量解析） */
function getAllAuthAccounts(env: Env): Array<{ name: string; type: string; auth: any }> {
  const accounts: Array<{ name: string; type: string; auth: any }> = [];
  
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('AUTH_') && typeof value === 'string') {
      try {
        const auth = JSON.parse(value);
        if (auth.type) {
          accounts.push({ name: key.slice(5), type: auth.type, auth });
        }
      } catch {
        // 忽略解析失败的
      }
    }
  }
  
  return accounts;
}

/** 加载 .elist.xlsx 配置到内存（首次访问时触发） */
async function loadXlsxConfig(c: Context<{ Bindings: Env }>, fresh = false): Promise<void> {
  if (xlsxConfig.isLoaded() && !fresh) return;

  const configPath = c.env.CONFIG_PATH || '/';
  const accounts = getAllAuthAccounts(c.env);

  // 遍历所有存储账号，尝试读取 .elist.xlsx
  for (const account of accounts) {
    try {
      const { getDriverClass } = await import('../drivers/registry');
      const DriverClass = getDriverClass(account.type);
      if (!DriverClass) continue;

      const driver = new DriverClass();
      await driver.init({
        mount: '/',
        root: configPath,
        driver: account.type,
        addition: account.auth,
      }, c.env);

      const xlsxPath = '/.elist.xlsx';
      const content = await driver.readBinary(xlsxPath);
      if (content) {
        const xlsxPassword = c.env.XLSX_PASSWORD;
        await xlsxConfig.parseXlsx(content, xlsxPassword);
        return;
      }
    } catch (e) {
      // 读取失败，尝试下一个存储
      continue;
    }
  }
  
  // 没有找到 .elist.xlsx，标记为已加载（空配置）
  xlsxConfig.markLoaded();
}

/** 获取配置文件存放的存储位置（根据 CONFIG_AUTH 环境变量） */
async function getConfigMount(c: Context<{ Bindings: Env }>): Promise<{ driver: any; rest: string } | null> {
  const configAuth = c.env.CONFIG_AUTH;
  const configPath = c.env.CONFIG_PATH || '/';
  const accounts = getAllAuthAccounts(c.env);

  if (accounts.length === 0) return null;

  let targetAccount: { name: string; type: string; auth: any } | null = null;

  if (!configAuth) {
    // 未配置，使用第一个存储账号
    targetAccount = accounts[0];
  } else if (configAuth === ':first-onedrive') {
    // 查找第一个 OneDrive 存储
    targetAccount = accounts.find(a => a.type === 'onedrive') || null;
  } else if (configAuth === ':first-s3') {
    // 查找第一个 S3 存储
    targetAccount = accounts.find(a => a.type === 's3') || null;
  } else {
    // 指定存储账号名（如 OD1）
    targetAccount = accounts.find(a => a.name === configAuth) || null;
  }

  if (!targetAccount) return null;

  const { getDriverClass } = await import('../drivers/registry');
  const DriverClass = getDriverClass(targetAccount.type);
  if (!DriverClass) return null;

  const driver = new DriverClass();
  await driver.init({
    mount: '/',
    root: configPath,
    driver: targetAccount.type,
    addition: targetAccount.auth,
  }, c.env);

  return { driver, rest: '/' };
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
  const fresh = isFresh(c);

  // 首次访问或强制刷新时加载 .elist.xlsx 配置
  await loadXlsxConfig(c, fresh);

  // 根目录：展示盘列表（hide 的盘已剔除 + 检查每个挂载根路径的 .hidden）
  if (path === '/' || path === '') {
    const roots = getRoots(c.env);
    // 检查每个挂载根路径是否有 .hidden 文件（存在即隐藏）
    const visibleRoots = await Promise.all(
      roots.map(async (r) => {
        // 找到对应的 driver 来读取 .hidden
        const { driver, rest, mount } = await dispatch(c.env, r.path);
        const readText = (full: string) => driver.readText(toRest(full, mount));
        const hidden = await isHidden(r.path, readText, fresh);
        return { root: r, hidden };
      })
    );
    const result = visibleRoots
      .filter((v) => !v.hidden)
      .map((v) => ({
        name: v.root.title || v.root.path,
        path: v.root.path,
        isDir: true,
      }));
    return c.json(result);
  }

  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 门禁：自身 + 所有祖先目录的 .passwd 都满足才放行（级联；子层需各自密码=重新鉴权）
  const gate = await checkPathPassword(path, pws, readText, fresh);
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);

  const cacheKey = mount.mount + rest;
  let entries = fresh ? null : getListing(cacheKey);
  if (!entries) {
    entries = await driver.list(rest);
    setListing(cacheKey, entries);
  }
  let visible = await filterHidden(path, entries, readText, fresh);
  visible = visible.filter((e) => !MARKER_FILES.has(e.name));// 排序
  const spec = c.req.query('sort') || mount.sort || 'name_asc';
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

  const gate = await checkPathPassword(parentDir(path), pws, readText, isFresh(c));
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);

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

  const gate = await checkPathPassword(parentDir(path), pws, readText, isFresh(c));
  if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);

  const url = await driver.link(rest);
  const cc = mount.cache || c.env.CACHE_CONTROL || 'public, max-age=300';
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': cc },
  });
}

/**
 * POST /api/config/save
 * 保存 xlsx 配置到存储（将内存中的配置写回 .elist.xlsx）
 */
export async function handleConfigSave(c: Context<{ Bindings: Env }>) {
  if (!xlsxConfig.isDirty()) {
    return c.json({ success: true, message: 'No changes to save' });
  }

  const body = await c.req.json();
  const mountPath = body.mount; // 前端可以指定挂载点

  let configMount;
  if (mountPath) {
    // 前端指定了挂载点
    try {
      const { driver, rest } = await dispatch(c.env, mountPath);
      configMount = { driver, rest };
    } catch (e) {
      return c.json({ error: 'Invalid mount path' }, 400);
    }
  } else {
    // 使用 CONFIG_MOUNT 环境变量或默认第一个挂载点
    configMount = await getConfigMount(c);
    if (!configMount) {
      return c.json({ error: 'No mount point available for config storage' }, 500);
    }
  }

  const { driver, rest } = configMount;
  const xlsxPath = rest === '/' ? '/.elist.xlsx' : rest + '/.elist.xlsx';

  const xlsxPassword = c.env.XLSX_PASSWORD;
  const content = await xlsxConfig.generateXlsx(xlsxPassword);
  await driver.writeBinary(xlsxPath, content);

  xlsxConfig.clearDirty();
  return c.json({ success: true });
}

/**
 * POST /api/config/clear
 * 清理缓存（先保存未保存的修改，再清空内存）
 */
export async function handleConfigClear(c: Context<{ Bindings: Env }>) {
  // 如果有未保存的修改，先保存
  if (xlsxConfig.isDirty()) {
    const configMount = await getConfigMount(c);
    if (configMount) {
      const { driver, rest } = configMount;
      const xlsxPath = rest === '/' ? '/.elist.xlsx' : rest + '/.elist.xlsx';
      const xlsxPassword = c.env.XLSX_PASSWORD;
      const content = await xlsxConfig.generateXlsx(xlsxPassword);
      await driver.writeBinary(xlsxPath, content);
    }
  }

  // 清空内存
  xlsxConfig.clearAll();
  return c.json({ success: true });
}

/**
 * GET /api/search?q=foo&path=/s3
 * 被动缓存搜索：只在用户已浏览过的目录（惰性缓存）里匹配，绝不主动 walk / 全量扫描。
 * 结果按当前盘范围(mount.mount)过滤。未浏览过的目录不会出现。
 * 零 KV/D1/SQL，不发出任何后端请求（天然规避边缘函数出网次数限制）。
 */
export async function handleSearch(c: Context<{ Bindings: Env }>) {
  const q = (c.req.query('q') || '').toLowerCase();
  const path = c.req.query('path') || '/';
  if (!q) return c.json([], 200);
  const { mount } = await dispatch(c.env, path);

  // 缓存内的条目均来自已鉴权浏览，无需逐条再验门禁；仅做盘范围过滤。
  const matched = searchListings(q)
    .filter((e) => e.path.startsWith(mount.mount))
    .slice(0, 200);
  return c.json(matched);
}
