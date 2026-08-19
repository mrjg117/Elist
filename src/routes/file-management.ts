import { Hono } from 'hono';
import type { Env } from '../types';
import { dispatch } from '../lib/dispatch';
import { checkPathPassword } from '../lib/acl';
import { getMounts } from '../config';

const app = new Hono<{ Bindings: Env }>();

/**
 * 文件管理 API - 需要管理员权限
 * 所有操作都需要先验证管理员密码
 */

// 验证管理员权限
async function requireAdmin(c: any) {
  const adminPassword = c.req.header('X-Admin-Password');
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

// 写入文本文件
app.post('/write-text', async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  
  try {
    const { path, content } = await c.req.json();
    if (!path || content === undefined) {
      return c.json({ error: '缺少 path 或 content 参数' }, 400);
    }
    
    // 检查路径密码
    const pws = c.req.header('X-Folder-Password')?.split(',') || [];
    const gate = await checkPathPassword(path, pws);
    if (!gate.ok) {
      return c.json({ error: '需要目录密码', path: gate.lockedAt }, 403);
    }
    
    // 获取驱动并写入
    const { driver, rest } = await dispatch(c.env, path);
    if (!driver.writeText) {
      return c.json({ error: '该存储不支持文本写入' }, 501);
    }
    
    await driver.writeText(rest, content);
    return c.json({ success: true, path });
  } catch (error: any) {
    console.error('writeText error:', error);
    return c.json({ error: error.message || '写入失败' }, 500);
  }
});

// 移动/重命名文件
app.post('/move', async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  
  try {
    const { sourcePath, targetPath } = await c.req.json();
    if (!sourcePath || !targetPath) {
      return c.json({ error: '缺少 sourcePath 或 targetPath 参数' }, 400);
    }
    
    // 检查源路径密码
    const pws = c.req.header('X-Folder-Password')?.split(',') || [];
    const gate = await checkPathPassword(sourcePath, pws);
    if (!gate.ok) {
      return c.json({ error: '需要目录密码', path: gate.lockedAt }, 403);
    }
    
    // 获取驱动并移动
    const { driver, rest: sourceRest } = await dispatch(c.env, sourcePath);
    if (!driver.move) {
      return c.json({ error: '该存储不支持移动操作' }, 501);
    }
    
    // 计算目标路径的 rest
    const targetMount = getMounts(c.env).find(m => targetPath.startsWith(m.mount));
    if (!targetMount) {
      return c.json({ error: '目标路径不在任何挂载点内' }, 400);
    }
    
    const targetRest = targetPath.slice(targetMount.mount.length) || '/';
    
    await driver.move(sourceRest, targetRest);
    return c.json({ success: true, sourcePath, targetPath });
  } catch (error: any) {
    console.error('move error:', error);
    return c.json({ error: error.message || '移动失败' }, 500);
  }
});

// 删除文件
app.post('/delete', async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  
  try {
    const { path } = await c.req.json();
    if (!path) {
      return c.json({ error: '缺少 path 参数' }, 400);
    }
    
    // 检查路径密码
    const pws = c.req.header('X-Folder-Password')?.split(',') || [];
    const gate = await checkPathPassword(path, pws);
    if (!gate.ok) {
      return c.json({ error: '需要目录密码', path: gate.lockedAt }, 403);
    }
    
    // 获取驱动并删除
    const { driver, rest } = await dispatch(c.env, path);
    if (!driver.delete) {
      return c.json({ error: '该存储不支持删除操作' }, 501);
    }
    
    await driver.delete(rest);
    return c.json({ success: true, path });
  } catch (error: any) {
    console.error('delete error:', error);
    return c.json({ error: error.message || '删除失败' }, 500);
  }
});

// 创建目录
app.post('/mkdir', async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  
  try {
    const { path } = await c.req.json();
    if (!path) {
      return c.json({ error: '缺少 path 参数' }, 400);
    }
    
    // 检查路径密码
    const pws = c.req.header('X-Folder-Password')?.split(',') || [];
    const gate = await checkPathPassword(path, pws);
    if (!gate.ok) {
      return c.json({ error: '需要目录密码', path: gate.lockedAt }, 403);
    }
    
    // 获取驱动并创建目录
    const { driver, rest } = await dispatch(c.env, path);
    if (!driver.mkdir) {
      return c.json({ error: '该存储不支持创建目录' }, 501);
    }
    
    await driver.mkdir(rest);
    return c.json({ success: true, path });
  } catch (error: any) {
    console.error('mkdir error:', error);
    return c.json({ error: error.message || '创建目录失败' }, 500);
  }
});

export default app;
