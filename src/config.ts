import type { Mount, Env, AuthAccount, MountConfig } from './types';

/**
 * 从 env 解析多盘配置（v4，变量拆分）。
 *
 * 设计：
 *   - AUTH_<NAME>：账号机密（type、凭据）
 *   - MOUNT_<NAME>：挂载配置（users 数组，每个 user 有 user_id 和 mounts）
 *   - 变量名后缀匹配：MOUNT_ZHU 自动关联 AUTH_ZHU
 *
 * 解析时把每个账号展开成多个 Mount（目录级），按最长前缀匹配派发。
 * 零 KV/D1/SQL：改配置 = 改 env(secret) + 重部署（边缘秒级）。
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

    // 该账号的鉴权字段（作为每个挂载点的 addition）
    const addition: Record<string, any> = { ...auth };

    // 遍历 users 数组，展开所有挂载点
    for (const user of mountConfig.users || []) {
      for (const mp of user.mounts || []) {
        mounts.push({
          mount: normalize(mp.path || '/'),
          root: normalize(mp.root || '/'),
          driver: auth.type,
          title: mp.title,
          cache: mp.cache,
          hide: !!mp.hide,
          e5rnl: !!mp.e5rnl,
          user_id: user.user_id,
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
