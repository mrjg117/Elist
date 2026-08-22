import type { Context } from 'hono';
import type { Env, Entry, Mount, MountConfig } from '../types';
import { dispatch } from '../lib/dispatch';
import {
  checkPathPassword,
  constantTimeCompare,
  filterHidden,
  isHidden,
  MARKER_FILES,
} from '../lib/acl';
import { getListing, setListing, searchListings } from '../lib/cache';
import { normalize } from '../config';
import { getRoots, getMounts } from '../config';
import * as xlsxConfig from '../lib/xlsx-config';

/** 取父目录路径（用于文件下载时校验所在目录密码）。 */
function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}
/** 取文件名（含扩展名）。 */
function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return path.slice(i + 1) || 'download';
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
export function getAllAuthAccounts(env: Env): Array<{ name: string; type: string; auth: any }> {
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

// in-flight 去重：防止并发请求重复加载配置
let pendingLoad: Promise<void> | null = null;
// 记录上次实际读到 .elist.xlsx 的账号名，保存时优先写回同一位置，
// 避免多账号下「读 A 账号 / 写 B 账号」导致隐藏/密码配置读不到（根目录仍显示已隐藏盘）。
let lastConfigAccount: string | null = null;
/**
 * 配置读写位置收敛为「同一个确定性账号」，根除多账号下读 A 写 B / 自动创建错位
 * 导致的「无痕窗口偶发显示已隐藏挂载盘」（内存不统一），并消除多账号遍历读取造成的
 * 出网子请求过多 → 503。
 * 优先级：CONFIG_AUTH > 首个 onedrive > 首个 s3 > 第一个账号。返回具体账号名（单值，永不为「未确定」）。
 */
function getConfigAccount(c: Context<{ Bindings: Env }>): string | null {
  const accounts = getAllAuthAccounts(c.env);
  if (accounts.length === 0) return null;
  if (c.env.CONFIG_AUTH) {
    const a = accounts.find((x) => x.name === c.env.CONFIG_AUTH);
    if (a) return a.name;
  }
  const od = accounts.find((x) => x.type === 'onedrive');
  if (od) return od.name;
  const s3 = accounts.find((x) => x.type === 's3');
  if (s3) return s3.name;
  return accounts[0].name;
}

/** 保存配置目标：与读取位置完全一致（同一确定性账号），保证读=写同一处，根除隐藏盘泄露与 503。 */
export function getConfigSaveTargets(c: Context<{ Bindings: Env }>): string[] {
  const acc = getConfigAccount(c);
  return acc ? [acc] : [];
}

/** 取某账号在 MOUNT_<NAME> 配置中的 user_id（OneDrive app-only 鉴权必需）。
 *  优先取命中 CONFIG_PATH 的挂载用户；否则取首个有挂载的用户。
 *  缺失会触发 onedrive.ts 的 `requires user_id` 报错，导致配置加载失败、所有子目录被门禁拦截。
 */
export function getMountUserId(env: Env, accountName: string): string {
  const raw = (env as Record<string, unknown>)[`MOUNT_${accountName}`];
  if (typeof raw !== 'string') return '';
  try {
    const cfg = JSON.parse(raw) as MountConfig;
    const path = normalize(env.CONFIG_PATH || '/');
    for (const user of cfg.users || []) {
      for (const mp of user.mounts || []) {
        if (normalize(mp.path || '/') === path) return user.user_id || '';
      }
    }
    return cfg.users?.[0]?.user_id || '';
  } catch {
    return '';
  }
}

/** 取某账号 MOUNT_<NAME> 配置中，命中 CONFIG_PATH 的挂载用户标识（user_id）。
 *  同一 AUTH_ 账号下可能有多个 user（多邮箱/多盘），配置具体落在哪个 user 的盘里靠它区分。
 *  优先取命中 CONFIG_PATH 的 user；否则取首个有挂载的 user。 */
export function getConfigUser(env: Env, accountName: string): string {
  const raw = (env as Record<string, unknown>)[`MOUNT_${accountName}`];
  if (typeof raw !== 'string') return '';
  try {
    const cfg = JSON.parse(raw) as MountConfig;
    const path = normalize(env.CONFIG_PATH || '/');
    for (const user of cfg.users || []) {
      for (const mp of user.mounts || []) {
        if (normalize(mp.path || '/') === path) return user.user_id || '';
      }
    }
    return cfg.users?.[0]?.user_id || '';
  } catch {
    return '';
  }
}

/** 加载 .elist.xlsx 配置到内存（首次访问时触发）。
 *  收敛为「单一确定性账号」读取（CONFIG_AUTH > first-onedrive > first-s3 > first），
 *  出网子请求从 N×2 降为 1~2 次，消除多账号遍历导致的 503。
 *  仅当确定性账号无配置文件时，才回退扫描其余账号寻找首个有内容的配置（读=写一致，绝不误建空文件）。
 *  仅当全账号均无配置文件（首跑）时，在确定性账号自动创建空白配置。 */
export async function loadXlsxConfig(c: Context<{ Bindings: Env }>, fresh = false): Promise<void> {
  if (xlsxConfig.isLoaded() && !fresh) return;

  // in-flight 去重：如果已有加载任务在进行，直接复用
  if (pendingLoad && !fresh) {
    return pendingLoad;
  }

  // 创建加载 Promise 并赋值给 pendingLoad
  pendingLoad = (async () => {
    const configPath = c.env.CONFIG_PATH || '/';
    const accounts = getAllAuthAccounts(c.env);
    if (accounts.length === 0) {
      xlsxConfig.markLoaded();
      console.warn('loadXlsxConfig: 无可用存储账号，配置为空（失败安全）');
      return;
    }

    // 读取单个账号的 .elist.xlsx；成功解析则记入 lastConfigAccount（读=写一致）。
    const readFrom = async (name: string): Promise<boolean> => {
      const account = accounts.find((a) => a.name === name);
      if (!account) return false;
      try {
        const { getDriverClass } = await import('../drivers/registry');
        const DriverClass = getDriverClass(account.type);
        if (!DriverClass) return false;
        const driver = new DriverClass();
        await driver.init({
          mount: '/',
          root: configPath,
          driver: account.type,
          addition: account.auth,
          user_id: getMountUserId(c.env, account.name),
        }, c.env);
        const content = await driver.readBinary('/.elist.xlsx');
        if (content) {
          await xlsxConfig.parseXlsx(content, c.env.CONF_PW);
          lastConfigAccount = name;
          return true;
        }
        return false; // 该账号无配置文件，可继续回退
      } catch (e) {
        console.error('loadXlsxConfig read failed for', name, e);
        return false;
      }
    };

    // 1) 优先读取确定性账号（正常情况仅此 1 次出网子请求）
    const primary = getConfigAccount(c)!;
    if (await readFrom(primary)) {
      xlsxConfig.markLoaded();
      return;
    }

    // 2) 确定性账号无配置：扫描其余账号找首个有内容的配置（读=写一致，不误建空文件）
    for (const account of accounts) {
      if (account.name === primary) continue;
      if (await readFrom(account.name)) {
        xlsxConfig.markLoaded();
        return;
      }
    }

    // 3) 全账号均无配置文件：保持「未加载」状态，由 acl.ts 失败安全默认隐藏所有项。
    //    绝不在此自动创建空 .elist.xlsx 并 markLoaded()——空配置会清空隐藏/密码规则，
    //    导致根目录显示全部挂载盘（即最初好用的隐藏功能被误改没的根因）。首跑用户应自行
    //    通过管理页保存配置来创建文件，届时 handleSaveConfig 会写回并 markLoaded()。
  })();

  try {
    await pendingLoad;
  } finally {
    // 加载完成后清空 pendingLoad，允许下次 fresh=true 重新加载
    pendingLoad = null;
  }
}

/** 获取配置文件存放的存储位置：与读取位置完全一致（同一确定性账号）。 */
async function getConfigMount(c: Context<{ Bindings: Env }>): Promise<{ driver: any; rest: string } | null> {
  const configPath = c.env.CONFIG_PATH || '/';
  const accounts = getAllAuthAccounts(c.env);
  if (accounts.length === 0) return null;

  // 保存/清理位置与读取位置一致：优先 lastConfigAccount（真实读到的位置）> 确定性账号
  const targetName = lastConfigAccount || getConfigAccount(c);
  if (!targetName) return null;
  const targetAccount = accounts.find((a) => a.name === targetName);
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
    user_id: getMountUserId(c.env, targetAccount.name),
  }, c.env);

  return { driver, rest: '/' };
}

/** 管理员页展示当前使用的配置文件位置（账号 + 命中用户 + 路径），始终返回具体值，绝不为「未确定」。
 *  account 形如「d70d7245-… / admin@zh33.onmicrosoft.com」，让你一眼看清配置落在哪个账号的哪个 user 盘。 */
export async function getConfigInfo(c: Context<{ Bindings: Env }>): Promise<{ account: string | null; path: string; loaded: boolean; dirty: boolean }> {
  if (!xlsxConfig.isLoaded()) {
    try { await loadXlsxConfig(c, false); } catch { /* 失败安全 */ }
  }
  const acc = lastConfigAccount || getConfigAccount(c);
  const user = acc ? getConfigUser(c.env, acc) : '';
  const accountLabel = acc ? (user ? `${acc} / ${user}` : acc) : null;
  const base = normalize(c.env.CONFIG_PATH || '/');
  const path = base === '/' ? '/.elist.xlsx' : base + '/.elist.xlsx';
  return { account: accountLabel, path, loaded: xlsxConfig.isLoaded(), dirty: xlsxConfig.isDirty() };
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
/** 管理员请求（X-Admin-Password 头 == admin_password，无状态）。管理员可见隐藏目录并带标记。 */
async function isAdminRequest(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const headerPw = c.req.header('X-Admin-Password');
  if (!headerPw) return false;
  try { await loadXlsxConfig(c, false); } catch { return false; }
  const adminPassword = xlsxConfig.getConfig('admin_password') || '';
  return !!adminPassword && constantTimeCompare(headerPw, adminPassword);
}

export async function handleList(c: Context<{ Bindings: Env }>) {
  const path = normalize(c.req.query('path') || '/');
  const pws = collectPws(c);
  const fresh = isFresh(c);

  // 首次访问或强制刷新时加载 .elist.xlsx 配置
  await loadXlsxConfig(c, fresh);
  const admin = await isAdminRequest(c);

  // 根目录：展示盘列表（管理员可见隐藏盘并带标记；普通浏览过滤）
  if (path === '/' || path === '') {
    const roots = getRoots(c.env);
    // 检查每个挂载根路径是否隐藏（从 xlsx 配置读取）
    const visibleRoots = await Promise.all(
      roots.map(async (r) => {
        const hidden = await isHidden(normalize(r.path), undefined, fresh);
        const locked = !!(await xlsxConfig.getPassword(normalize(r.path)));
        return { root: r, hidden, locked };
      })
    );
    const result = visibleRoots.map((v) => ({
      name: v.root.title || v.root.path,
      path: v.root.path,
      isDir: true,
      ...(admin ? { hidden: v.hidden, locked: v.locked } : {}),
    }));
    return c.json(admin ? result : result.filter((v) => !v.hidden));
  }

  const { driver, rest, mount } = await dispatch(c.env, path);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 门禁：自身 + 所有祖先目录的密码配置都满足才放行（级联；子层需各自密码=重新鉴权）
  // 管理员免密：登录后访问隐藏/加密目录无需密码
  if (!admin) {
    const gate = await checkPathPassword(path, pws, readText, fresh);
    if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);
  }

  const cacheKey = mount.mount + rest;
  let entries = fresh ? null : getListing(cacheKey);
  if (!entries) {
    entries = await driver.list(rest);
    setListing(cacheKey, entries);
  }
  let visible;
  if (admin) {
    // 管理员：不过滤隐藏，逐条带 hidden/locked 标记（前端显示 👁/🔒 徽标）
    visible = [];
    for (const e of entries) {
      visible.push({
        ...e,
        hidden: await isHidden(normalize(e.path), undefined, fresh),
        locked: !!(await xlsxConfig.getPassword(normalize(e.path))),
      });
    }
  } else {
    const normEntries = entries.map((e) => ({ ...e, path: normalize(e.path) }));
    visible = await filterHidden(normalize(path), normEntries, readText, fresh);
    // 未登录用户：隐藏的已过滤；剩余条目带 locked（加密）标记，前端显示 🔒（不泄露 hidden）
    const out = [];
    for (const e of visible) out.push({ ...e, locked: !!(await xlsxConfig.getPassword(normalize(e.path))) });
    visible = out;
  }
  visible = visible.filter((e) => !MARKER_FILES.has(e.name));// 排序
  const spec = c.req.query('sort') || 'name_asc';
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
  const normalizedPath = normalize(path);
  const pws = collectPws(c);
  const fresh = isFresh(c);

  // 确保配置已加载（防止冷启动绕过门禁）
  await loadXlsxConfig(c, fresh);

  const { driver, rest, mount } = await dispatch(c.env, normalizedPath);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 同时校验文件路径本身和父目录路径（支持文件级密码）；管理员免密
  const admin = await isAdminRequest(c);
  if (!admin) {
    const gate = await checkPathPassword(normalizedPath, pws, readText, fresh);
    if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);
  }

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
  const normalizedPath = normalize(path);
  const pws = collectPws(c);
  const fresh = isFresh(c);

  // 确保配置已加载（防止冷启动绕过门禁）
  await loadXlsxConfig(c, fresh);

  const { driver, rest, mount } = await dispatch(c.env, normalizedPath);
  const readText = (full: string) => driver.readText(toRest(full, mount));

  // 同时校验文件路径本身和父目录路径（支持文件级密码）；管理员免密
  const admin = await isAdminRequest(c);
  if (!admin) {
    const gate = await checkPathPassword(normalizedPath, pws, readText, fresh);
    if (!gate.ok) return c.json({ error: 'password_required', lockedAt: gate.lockedAt, received: pws.length }, 403);
  }

  const url = await driver.link(rest);
  const cc = mount.cache || c.env.CACHE_CONTROL || 'public, max-age=300';

  // 代理下载模式（?proxy=1）：worker 服务端拉取直链并流式回传字节 + Content-Disposition，
  // 前端走同域 fetch→blob 触发下载，绝不跳转当前页、不弹多窗、不受跨域 CORS 限制。
  // 大文件上行 fetch 失败或上游非 2xx 时回退到 302 直链（浏览器原生下载）。
  if (c.req.query('proxy') === '1') {
    try {
      const upstream = await fetch(url);
      if (!upstream.ok && upstream.status !== 206) throw new Error('upstream ' + upstream.status);
      const headers = new Headers();
      const ct = upstream.headers.get('Content-Type');
      if (ct) headers.set('Content-Type', ct);
      const cl = upstream.headers.get('Content-Length');
      if (cl) headers.set('Content-Length', cl);
      headers.set('Cache-Control', cc);
      const fname = basenameOf(normalizedPath);
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
      return new Response(upstream.body, { status: 200, headers });
    } catch {
      // 回退 302 直链
    }
  }
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
    // 使用 CONFIG_AUTH 环境变量或默认第一个挂载点
    configMount = await getConfigMount(c);
    if (!configMount) {
      return c.json({ error: 'No mount point available for config storage' }, 500);
    }
  }

  const { driver, rest } = configMount;
  const xlsxPath = rest === '/' ? '/.elist.xlsx' : rest + '/.elist.xlsx';

  const xlsxPassword = c.env.CONF_PW;
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
      const xlsxPassword = c.env.CONF_PW;
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
  const admin = await isAdminRequest(c); // 管理员：搜索可见隐藏项且免密
  const path = normalize(c.req.query('path') || '/');
  if (!q) return c.json([], 200);

  // 确保配置已加载
  await loadXlsxConfig(c, false);

  // 获取用户已知密码集合
  const pws = collectPws(c);

  // 根目录搜索：遍历所有挂载点，合并结果
  if (path === '/') {
    const all = searchListings(q);
    // 过滤：只返回用户有权限访问且未隐藏的目录
    const matched = [];
    for (const entry of all) {
      // 过滤隐藏条目（管理员放行）
      if (!admin && (await isHidden(normalize(entry.path)))) continue;
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
      if (admin) { matched.push(entry); if (matched.length >= 200) break; continue; }
      const gate = await checkPathPassword(parentPath, pws);
      if (gate.ok) {
        matched.push(entry);
        if (matched.length >= 200) break;
      }
    }
    return c.json(matched);
  }

  const { mount } = await dispatch(c.env, path);

  // 缓存内的条目均来自已鉴权浏览，但需要验证密码保护
  const all = searchListings(q).filter((e) => e.path.startsWith(mount.mount));
  const matched = [];
  for (const entry of all) {
    // 过滤隐藏条目（管理员放行）
    if (!admin && (await isHidden(normalize(entry.path)))) continue;
    const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
    if (admin) { matched.push(entry); if (matched.length >= 200) break; continue; }
    const gate = await checkPathPassword(parentPath, pws);
    if (gate.ok) {
      matched.push(entry);
      if (matched.length >= 200) break;
    }
  }
  return c.json(matched);
}
