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
  
  // 从环境变量获取管理员密码
  const adminPassword = c.env.ADMIN_PASSWORD;
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
  
  // 找到第一个挂载点来保存配置文件
  const mounts = getMounts(c.env);
  if (mounts.length === 0) {
    return c.json({ error: '没有可用的挂载点' }, 500);
  }
  
  const mount = mounts[0];
  const { driver, rest } = await dispatch(c.env, mount.mount);
  const xlsxPath = rest === '/' ? '/.elist.xlsx' : rest + '/.elist.xlsx';
  
  const xlsxPassword = c.env.XLSX_PASSWORD;
  const content = await xlsxConfig.generateXlsx(xlsxPassword);
  await driver.writeBinary(xlsxPath, content);
  
  xlsxConfig.clearDirty();
  
  return c.json({ success: true });
}
