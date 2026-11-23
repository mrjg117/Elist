import type { Mount, Env, AuthAccount, MountConfig, UserMount } from './types';

/** MOUNT_<NAME> 的三种写法（单对象 / 用户数组 / {users:[...]}）统一归一为用户数组。 */
function normalizeUsers(cfg: MountConfig): UserMount[] {
  if (Array.isArray(cfg)) return cfg;
  if (cfg && typeof cfg === 'object' && 'users' in cfg && Array.isArray(cfg.users)) return cfg.users;
  return [cfg as UserMount];
}

/**
 * 从 env 解析多盘配置（v4）。
 * AUTH_<NAME>：凭据；MOUNT_<NAME>：挂载；后缀匹配配对。
 * 展开为目录级 Mount，按最长前缀匹配派发。零 KV/D1/SQL。
 */

let cached: Mount[] | null = null;

export function getMounts(env: Env): Mount[] {
  if (cached) return cached;
  const mounts: Mount[] = [];

  // 收集所有 AUTH_XXX 和 MOUNT_XXX 变量
  const authMap = new Map<string, AuthAccount>();
  const mountMap = new Map<string, MountConfig>();

  for (const key of Object.keys(env)) {
    if (key.startsWith('AUTH_')) {
      const name = key.slice(5); // 去掉 AUTH_ 前缀
      const raw = env[key];
      if (!raw || typeof raw !== 'string') continue;
      try {
        authMap.set(name, JSON.parse(raw) as AuthAccount);
      } catch {
        // 解析失败跳过
      }
    } else if (key.startsWith('MOUNT_')) {
      const name = key.slice(6); // 去掉 MOUNT_ 前缀
      const raw = env[key];
      if (!raw || typeof raw !== 'string') continue;
      try {
        mountMap.set(name, JSON.parse(raw) as MountConfig);
      } catch {
        // 解析失败跳过
      }
    }
  }

  // 配对 AUTH_XXX 和 MOUNT_XXX（后缀匹配）
  for (const [name, mountConfig] of mountMap.entries()) {
    const auth = authMap.get(name);
    if (!auth || !auth.type) continue;

    // 该账号的鉴权字段（作为每个挂载点的 addition），同一 NAME 下所有 user 共用
    const addition: Record<string, any> = { ...auth };

    // 展开每个 user 的挂载点；user_id === 'sharepoint' 走 SP 驱动，否则按 auth.type
    for (const user of normalizeUsers(mountConfig)) {
      for (const mp of user.mounts || []) {
        const isSP = user.user_id === 'sharepoint';
        mounts.push({
          mount: normalize(mp.path || '/'),
          root: normalize(mp.root || '/'),
          driver: isSP ? 'sharepoint' : auth.type,
          title: mp.title,
          cache: mp.cache,
          user_id: user.user_id,
          tenant: name,
          addition,
        });
      }
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
    if (path === m.mount || (m.mount === '/' ? true : path.startsWith(m.mount + '/'))) {
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

/** 规范化路径：统一前导 /，去尾斜杠（根除外），解析 .. 防止路径穿越。 */
export function normalize(path: string): string {
  path = (path || '').trim(); // 配置里复制粘贴常带首尾空格，统一去掉（不影响文件名中间的空格）
  if (!path.startsWith('/')) path = '/' + path;
  // 解析相对路径段，防止路径穿越
  const parts = path.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      resolved.pop(); // 安全：空数组 pop 返回 undefined，不会越界
      continue;
    }
    resolved.push(part);
  }
  const normalized = '/' + resolved.join('/');
  return normalized === '/' ? '/' : normalized;
}

/**
 * 根目录（/）展示的盘列表：按 MOUNT_ORDER 排序。
 * 每个盘只出现一次（按 mount 前缀去重，保留首个）。
 * 隐藏状态从 .elist.xlsx 配置读取，由调用方处理。
 */
export function getRoots(env: Env): { path: string; title?: string; driver: string; tenant?: string }[] {
  const mounts = getMounts(env);
  // 先按路径长度升序排序，确保父目录先于子目录处理
  const sorted = [...mounts].sort((a, b) => a.mount.length - b.mount.length);
  const roots: { path: string; title?: string; driver: string; tenant?: string }[] = [];
  
  // 按前缀去重：如果 /od 已添加，则 /od/photos 不再添加
  for (const m of sorted) {
    const isChild = roots.some(r => m.mount === r.path || m.mount.startsWith(r.path + '/'));
    if (!isChild) {
      roots.push({ path: m.mount, title: m.title, driver: m.driver, tenant: m.tenant });
    }
  }

  const order = (env.MOUNT_ORDER || '')
    .split(',')
    .map((s) => normalize(s.trim()))
    .filter(Boolean);
  if (order.length) {
    roots.sort((a, b) => {
      const ia = order.indexOf(a.path);
      const ib = order.indexOf(b.path);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }
  return roots;
}
