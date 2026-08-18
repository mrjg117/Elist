import type { Entry } from '../types';

/**
 * per-isolate 内存缓存（零 KV/D1/SQL）。
 *
 * 被动缓存策略（v4）：
 *   - 目录列表 = 用户「人工浏览」某文件夹时惰性写入（handleList 命中即缓存）。
 *   - 搜索 = 只在已浏览过的目录里匹配，绝不做主动 walk / 全量扫描。
 *   - 没浏览过的目录不会出现在搜索结果里；符合「人工拉过的才进缓存，不主动缓存」。
 *
 * 注意（方案 §3.3）：
 *   - 每个边缘 isolate 内存独立，Map 不跨实例共享 -> 多 isolate 会各自建副本，
 *     这是 0 依赖的必然代价，个人盘量级有界、可接受。
 *   - 仅作缓存，不能当真相源；TTL 到期回源。
 */

interface CacheVal {
  entries: Entry[];
  expireAt: number;
}

const listingCache = new Map<string, CacheVal>();

const TTL_MS = 10 * 60 * 1000; // 10 分钟

export function getListing(key: string): Entry[] | null {
  const v = listingCache.get(key);
  if (!v) return null;
  if (Date.now() > v.expireAt) {
    listingCache.delete(key);
    return null;
  }
  return v.entries;
}

export function setListing(key: string, entries: Entry[]): void {
  listingCache.set(key, { entries, expireAt: Date.now() + TTL_MS });
}

// ---- ACL 缓存（.passwd / .hidden 读取结果，短 TTL）----
// 门禁校验逐层读 .passwd / 列目录读 .hidden 都是一次后端 fetch。
// 缓存后同目录重复访问 = 0 次 fetch：既省后端压力，也规避边缘函数出网次数限制
// （如阿里云 ESA 单次执行最多 4 个 fetch 的硬上限）。
// TTL 比 listing(10m) 短（5m）：密码改动的传播延迟要更小。
interface AclVal {
  passwd?: string | null; // undefined = 尚未加载
  hidden?: string | null; // undefined = 尚未加载（已废弃，保留兼容）
  selfHidden?: boolean;   // undefined = 尚未加载；true = 该路径下存在 .hidden 文件
  expireAt: number;
}
const aclCache = new Map<string, AclVal>();
const ACL_TTL_MS = 5 * 60 * 1000; // 5 分钟

export function getAcl(dir: string): AclVal | null {
  const v = aclCache.get(dir);
  if (!v) return null;
  if (Date.now() > v.expireAt) {
    aclCache.delete(dir);
    return null;
  }
  return v;
}

/** 增量更新某目录的 ACL 缓存：只覆盖传入字段，保留另一字段（若已加载）。 */
export function setAcl(dir: string, val: { passwd?: string | null; hidden?: string | null; selfHidden?: boolean }): void {
  const prev = aclCache.get(dir);
  aclCache.set(dir, {
    passwd: val.passwd !== undefined ? val.passwd : prev?.passwd,
    hidden: val.hidden !== undefined ? val.hidden : prev?.hidden,
    selfHidden: val.selfHidden !== undefined ? val.selfHidden : prev?.selfHidden,
    expireAt: Date.now() + ACL_TTL_MS,
  });
}

/**
 * 被动搜索：仅在已浏览（惰性缓存）的目录里匹配 q（子串，大小写不敏感）。
 * 不做任何后端请求；未浏览的目录不在结果内。
 */
export function searchListings(q: string): Entry[] {
  const ql = q.toLowerCase();
  const out: Entry[] = [];
  for (const v of listingCache.values()) {
    if (Date.now() > v.expireAt) continue;
    for (const e of v.entries) {
      if (e.name.toLowerCase().includes(ql) || e.path.toLowerCase().includes(ql)) {
        out.push(e);
      }
    }
  }
  return out;
}

/** 已缓存目录数（调试/可观测用）。 */
export function cachedDirCount(): number {
  let n = 0;
  for (const v of listingCache.values()) if (Date.now() <= v.expireAt) n++;
  return n;
}
