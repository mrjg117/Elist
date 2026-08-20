/**
 * xlsx 配置集中化管理（.elist.xlsx）
 *
 * 设计：
 *   - 启动时或首次访问时读取 .elist.xlsx 到内存
 *   - 所有配置检查（密码、隐藏、登录等）走内存 Map（< 1ms）
 *   - 修改配置时先改内存，定期回写 xlsx
 *   - 清理缓存按钮：先回写 xlsx，再清内存
 *   - 支持加密（使用 CONF_PW 环境变量）
 *
 * xlsx 结构：
 *   Sheet1: passwords（路径密码配置）
 *     | path | password | hint |
 *   Sheet2: hidden（隐藏目录）
 *     | path |
 *   Sheet3: config（全局配置，如登录密码）
 *     | key | value |
 */

import { parseXlsx as parseXlsxMinimal, generateXlsx as generateXlsxMinimal } from './xlsx-minimal';
import { decryptWorkbook, encryptWorkbook } from 'ooxml-encryption';

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

/** 从 xlsx 二进制数据解析配置（支持加密） */
export async function parseXlsx(buffer: ArrayBuffer, password?: string): Promise<void> {
  let xlsxBuffer = buffer;

  // 如果提供了密码，先解密
  if (password) {
    try {
      const decrypted = await decryptWorkbook(new Uint8Array(buffer), password);
      xlsxBuffer = decrypted.buffer as ArrayBuffer;
    } catch (e) {
      // 解密失败，使用原始 buffer
      xlsxBuffer = buffer;
    }
  }

  // 使用最小化模块解析
  const sheets = await parseXlsxMinimal(xlsxBuffer);

  // Sheet1: passwords
  const pwSheet = sheets.get('passwords');
  if (pwSheet) {
    data.passwords.clear();
    for (let i = 1; i < pwSheet.length; i++) {
      const row = pwSheet[i];
      if (!row || row.length < 2) continue;
      const path = row[0];
      const pwd = row[1];
      if (!path || !pwd) continue;
      const hint = row[2];
      data.passwords.set(path, { password: pwd, hint: hint || undefined });
    }
  }

  // Sheet2: hidden
  const hiddenSheet = sheets.get('hidden');
  if (hiddenSheet) {
    data.hidden.clear();
    for (let i = 1; i < hiddenSheet.length; i++) {
      const row = hiddenSheet[i];
      if (!row || row.length < 1) continue;
      const path = row[0];
      if (!path) continue;
      data.hidden.add(path);
    }
  }

  // Sheet3: config
  const configSheet = sheets.get('config');
  if (configSheet) {
    data.config.clear();
    for (let i = 1; i < configSheet.length; i++) {
      const row = configSheet[i];
      if (!row || row.length < 1) continue;
      const key = row[0];
      if (!key) continue;
      const value = row[1] || '';
      data.config.set(key, value);
    }
  }

  data.loaded = true;
  data.dirty = false;
}

/** 将内存配置生成 xlsx 二进制（支持加密） */
export async function generateXlsx(password?: string): Promise<ArrayBuffer> {
  // 构建 sheets 数据
  const sheets = new Map<string, string[][]>();

  // Sheet1: passwords
  const pwRows: string[][] = [['path', 'password', 'hint']];
  for (const [path, { password: pwd, hint }] of data.passwords.entries()) {
    pwRows.push([path, pwd, hint || '']);
  }
  sheets.set('passwords', pwRows);

  // Sheet2: hidden
  const hiddenRows: string[][] = [['path']];
  for (const path of data.hidden) {
    hiddenRows.push([path]);
  }
  sheets.set('hidden', hiddenRows);

  // Sheet3: config
  const configRows: string[][] = [['key', 'value']];
  for (const [key, value] of data.config.entries()) {
    configRows.push([key, value]);
  }
  sheets.set('config', configRows);

  // 生成 xlsx 文件
  const xlsxBuffer = await generateXlsxMinimal(sheets);

  // 如果提供了密码，加密
  if (password) {
    const encrypted = await encryptWorkbook(new Uint8Array(xlsxBuffer), password);
    return encrypted.buffer as ArrayBuffer;
  }

  return xlsxBuffer;
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
