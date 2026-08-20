import type { Context } from 'hono';
import type { Env } from '../types';
import * as xlsxConfig from './xlsx-config';
import { loadXlsxConfig } from '../routes/fs';

/**
 * 管理员鉴权中间件。
 * 支持两种鉴权方式：
 * 1. X-Admin-Password 请求头
 * 2. HTTP Basic Auth（用户名为 admin）
 *
 * 返回 null 表示鉴权成功，否则返回错误响应。
 */
export async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<any | null> {
  // 先加载配置，防止冷启动时配置未加载导致鉴权失败
  await loadXlsxConfig(c, false);

  // 尝试从 X-Admin-Password 头获取
  let adminPassword: string | undefined = c.req.header('X-Admin-Password');

  // 如果没有，尝试从 Basic Auth 提取
  if (!adminPassword) {
    adminPassword = extractAdminPassword(c) ?? undefined;
  }

  if (!adminPassword) {
    return c.json({ error: '需要管理员密码' }, 401);
  }

  // 从 xlsx 配置获取管理员密码
  const expectedPassword = xlsxConfig.getConfig('admin_password');
  if (!expectedPassword || expectedPassword !== adminPassword) {
    return c.json({ error: '管理员密码错误' }, 403);
  }

  return null;
}

/**
 * 从 Basic Auth 提取管理员密码（用户名为 admin）。
 */
export function extractAdminPassword(c: Context<{ Bindings: Env }>): string | null {
  const auth = c.req.header('Authorization') || '';
  if (!auth.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = atob(auth.slice(6).trim());
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (user === 'admin') return pass;
  } catch {}
  return null;
}
