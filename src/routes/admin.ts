import type { Context } from 'hono';
import type { Env } from '../types';
import * as xlsxConfig from '../lib/xlsx-config';
import { getMounts } from '../config';
import { dispatch } from '../lib/dispatch';

// 简单的会话管理（内存存储）
const sessions = new Set<string>();

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function getSessionId(c: Context<{ Bindings: Env }>): string | null {
  const cookie = c.req.header('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

function isAuthenticated(c: Context<{ Bindings: Env }>): boolean {
  const sessionId = getSessionId(c);
  return sessionId !== null && sessions.has(sessionId);
}

// POST /api/admin/login
export async function handleLogin(c: Context<{ Bindings: Env }>) {
  const { password } = await c.req.json();
  
  // 从 xlsx 配置获取管理员密码
  const adminPassword = xlsxConfig.getConfig('admin_password');
  if (!adminPassword) {
    return c.json({ error: '管理员密码未配置' }, 500);
  }
  
  if (password !== adminPassword) {
    return c.json({ error: '密码错误' }, 401);
  }
  
  // 生成会话
  const sessionId = generateSessionId();
  sessions.add(sessionId);
  
  // 设置cookie（7天有效期）
  const maxAge = 7 * 24 * 60 * 60;
  c.header('Set-Cookie', `session=${sessionId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`);
  
  return c.json({ success: true });
}

// POST /api/admin/logout
export async function handleLogout(c: Context<{ Bindings: Env }>) {
  const sessionId = getSessionId(c);
  if (sessionId) {
    sessions.delete(sessionId);
  }
  
  c.header('Set-Cookie', 'session=; Path=/; Max-Age=0');
  return c.json({ success: true });
}

// GET /api/admin/config?path=/xxx
export async function handleGetConfig(c: Context<{ Bindings: Env }>) {
  if (!isAuthenticated(c)) {
    return c.json({ error: '未授权' }, 401);
  }
  
  const path = c.req.query('path');
  if (!path) {
    return c.json({ error: '缺少path参数' }, 400);
  }
  
  // 从xlsx配置中获取
  const password = xlsxConfig.getPassword(path);
  const hidden = xlsxConfig.isHidden(path);
  
  return c.json({
    path,
    password: password?.password || '',
    hint: password?.hint || '',
    hidden
  });
}

// POST /api/admin/config
export async function handleSetConfig(c: Context<{ Bindings: Env }>) {
  if (!isAuthenticated(c)) {
    return c.json({ error: '未授权' }, 401);
  }
  
  const { path, password, hint, hidden } = await c.req.json();
  
  if (!path) {
    return c.json({ error: '缺少path参数' }, 400);
  }
  
  // 更新内存配置
  if (password) {
    xlsxConfig.setPassword(path, password, hint);
  } else {
    xlsxConfig.removePassword(path);
  }
  
  xlsxConfig.setHidden(path, hidden);
  
  return c.json({ success: true });
}

// POST /api/admin/save
export async function handleSaveConfig(c: Context<{ Bindings: Env }>) {
  if (!isAuthenticated(c)) {
    return c.json({ error: '未授权' }, 401);
  }
  
  if (!xlsxConfig.isDirty()) {
    return c.json({ success: true, message: '没有需要保存的更改' });
  }
  
  const mounts = getMounts(c.env);
  if (mounts.length === 0) {
    return c.json({ error: '没有可用的挂载点' }, 500);
  }
  
  const configAuth = c.env.CONFIG_AUTH;
  const configPath = c.env.CONFIG_PATH || '/';
  const xlsxPassword = c.env.CONF_PW;
  const content = await xlsxConfig.generateXlsx(xlsxPassword);
  
  // 回落逻辑：优先指定位置 -> first-onedrive -> first-s3 -> 第一个存储
  const saveTargets: string[] = [];
  
  if (configAuth) {
    saveTargets.push(configAuth);
  }
  saveTargets.push(':first-onedrive', ':first-s3', ':first');
  
  const errors: string[] = [];
  
  for (const target of saveTargets) {
    try {
      const driver = await getConfigDriver(c.env, target, configPath);
      if (!driver) {
        errors.push(`${target}: 未找到匹配的存储`);
        continue;
      }
      const xlsxPath = configPath === '/' ? '/.elist.xlsx' : configPath + '/.elist.xlsx';
      await driver.writeBinary(xlsxPath, content);
      xlsxConfig.clearDirty();
      return c.json({ success: true, savedTo: target });
    } catch (e: any) {
      errors.push(`${target}: ${e.message}`);
      continue;
    }
  }
  
  return c.json({ error: '所有保存位置都失败', details: errors }, 500);
}

// 获取配置存储的 driver
async function getConfigDriver(env: Env, target: string, configPath: string): Promise<any | null> {
  const { getAllAuthAccounts } = await import('../lib/dispatch');
  const { getDriverClass } = await import('../drivers/registry');
  
  const accounts = getAllAuthAccounts(env);
  if (accounts.length === 0) return null;
  
  let targetAccount: { name: string; type: string; auth: any } | null = null;
  
  if (target === ':first-onedrive') {
    targetAccount = accounts.find(a => a.type === 'onedrive') || null;
  } else if (target === ':first-s3') {
    targetAccount = accounts.find(a => a.type === 's3') || null;
  } else if (target === ':first') {
    targetAccount = accounts[0];
  } else {
    targetAccount = accounts.find(a => a.name === target) || null;
  }
  
  if (!targetAccount) return null;
  
  const DriverClass = getDriverClass(targetAccount.type);
  if (!DriverClass) return null;
  
  const driver = new DriverClass();
  await driver.init({
    mount: '/',
    root: configPath,
    driver: targetAccount.type,
    addition: targetAccount.auth,
  }, env);
  
  return driver;
}
