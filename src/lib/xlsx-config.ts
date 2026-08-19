/**
 * xlsx 配置集中化管理（.elist.xlsx）
 *
 * 设计：
 *   - 启动时或首次访问时读取 .elist.xlsx 到内存
 *   - 所有配置检查（密码、隐藏、登录等）走内存 Map（< 1ms）
 *   - 修改配置时先改内存，定期回写 xlsx
 *   - 清理缓存按钮：先回写 xlsx，再清内存
 *
 * xlsx 结构：
 *   Sheet1: passwords（路径密码配置）
 *     | path | password | hint |
 *   Sheet2: hidden（隐藏目录）
 *     | path |
 *   Sheet3: config（全局配置，如登录密码）
 *     | key | value |
 */

import * as XLSX from 'xlsx';

/** 内存中的配置数据 */
interface ConfigData {
  passwords: Map<string, { password: string; hint?: string }>;
  hidden: Set<string>;
  config: Map<string, string>;
  loaded: boolean;
  dirty: boolean; // 是否有未保存的修改
}

const data: ConfigData = {
  passwords: new Map(),
  hidden: new Set(),
  config: new Map(),
  loaded: false,
  dirty: false,
};

/** 从 xlsx 二进制数据解析配置 */
export function parseXlsx(buffer: ArrayBuffer): void {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Sheet1: passwords
  const pwSheet = workbook.Sheets['passwords'];
  if (pwSheet) {
    const pwData = XLSX.utils.sheet_to_json(pwSheet) as any[];
    data.passwords.clear();
    for (const row of pwData) {
      if (row.path && row.password) {
        data.passwords.set(row.path, {
          password: row.password,
          hint: row.hint,
        });
      }
    }
  }

  // Sheet2: hidden
  const hiddenSheet = workbook.Sheets['hidden'];
  if (hiddenSheet) {
    const hiddenData = XLSX.utils.sheet_to_json(hiddenSheet) as any[];
    data.hidden.clear();
    for (const row of hiddenData) {
      if (row.path) {
        data.hidden.add(row.path);
      }
    }
  }

  // Sheet3: config
  const configSheet = workbook.Sheets['config'];
  if (configSheet) {
    const configData = XLSX.utils.sheet_to_json(configSheet) as any[];
    data.config.clear();
    for (const row of configData) {
      if (row.key && row.value !== undefined) {
        data.config.set(row.key, String(row.value));
      }
    }
  }

  data.loaded = true;
  data.dirty = false;
}

/** 将内存配置生成 xlsx 二进制 */
export function generateXlsx(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  // Sheet1: passwords
  const pwData = Array.from(data.passwords.entries()).map(([path, { password, hint }]) => ({
    path,
    password,
    hint: hint || '',
  }));
  const pwSheet = XLSX.utils.json_to_sheet(pwData);
  XLSX.utils.book_append_sheet(workbook, pwSheet, 'passwords');

  // Sheet2: hidden
  const hiddenData = Array.from(data.hidden).map((path) => ({ path }));
  const hiddenSheet = XLSX.utils.json_to_sheet(hiddenData);
  XLSX.utils.book_append_sheet(workbook, hiddenSheet, 'hidden');

  // Sheet3: config
  const configData = Array.from(data.config.entries()).map(([key, value]) => ({
    key,
    value,
  }));
  const configSheet = XLSX.utils.json_to_sheet(configData);
  XLSX.utils.book_append_sheet(workbook, configSheet, 'config');

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

/** 检查是否已加载 */
export function isLoaded(): boolean {
  return data.loaded;
}

/** 标记为已加载（用于没有 .elist.xlsx 的情况） */
export function markLoaded(): void {
  data.loaded = true;
}

/** 检查是否有未保存的修改 */
export function isDirty(): boolean {
  return data.dirty;
}

/** 清除脏标记 */
export function clearDirty(): void {
  data.dirty = false;
}

// ========== 密码相关 ==========

/** 获取路径密码 */
export function getPassword(path: string): { password: string; hint?: string } | null {
  return data.passwords.get(path) || null;
}

/** 设置路径密码 */
export function setPassword(path: string, password: string, hint?: string): void {
  if (password) {
    data.passwords.set(path, { password, hint });
  } else {
    data.passwords.delete(path);
  }
  data.dirty = true;
}

/** 删除路径密码 */
export function removePassword(path: string): void {
  data.passwords.delete(path);
  data.dirty = true;
}

/** 获取所有密码配置 */
export function getAllPasswords(): Array<{ path: string; password: string; hint?: string }> {
  return Array.from(data.passwords.entries()).map(([path, { password, hint }]) => ({
    path,
    password,
    hint,
  }));
}

// ========== 隐藏相关 ==========

/** 检查路径是否隐藏 */
export function isHidden(path: string): boolean {
  return data.hidden.has(path);
}

/** 设置路径隐藏状态 */
export function setHidden(path: string, hidden: boolean): void {
  if (hidden) {
    data.hidden.add(path);
  } else {
    data.hidden.delete(path);
  }
  data.dirty = true;
}

/** 获取所有隐藏路径 */
export function getAllHidden(): string[] {
  return Array.from(data.hidden);
}

// ========== 全局配置相关 ==========

/** 获取配置值 */
export function getConfig(key: string): string | null {
  return data.config.get(key) || null;
}

/** 设置配置值 */
export function setConfig(key: string, value: string): void {
  data.config.set(key, value);
  data.dirty = true;
}

/** 删除配置 */
export function removeConfig(key: string): void {
  data.config.delete(key);
  data.dirty = true;
}

/** 获取所有配置 */
export function getAllConfig(): Array<{ key: string; value: string }> {
  return Array.from(data.config.entries()).map(([key, value]) => ({ key, value }));
}

// ========== 清理 ==========

/** 清空所有配置（用于清理缓存） */
export function clearAll(): void {
  data.passwords.clear();
  data.hidden.clear();
  data.config.clear();
  data.loaded = false;
  data.dirty = false;
}
