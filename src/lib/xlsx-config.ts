/**
 * xlsx 配置集中化管理（.elist.xlsx）
 *
 * 设计：
 *   - 启动时或首次访问时读取 .elist.xlsx 到内存
 *   - 所有配置检查（密码、隐藏、登录等）走内存 Map（< 1ms）
 *   - 修改配置时先改内存，定期回写 xlsx
 *   - 清理缓存按钮：先回写 xlsx，再清内存
 *   - 支持加密（CONF_PW）
 *
 * xlsx 结构（表名/表头全中文，由本模块生成或覆盖）：
 *   密码：路径 | 密码 | 提示
 *   隐藏：路径
 *   配置：配置项 | 值（管理员密码固定占一行）
 */

import { parseXlsx as parseXlsxMinimal, generateXlsx as generateXlsxMinimal } from './xlsx-minimal';
// 内置加密模块：与原库同源，但把 Agile spinCount 从 100000 降到 100（性价比点），
// 避免边缘函数生成/解密配置表时超出 CPU 预算返回 503；Excel/WPS 仍按文件声明读取。
import { decryptWorkbook, encryptWorkbook } from './ooxml-encryption/index.js';

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

/** 按表名优先、表头签名兜底定位工作表；不依赖 sheet 文件顺序。 */
function pickSheet(sheets: Map<string, string[][]>, name: string, headers: string[]): string[][] | undefined {
  const matches = (rows?: string[][]) => {
    const h = (rows?.[0] || []).map((v) => (v || '').trim());
    return h.length === headers.length && headers.every((v, i) => h[i] === v);
  };
  const byName = sheets.get(name);
  if (matches(byName)) return byName;
  for (const rows of sheets.values()) if (matches(rows)) return rows;
  return undefined;
}

/** 从 xlsx 二进制数据解析配置（支持加密）。解析到临时结构，成功才整体替换内存。 */
export async function parseXlsx(buffer: ArrayBuffer, password?: string): Promise<void> {
  let xlsxBuffer = buffer;

  // 加密文件先解密。解密失败直接抛出，禁止当成空表蒙混过关。
  if (isEncrypted(buffer)) {
    if (!password) throw new Error('配置文件已加密，但未设置 CONF_PW，无法解密');
    try {
      const decrypted = await decryptWorkbook(new Uint8Array(buffer), password);
      xlsxBuffer = decrypted.buffer as ArrayBuffer;
    } catch (e: any) {
      throw new Error(`配置文件解密失败（CONF_PW 与文件加密密码不一致，或 Excel/WPS 重存后加密格式不兼容）：${e?.message || e}`);
    }
  }

  const sheets = await parseXlsxMinimal(xlsxBuffer);
  const passwords = new Map<string, { password: string; hint?: string }>();
  const hidden = new Set<string>();
  const config = new Map<string, string>();

  // 工作表按「中文标签 + 表头签名」识别；表头签名兜底，防止用户改标签后失效。
  const pwSheet = pickSheet(sheets, '密码', ['路径', '密码', '提示']);
  if (pwSheet) {
    for (let i = 1; i < pwSheet.length; i++) {
      const row = pwSheet[i];
      if (!row || row.length < 2) continue;
      const path = row[0];
      const pwd = row[1];
      if (!path || !pwd) continue;
      passwords.set(normPath(path), { password: pwd, hint: row[2] || undefined });
    }
  }

  const hiddenSheet = pickSheet(sheets, '隐藏', ['路径']);
  if (hiddenSheet) {
    for (let i = 1; i < hiddenSheet.length; i++) {
      const path = hiddenSheet[i]?.[0];
      if (path) hidden.add(normPath(path));
    }
  }

  const configSheet = pickSheet(sheets, '配置', ['配置项', '值']);
  if (configSheet) {
    for (let i = 1; i < configSheet.length; i++) {
      const row = configSheet[i];
      if (!row || row.length < 1) continue;
      const key = (row[0] || '').trim();
      if (key) config.set(key, row[1] || '');
    }
  }
  // 管理员密码固定取第 2 行第 2 列，不靠中文 key 匹配（避免富文本拆词/标签改动）。
  config.set(ADMIN_PASSWORD_KEY, (configSheet?.[1]?.[1] || '').trim());

  // 全部解析成功后才替换内存：读失败不会清掉旧配置，也不会把旧配置写回新表。
  data.passwords = passwords;
  data.hidden = hidden;
  data.config = config;
  data.loaded = true;
  data.dirty = false;
}

/** 将内存配置生成 xlsx 二进制（支持加密） */
export async function generateXlsx(password?: string): Promise<ArrayBuffer> {
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
  const xlsxBuffer = await generateXlsxMinimal(sheets, { protectedSheets, unlockFromRow: 1, unlockCols });

  // 如果提供了密码，加密
  if (password) {
    const encrypted = await encryptWorkbook(new Uint8Array(xlsxBuffer), password);
    return encrypted.buffer as ArrayBuffer;
  }

  return xlsxBuffer;
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

/** 标记为已加载（表已生成/读到，内容可能为空） */
export function markLoaded(): void {
  data.loaded = true;
}

/** 读取/建表失败：只置未加载，不清内存。门禁按 isConfigured 失败安全隐藏。 */
export function markUnavailable(): void {
  data.loaded = false;
  data.dirty = false;
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
