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

/**
 * 本地路径归一化（不依赖 config.ts，避免循环引用）。
 * 统一前导斜杠、去掉多余的 / 与 .、解析 ..，使隐藏/密码查询对「/admin」「admin」「/admin/」等写法都一致。
 */
function normPath(p: string): string {
  if (!p || !p.startsWith('/')) p = '/' + (p || '');
  const parts = p.split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  const r = '/' + out.join('/');
  return r === '/' ? '/' : r;
}

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

/**
 * 刚需全局配置项：自动建表或读取时若缺失，自动补入该键、默认空字符串。
 * 例如 admin_password——保证「键一定存在」，用户只需手动改表把值填上即可。
 */
const DEFAULT_CONFIG: Record<string, string> = {
  admin_password: '',
};

/** 确保刚需全局配置项存在（缺失则补空值并标脏，下次保存落盘）。 */
export function ensureDefaultConfig(): void {
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!data.config.has(key)) {
      data.config.set(key, value);
      changed = true;
    }
  }
  if (changed) data.dirty = true;
}

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
      data.passwords.set(normPath(path), { password: pwd, hint: hint || undefined });
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
      data.hidden.add(normPath(path));
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

  // 老表若缺刚需全局配置项（如 admin_password），内存补键（标脏以便后续落盘）
  ensureDefaultConfig();

  data.loaded = true;
  data.dirty = false;
}

/**
 * 合并解析（不清空已有配置，仅 add）。用于多账号 .elist.xlsx 配置并集读取，
 * 彻底消除「读 A 写 B / 配置散落多账号」导致隐藏项读不到（隐藏盘仍显示）。
 * 与 parseXlsx 不同：不 ensureDefaultConfig、不重置 loaded/dirty，只把内容并入现有 Map/Set。
 */
export async function mergeXlsx(buffer: ArrayBuffer, password?: string): Promise<void> {
  let xlsxBuffer = buffer;

  if (password) {
    try {
      const decrypted = await decryptWorkbook(new Uint8Array(buffer), password);
      xlsxBuffer = decrypted.buffer as ArrayBuffer;
    } catch {
      xlsxBuffer = buffer;
    }
  }

  const sheets = await parseXlsxMinimal(xlsxBuffer);

  const pwSheet = sheets.get('passwords');
  if (pwSheet) {
    for (let i = 1; i < pwSheet.length; i++) {
      const row = pwSheet[i];
      if (!row || row.length < 2) continue;
      const path = row[0];
      const pwd = row[1];
      if (!path || !pwd) continue;
      data.passwords.set(normPath(path), { password: pwd, hint: row[2] || undefined });
    }
  }

  const hiddenSheet = sheets.get('hidden');
  if (hiddenSheet) {
    for (let i = 1; i < hiddenSheet.length; i++) {
      const row = hiddenSheet[i];
      if (!row || row.length < 1) continue;
      const path = row[0];
      if (!path) continue;
      data.hidden.add(normPath(path));
    }
  }

  const configSheet = sheets.get('config');
  if (configSheet) {
    for (let i = 1; i < configSheet.length; i++) {
      const row = configSheet[i];
      if (!row || row.length < 1) continue;
      const key = row[0];
      if (!key) continue;
      data.config.set(key, row[1] || '');
    }
  }

  data.dirty = true;
}

/** 将内存配置生成 xlsx 二进制（支持加密） */
export async function generateXlsx(password?: string): Promise<ArrayBuffer> {
  // 生成前确保刚需全局配置项（如 admin_password）已存在，自动建表时也会带上空值键
  ensureDefaultConfig();

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
  return data.passwords.get(normPath(path)) || null;
}

/** 设置路径密码 */
export function setPassword(path: string, password: string, hint?: string): void {
  const np = normPath(path);
  if (password) {
    data.passwords.set(np, { password, hint });
  } else {
    data.passwords.delete(np);
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
  return data.hidden.has(normPath(path));
}

/** 设置路径隐藏状态 */
export function setHidden(path: string, hidden: boolean): void {
  const np = normPath(path);
  if (hidden) {
    data.hidden.add(np);
  } else {
    data.hidden.delete(np);
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
