import type { Mount, Env, AuthAccount } from './types';

/**
 * 从 env 解析多盘配置（v3）。
 *
 * 设计：每账号一个 AUTH_<NAME> 变量（JSON），凭据只写一次，其下 mounts[] 列出该账号
 * 要挂的 N 个目录。解析时把每个账号展开成多个 Mount（目录级），按最长前缀匹配派发。
 * 零 KV/D1/SQL：改配置 = 改 env(secret) + 重部署（边缘秒级）。
 */

let cached: Mount[] | null = null;

export function getMounts(env: Env): Mount[] {
  if (cached) return cached;
  const mounts: Mount[] = [];

  for (const key of Object.keys(env)) {
    if (!key.startsWith('AUTH_')) continue;
    const raw = env[key];
    if (!raw || typeof raw !== 'string') continue;

    let acct: AuthAccount;
    try {
      acct = JSON.parse(raw) as AuthAccount;
    } catch {
      continue; // 解析失败的变量跳过，不阻塞其他账号
    }
    if (!acct.type || !Array.isArray(acct.mounts)) continue;

    // 该账号的鉴权字段（去掉 mounts，作为每个挂载点的 addition）
    const addition: Record<string, any> = { ...acct };
    delete addition.mounts;

    for (const mp of acct.mounts) {
      mounts.push({
        mount: normalize(mp.path || '/'),
        root: normalize(mp.root || '/'),
        driver: acct.type,
        title: mp.title,
        cache: mp.cache,
        hide: !!mp.hide,
        passwd: mp.passwd,
        sort: mp.sort,
        addition,
      });
    }
  }

  // 按 path 长度降序：findMount 取最长前缀匹配
  mounts.sort((a, b) => b.mount.length - a.mount.length);
  cached = mounts;
  return mounts;
}

/** 按路径前缀匹配到具体挂载点，返回 {mount, rest}。rest 为盘内相对路径。 */
export function findMount(
  mounts: Mount[],
  path: string
): { mount: Mount; rest: string } | null {
  let best: Mount | null = null;
  let bestLen = -1;
  for (const m of mounts) {
    if (path === m.mount || path.startsWith(m.mount + '/')) {
      if (m.mount.length > bestLen) {
        best = m;
        bestLen = m.mount.length;
      }
    }
  }
  if (!best) return null;
  const rest = path.slice(best.mount.length) || '/';
  return { mount: best, rest };
}

/** 规范化路径：统一前导 /，去尾斜杠（根除外）。 */
export function normalize(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/**
 * 根目录（/）展示的盘列表：按 MOUNT_ORDER 排，剔除 hide 的盘。
 * 每个盘只出现一次（按 mount 前缀去重，保留首个）。
 */
export function getRoots(env: Env): { path: string; title?: string; hide?: boolean }[] {
  const seen = new Set<string>();
  const list = getMounts(env)
    .filter((m) => !seen.has(m.mount) && seen.add(m.mount))
    .map((m) => ({ path: m.mount, title: m.title, hide: m.hide }));

  const order = (env.MOUNT_ORDER || '')
    .split(',')
    .map((s) => normalize(s.trim()))
    .filter(Boolean);
  if (order.length) {
    list.sort((a, b) => {
      const ia = order.indexOf(a.path);
      const ib = order.indexOf(b.path);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }
  return list.filter((r) => !r.hide);
}
