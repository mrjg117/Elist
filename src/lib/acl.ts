export type ReadText = (path: string) => Promise<string | null>;

import * as xlsxConfig from './xlsx-config';

/**
 * 恒定时间字符串比较，防止计时攻击。
 * 即使长度不同，也会遍历完整长度再返回结果。
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 长度不同，但仍需遍历较长字符串的长度
    const maxLen = Math.max(a.length, b.length);
    let result = a.length ^ b.length;
    for (let i = 0; i < maxLen; i++) {
      const ca = i < a.length ? a.charCodeAt(i) : 0;
      const cb = i < b.length ? b.charCodeAt(i) : 0;
      result |= ca ^ cb;
    }
    return result === 0;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 文件夹级访问门禁：基于 .elist.xlsx 集中配置（内存 Map）。
 *
 * 设计：
 *   - 启动时或首次访问时读取 .elist.xlsx 到内存
 *   - 所有 ACL 检查走内存 Map（< 1ms）
 *   - 配置通过管理页面或 XLSX 文件维护
 *
 * .elist.xlsx 结构：
 *   Sheet1: passwords（路径密码配置）
 *     | path | password | hint |
 *   Sheet2: hidden（隐藏目录）
 *     | path |
 */

/**
 * 校验完整路径的访问权限：从内存 Map 检查密码配置（级联）。
 * provided 为客户端已知密码集合。
 * 路径上每个有密码配置的目录，都必须被 provided 中至少一个密码命中，否则拒绝。
 */
export async function checkPathPassword(
  fullPath: string,
  provided: string[],
  _readText?: ReadText,
  _fresh = false,
  isAdmin = false
): Promise<{ ok: boolean; lockedAt?: string; required?: boolean }> {
  // 未加载时拒绝访问（安全：防止冷启动绕过）
  if (!xlsxConfig.isLoaded()) {
    return { ok: false, lockedAt: fullPath };
  }

  // 管理员身份 bypass 所有目录密码门禁（与网页端 /api/* 一致）。
  // 注意：isAdmin 仅在 admin_password 已校验通过（配置已加载）时才为 true，
  // 故此处放行不会在「配置未加载」时意外泄露（失败安全仍由上方 isLoaded 守卫）。
  if (isAdmin) return { ok: true, required: true };

  const segs = fullPath.split('/').filter(Boolean);
  let acc = '';
  let required = false;
  for (const s of segs) {
    acc += '/' + s;
    const pwConfig = xlsxConfig.getPassword(acc);
    if (!pwConfig) continue; // 无密码配置 = 该层公开

    required = true; // 祖先链中存在密码配置
    const expectedPassword = pwConfig.password;
    // 使用恒定时间比较，防止计时攻击
    const matched = provided.some(p => constantTimeCompare(p, expectedPassword));
    if (!matched) {
      return { ok: false, lockedAt: acc, required: true };
    }
  }
  return { ok: true, required };
}

/** 某条目是否应被隐藏（从内存 Map 检查）。 */
export async function isHidden(
  entryPath: string,
  _readText?: ReadText,
  _fresh = false
): Promise<boolean> {
  if (!xlsxConfig.isLoaded()) {
    // 失败安全：配置未加载（冷启动 / isolate 内存未统一 / 读取失败）时默认「隐藏」，
    // 绝不因内存不一致而泄露隐藏项。与 X-Admin-Password 无状态鉴权同一思路：
    // 安全判定不依赖易失内存，宁可拒绝服务也不泄露。
    return true;
  }
  return xlsxConfig.isHidden(entryPath);
}

/** 过滤掉隐藏条目。管理员（isAdmin）可见全部隐藏项。 */
export async function filterHidden<T extends { name: string; path: string }>(
  _parentDir: string,
  entries: T[],
  _readText?: ReadText,
  _fresh = false,
  isAdmin = false
): Promise<T[]> {
  if (!xlsxConfig.isLoaded()) {
    return []; // 失败安全：未加载时全部隐藏，绝不泄露隐藏项
  }
  if (isAdmin) return entries; // 管理员可见全部隐藏项（与网页端 /api/* 一致）
  return entries.filter((e) => !xlsxConfig.isHidden(e.path));
}

/** 标记文件本身不应出现在列表里。 */
export const MARKER_FILES = new Set(['.elist.xlsx']);
