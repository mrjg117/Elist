/**
 * xlsx 配置集中化管理（.elist.xlsx）
 *
 * 设计：
 *   - 启动时或首次访问时读取 .elist.xlsx 到内存
 *   - 所有配置检查（密码、隐藏、登录等）走内存 Map（< 1ms）
 *   - 修改配置时先改内存，定期回写 xlsx
 *   - 清理缓存按钮：先回写 xlsx，再清内存
 *   - 配置表以明文 xlsx 生成，方便用 Excel/WPS 直接编辑（读端仍兼容旧加密表）
 *
 * xlsx 结构（表名/表头全中文，由本模块生成或覆盖）：
 *   密码：路径 | 密码 | 提示
 *   隐藏：路径
 *   配置：配置项 | 值（管理员密码固定占一行）
 */

import { parseXlsx as parseXlsxMinimal, generateXlsx as generateXlsxMinimal } from './xlsx-minimal';
import { decryptWorkbook } from 'ooxml-encryption';

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

/** 填写区预留空行数（框架表里留出可编辑的空白行）。 */
const FILL_ROWS = 30;

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

/** 管理员密码在「配置」表中的固定键名。 */
export const ADMIN_PASSWORD_KEY = '管理员密码';

/** 判断 xlsx 二进制是否为加密文件（OLE 复合文档头 D0 CF 11 E0 A1 B1 1A E1）。 */
export function isEncrypted(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  return b.length >= 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;
}

/** 确保管理员密码键存在（缺失则补空值并标脏，下次保存落盘）。 */
export function ensureDefaultConfig(): void {
  if (!data.config.has(ADMIN_PASSWORD_KEY)) {
    data.config.set(ADMIN_PASSWORD_KEY, '');
    data.dirty = true;
  }
}

/** 从 xlsx 二进制数据解析配置（支持加密） */
export async function parseXlsx(buffer: ArrayBuffer, password?: string): Promise<void> {
  let xlsxBuffer = buffer;

  // 如果文件是加密的（OLE 复合文档头 D0 CF 11 E0），必须先解密。
  // 解密失败不再静默回退：加密二进制当 xlsx 解析会得到空表 + loaded=true，
  // 伪装成「密码未设置」，掩盖真实原因。宁可抛出让上层明确报错。
  if (isEncrypted(buffer)) {
    if (!password) {
      throw new Error('配置文件已加密，但未设置 CONF_PW，无法解密');
    }
    try {
      const decrypted = await decryptWorkbook(new Uint8Array(buffer), password);
      xlsxBuffer = decrypted.buffer as ArrayBuffer;
    } catch (e: any) {
      throw new Error(`配置文件解密失败（CONF_PW 与文件加密密码不一致，或 Excel/WPS 重存后加密格式不兼容）：${e?.message || e}`);
    }
  }

  // 使用最小化模块解析
  const sheets = await parseXlsxMinimal(xlsxBuffer);

  // Sheet1: 密码
  const pwSheet = sheets.get('密码');
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

  // Sheet2: 隐藏
  const hiddenSheet = sheets.get('隐藏');
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

  // Sheet3: 配置
  const configSheet = sheets.get('配置');
  if (configSheet) {
    data.config.clear();
    for (let i = 1; i < configSheet.length; i++) {
      const row = configSheet[i];
      if (!row || row.length < 1) continue;
      const key = (row[0] || '').trim();
      if (!key) continue;
      data.config.set(key, row[1] || '');
    }
  }

  // 缺管理员密码键则补空值（标脏以便后续落盘）
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

  if (isEncrypted(buffer)) {
    if (!password) throw new Error('配置文件已加密，但未设置 CONF_PW，无法解密');
    try {
      const decrypted = await decryptWorkbook(new Uint8Array(buffer), password);
      xlsxBuffer = decrypted.buffer as ArrayBuffer;
    } catch (e: any) {
      throw new Error(`配置文件解密失败（请检查 CONF_PW）：${e?.message || e}`);
    }
  }

  const sheets = await parseXlsxMinimal(xlsxBuffer);

  const pwSheet = sheets.get('密码');
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

  const hiddenSheet = sheets.get('隐藏');
  if (hiddenSheet) {
    for (let i = 1; i < hiddenSheet.length; i++) {
      const row = hiddenSheet[i];
      if (!row || row.length < 1) continue;
      const path = row[0];
      if (!path) continue;
      data.hidden.add(normPath(path));
    }
  }

  const configSheet = sheets.get('配置');
  if (configSheet) {
    for (let i = 1; i < configSheet.length; i++) {
      const row = configSheet[i];
      if (!row || row.length < 1) continue;
      const key = (row[0] || '').trim();
      if (!key) continue;
      data.config.set(key, row[1] || '');
    }
  }

  data.dirty = true;
}

/** 将内存配置生成 xlsx 二进制（明文；配置表用 Excel/WPS 编辑后必须能被稳定读回，故不加密） */
export async function generateXlsx(): Promise<ArrayBuffer> {
  // 生成前确保管理员密码键已存在，自动建表时也会带上空值键
  ensureDefaultConfig();

  // 构建 sheets 数据（中文表名 + 中文表头，第 2 行起为填写区）
  const sheets = new Map<string, string[][]>();

  // Sheet1: 密码
  const pwRows: string[][] = [['路径', '密码', '提示']];
  for (const [path, { password: pwd, hint }] of data.passwords.entries()) {
    pwRows.push([path, pwd, hint || '']);
  }
  for (let i = pwRows.length; i <= FILL_ROWS; i++) pwRows.push(['', '', '']);
  sheets.set('密码', pwRows);

  // Sheet2: 隐藏
  const hiddenRows: string[][] = [['路径']];
  for (const path of data.hidden) {
    hiddenRows.push([path]);
  }
  for (let i = hiddenRows.length; i <= FILL_ROWS; i++) hiddenRows.push(['']);
  sheets.set('隐藏', hiddenRows);

  // Sheet3: 配置（管理员密码是刚需键，始终占一行，值为空待填）
  const configRows: string[][] = [['配置项', '值']];
  configRows.push([ADMIN_PASSWORD_KEY, data.config.get(ADMIN_PASSWORD_KEY) || '']);
  for (const [key, value] of data.config.entries()) {
    if (key === ADMIN_PASSWORD_KEY) continue;
    configRows.push([key, value]);
  }
  for (let i = configRows.length; i <= FILL_ROWS; i++) configRows.push(['', '']);
  sheets.set('配置', configRows);

  // 生成 xlsx 文件：三个表都保护，表头锁定，第 2 行起可编辑。
  // 「配置」表的项目名（第 0 列）是固定 key（如 管理员密码），锁定防误改；只留「值」列（第 1 列）可填。
  const protectedSheets = new Set(['密码', '隐藏', '配置']);
  const unlockCols = new Map([['配置', new Set([1])]]);
  return await generateXlsxMinimal(sheets, { protectedSheets, unlockFromRow: 1, unlockCols });
}

/** 检查是否已加载（文件层：表已读到/已建，但可能是空的未配置表） */
export function isLoaded(): boolean {
  return data.loaded;
}

/**
 * 检查是否「已配置」（门禁放行前提）。
 * 空框架表（仅表头、管理员密码为空）不算已配置——门禁保持失败安全全隐藏，
 * 避免删表/首跑后空表被当成有效配置导致全部挂载裸奔。
 */
export function isConfigured(): boolean {
  return data.loaded && !!(data.config.get(ADMIN_PASSWORD_KEY) || '');
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
