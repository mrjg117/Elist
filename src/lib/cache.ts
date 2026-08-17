import type { Entry } from '../types';

/**
 * per-isolate 内存缓存（零 KV/D1/SQL）。
 * 用途：
 *   1) 目录列表缓存（访问即惰性缓存 + TTL），避免用户挨个开目录才 list。
 *   2) 搜索索引（访问即预热；S3 flat 扫描 / OneDrive 递归建索引）。
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
const indexCache = new Map<string, { entries: Entry[]; expireAt: number }>();

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

export function getIndex(key: string): Entry[] | null {
  const v = indexCache.get(key);
  if (!v) return null;
  if (Date.now() > v.expireAt) {
    indexCache.delete(key);
    return null;
  }
  return v.entries;
}

export function setIndex(key: string, entries: Entry[]): void {
  indexCache.set(key, { entries, expireAt: Date.now() + TTL_MS });
}
