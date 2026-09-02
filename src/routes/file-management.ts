import { Hono } from 'hono';
import type { Env } from '../types';
import { dispatch } from '../lib/dispatch';
import { getMounts } from '../config';
import { requireAdmin } from '../lib/auth';
import { loadXlsxConfig } from './fs';

const app = new Hono<{ Bindings: Env }>();

/**
 * 文件管理 API - 只绑定管理员登录，不绑定目录密码。
 *
 * 权限模型（与 /api/list、/api/raw 保持一致）：
 *  - 目录密码（X-Folder-Password）：只管「读」——访问/列出/下载加密内容。
 *  - 管理员登录（X-Admin-Password / Basic admin）：管「写」——创建/删除/移动/写入。
 * 已登录管理员在 handleList/handleRaw 中本就免目录密码，写操作同样不应再问一次目录密码，
 * 否则加密目录下无法创建/删除（报错「需要目录密码」）。
 */

// 写入文本文件
app.post('/write-text', async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  
  try {
    // 确保配置已加载（防止冷启动绕过门禁）
    await loadXlsxConfig(c, false);
    
    const { path, content } = await c.req.json();
    if (!path || content === undefined) {
      return c.json({ error: '缺少 path 或 content 参数' }, 400);
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
    // 确保配置已加载（防止冷启动绕过门禁）
    await loadXlsxConfig(c, false);
    
    const { sourcePath, targetPath } = await c.req.json();
    if (!sourcePath || !targetPath) {
      return c.json({ error: '缺少 sourcePath 或 targetPath 参数' }, 400);
    }
    
    // 获取驱动并移动
    const { driver, rest: sourceRest, mount } = await dispatch(c.env, sourcePath);
    if (!driver.move) {
      return c.json({ error: '该存储不支持移动操作' }, 501);
    }
    
    // 计算目标路径的 rest（添加守卫防止前缀冲突）
    const targetMount = getMounts(c.env).find(m => 
      m.mount === '/' || targetPath === m.mount || targetPath.startsWith(m.mount + '/')
    );
    if (!targetMount) {
      return c.json({ error: '目标路径不在任何挂载点内' }, 400);
    }
    
    // 检查是否跨挂载
    if (targetMount.mount !== mount.mount) {
      return c.json({ error: '不支持跨挂载点移动' }, 400);
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
    // 确保配置已加载（防止冷启动绕过门禁）
    await loadXlsxConfig(c, false);
    
    const { path } = await c.req.json();
    if (!path) {
      return c.json({ error: '缺少 path 参数' }, 400);
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
    // 确保配置已加载（防止冷启动绕过门禁）
    await loadXlsxConfig(c, false);
    
    const { path } = await c.req.json();
    if (!path) {
      return c.json({ error: '缺少 path 参数' }, 400);
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
