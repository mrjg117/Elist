export type ReadText = (path: string) => Promise<string | null>;

import * as xlsxConfig from './xlsx-config';

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
  _fresh = false
): Promise<{ ok: boolean; lockedAt?: string }> {
  // 未加载时拒绝访问（安全：防止冷启动绕过）
  if (!xlsxConfig.isLoaded()) {
    return { ok: false, lockedAt: fullPath };
  }

  const segs = fullPath.split('/').filter(Boolean);
  let acc = '';
  for (const s of segs) {
    acc += '/' + s;
    const pwConfig = xlsxConfig.getPassword(acc);
    if (!pwConfig) continue; // 无密码配置 = 该层公开

    const expectedPassword = pwConfig.password;
    if (!provided.includes(expectedPassword)) {
      return { ok: false, lockedAt: acc };
    }
  }
  return { ok: true };
}

/** 某条目是否应被隐藏（从内存 Map 检查）。 */
export async function isHidden(
  entryPath: string,
  _readText?: ReadText,
  _fresh = false
): Promise<boolean> {
  if (!xlsxConfig.isLoaded()) {
    return false; // 未加载时默认不隐藏
  }
  return xlsxConfig.isHidden(entryPath);
}

/** 过滤掉隐藏条目。 */
export async function filterHidden<T extends { name: string; path: string }>(
  _parentDir: string,
  entries: T[],
  _readText?: ReadText,
  _fresh = false
): Promise<T[]> {
  if (!xlsxConfig.isLoaded()) {
    return entries; // 未加载时不过滤
  }
  return entries.filter((e) => !xlsxConfig.isHidden(e.path));
}

/** 标记文件本身不应出现在列表里。 */
export const MARKER_FILES = new Set(['.elist.xlsx']);
